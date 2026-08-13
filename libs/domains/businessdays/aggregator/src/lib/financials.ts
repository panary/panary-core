import { Order, OrderChannel, DineLocation, TransactionMethod, PaymentState, Transaction } from '@panary/orders/domain'
import { toCents, sumCents } from './money'
import {
  isCancelled,
  isRefunded,
  isRegularSale,
  isStaffMeal,
  isCorporateMeal,
  isOpenReceivable,
  isOrdersOnly,
  type OrderAggregationOptions,
} from './classifications'
import { getOrderGrossCents, getOrderNetCents, getOrderTipCents } from './order-total'

/** Steuersplit-Eintrag pro Steuersatz (z. B. 7%, 19%). */
export interface TaxSplitEntry {
  rate: number // 7, 19, ...
  netAmountCents: number
  taxAmountCents: number
  grossAmountCents: number
}

/** Channel-Aggregat (alle bekannten OrderChannel-Werte, sicher 0 wenn nicht vorhanden). */
export interface ChannelBreakdown {
  posCents: number
  telephoneCents: number
  onlineCents: number
  appCents: number
}

/** DineLocation-Aggregat (relevant für DE-Umsatzsteuer: 7% vs 19%). */
export interface DineLocationBreakdown {
  dineInCents: number
  takeOutCents: number
}

/** Zahlungsart-Aggregat. */
export interface PaymentBreakdown {
  cashCents: number
  cardCents: number
  onlineCents: number
  otherCents: number
  /**
   * Offene Forderungen aus angeschriebenen Personal-/Firmenkundenessen.
   *
   * Bewusst **optional**: waere das Feld required, braeche der Cloud-Typecheck
   * schon im Pin-Bump-Commit, der nur Ranges und Lockfile enthalten soll. Alt-
   * Reports ohne das Feld bleiben lesbar; jeder Konsument muss `?? 0` rechnen.
   */
  receivablesCents?: number
}

/**
 * Die Buckets als Liste — Konsumenten sollen iterieren statt aufzuzaehlen.
 *
 * Rund 14 Stellen in Cloud und Edge summieren die vier bisherigen Buckets von
 * Hand (Z-Bon, DSFinV-K-Export, Finanz-Karten). Ein fuenfter Bucket braeche
 * dort **nicht am Compiler** — er wuerde einfach nicht mitsummiert und die
 * Differenz waere still. Wer hierueber iteriert, bekommt neue Buckets
 * automatisch.
 */
export const PAYMENT_BUCKET_KEYS = [
  'cashCents',
  'cardCents',
  'onlineCents',
  'otherCents',
  'receivablesCents',
] as const satisfies ReadonlyArray<keyof PaymentBreakdown>

/** Gesamt-Finanzaggregat eines Geschäftstages. */
export interface FinancialsAggregate {
  grossTotalCents: number
  netTotalCents: number
  taxes: TaxSplitEntry[]
  channels: ChannelBreakdown
  dineLocation: DineLocationBreakdown
  payments: PaymentBreakdown
  tipsCents: number
  refundsCount: number
  refundsCents: number
  discountsCount: number
  discountsCents: number // Summe der gewährten Rabatte (rabattierter Brutto-Anteil)
  voidsCount: number
  voidsCents: number // Stornierte Bons-Brutto
}

const ZERO_FINANCIALS: FinancialsAggregate = Object.freeze({
  grossTotalCents: 0,
  netTotalCents: 0,
  taxes: [],
  channels: { posCents: 0, telephoneCents: 0, onlineCents: 0, appCents: 0 },
  dineLocation: { dineInCents: 0, takeOutCents: 0 },
  payments: { cashCents: 0, cardCents: 0, onlineCents: 0, otherCents: 0, receivablesCents: 0 },
  tipsCents: 0,
  refundsCount: 0,
  refundsCents: 0,
  discountsCount: 0,
  discountsCents: 0,
  voidsCount: 0,
  voidsCents: 0,
})

/**
 * Aggregiert Finanz-KPIs für eine Liste von Bestellungen.
 *
 * Konvention:
 *  - Personalessen und Firmenkundenessen werden hier separat behandelt
 *    (siehe meal-subsidies.ts). `financials` enthält den Cash/Card-Umsatz
 *    inklusive Personalessen-Brutto, weil das für den fiskalen Z-Bon gilt.
 *    Das Anzeige-Netto-Konstrukt liegt in derive-net-revenue.
 *  - Stornos (ABORTED / cancellation) zählen in voidsCount + voidsCents,
 *    fließen aber NICHT in grossTotal/netTotal/taxes (Standard: stornierte
 *    Bons sind kein Umsatz).
 *  - Refunds (PaymentState=REFUNDED) zählen in refundsCount + refundsCents
 *    und sind ebenfalls nicht im grossTotal — das ist der nachträglich
 *    erstattete Betrag.
 *
 * Determinismus: Order-Liste wird vor Aggregation nach `_id` sortiert.
 */
export function aggregateFinancials(
  orders: ReadonlyArray<Order>,
  options?: OrderAggregationOptions,
): FinancialsAggregate {
  if (orders.length === 0) return { ...ZERO_FINANCIALS, taxes: [] }

  const ordersOnly = isOrdersOnly(options)

  const sorted = [...orders].sort((a, b) => a._id.localeCompare(b._id))

  let grossTotalCents = 0
  let netTotalCents = 0
  let tipsCents = 0
  let refundsCount = 0
  let refundsCents = 0
  let discountsCount = 0
  let discountsCents = 0
  let voidsCount = 0
  let voidsCents = 0

  const channels: ChannelBreakdown = { posCents: 0, telephoneCents: 0, onlineCents: 0, appCents: 0 }
  const dineLocation: DineLocationBreakdown = { dineInCents: 0, takeOutCents: 0 }
  const payments: PaymentBreakdown = { cashCents: 0, cardCents: 0, onlineCents: 0, otherCents: 0, receivablesCents: 0 }

  // Steuersplit aggregiert nach Steuersatz; Map<rate, accumulator>
  const taxAccumulator = new Map<number, { netCents: number; taxCents: number; grossCents: number }>()

  for (const order of sorted) {
    // Storno-Zählung getrennt führen, dann skippen — Stornos sind kein Umsatz.
    if (isCancelled(order)) {
      voidsCount++
      voidsCents += getOrderGrossCents(order)
      continue
    }

    // Refund-Zählung getrennt — wir zählen den ursprünglichen Brutto-Betrag
    // als refundsCents, fließt aber nicht in grossTotal.
    if (isRefunded(order)) {
      refundsCount++
      refundsCents += getOrderGrossCents(order)
      continue
    }

    const orderGross = getOrderGrossCents(order)
    const orderNet = getOrderNetCents(order)
    const orderTip = getOrderTipCents(order)

    grossTotalCents += orderGross
    netTotalCents += orderNet
    tipsCents += orderTip

    // Steuersplit aus taxSnapshot (vom POS verbindlich vorberechnet).
    // POS-Vertrag (bestätigt durch reale Order-Daten + die Geschwister-Felder
    // netto/brutto): `taxLine.amount` ist der NETTO-Anteil dieser Steuerstufe
    // (amount === netto bei Single-Rate-Orders), `taxLine.tax` die enthaltene
    // Steuer. Das Brutto der Stufe ist amount + tax. (Frühere Annahme „amount =
    // Brutto" war falsch und ließ Σ gross um Σ tax zu niedrig ausfallen →
    // financials.tax_split_mismatch im Persist-Step.)
    if (order.taxSnapshot?.taxes) {
      for (const taxLine of order.taxSnapshot.taxes) {
        const rate = taxLine.taxRate
        const net = toCents(taxLine.amount)
        const tax = toCents(taxLine.tax)
        const gross = net + tax
        const entry = taxAccumulator.get(rate) ?? { netCents: 0, taxCents: 0, grossCents: 0 }
        entry.netCents += net
        entry.taxCents += tax
        entry.grossCents += gross
        taxAccumulator.set(rate, entry)
      }
    }

    // Channel-Aggregation
    switch (order.orderChannel) {
      case OrderChannel.POS:
        channels.posCents += orderGross
        break
      case OrderChannel.TELEPHONE:
        channels.telephoneCents += orderGross
        break
      case OrderChannel.ONLINE:
        channels.onlineCents += orderGross
        break
      case OrderChannel.APP:
        channels.appCents += orderGross
        break
    }

    // DineLocation-Aggregation (relevant für Steuersatz-Erkennung in DE: 7% vs 19%)
    switch (order.dineLocation) {
      case DineLocation.DINE_IN:
        dineLocation.dineInCents += orderGross
        break
      case DineLocation.TAKE_OUT:
        dineLocation.takeOutCents += orderGross
        break
    }

    // Zahlungsart-Aggregation — drei Zweige, Forderung zuerst.
    //
    // Der Zweig steht bewusst NACH den Storno-/Refund-`continue`s (ein
    // stornierter Bon ist keine Forderung) und VOR der `tx.method`-Verteilung:
    // der POS bucht fuer ein angeschriebenes Essen zwar eine CASH-Transaktion,
    // aber es liegt kein Geld in der Lade. Wuerde sie verteilt, waere der
    // Kassensturz schon am Leistungstag zu hoch — genau der Bestandsfehler,
    // den dieser Umbau behebt.
    //
    // Der Zweig steuert exakt `gross - tip` bei, damit die Persist-Invariante
    // `Σ payments === grossTotal − tips` haelt.
    //
    // Im Bestellbetrieb entfaellt die Verteilung vollstaendig: Es gibt keine
    // erfassten Zahlungen, die man aufteilen koennte. Der Fallback-Zweig unten
    // wuerde sonst den kompletten Bestellwert nach „Sonstige" schieben — ein
    // Donut mit einem Sektor, der eine Nullaussage als Datum ausgibt. Die
    // Persist-Invariante `Σ payments === grossTotal − tips` wird dafuer
    // modus-bewusst uebersprungen (validateFinancials).
    if (ordersOnly) {
      // bewusst leer
    } else if (isOpenReceivable(order, options?.settlements)) {
      payments.receivablesCents = (payments.receivablesCents ?? 0) + (orderGross - orderTip)
    } else if (order.payment?.transactions && order.payment.transactions.length > 0) {
      for (const tx of order.payment.transactions) {
        addTransaction(payments, tx)
      }
    } else {
      // Fallback: abgeschlossener Verkauf ohne erfasste Zahlungs-Transaktionen
      // (z.B. Telefon-Order ohne POS-Zahlungsschritt, Legacy-/Sync-Daten). Die
      // konkrete Zahlungsart ist unbekannt → als „Sonstige" (otherCents) führen,
      // ohne Trinkgeld. So bleibt die Persist-Invariante
      // `Σ payments === grossTotal − tips` erhalten und der Tagesabschluss
      // schlägt nicht hart fehl; die nicht zugeordnete Summe ist im UI als
      // „Sonstige" sichtbar. Liegen Transaktionen vor, gilt weiter ihre Summe —
      // ein echter Mismatch (Transaktionen ≠ Umsatz) wird also nicht verdeckt.
      // Seit dem Forderungs-Zweig ist dieser Fall fuer angeschriebene Essen
      // unerreichbar — sie werden vorher abgefangen.
      payments.otherCents += orderGross - orderTip
    }

    // Rabatt-Zählung. `appliedDiscounts` ist führend (ADR 0030) — bis zu dieser
    // Änderung las die Aggregation AUSSCHLIESSLICH `order.discount`. Da der
    // discount-mutex das Legacy-Feld leert, sobald appliedDiscounts gesetzt sind,
    // zählte jeder über den POS gewährte Rabatt als 0 Rabatte / 0,00 €.
    //
    // `discountsCount` bleibt bewusst PRO ORDER (nicht pro Rabatt-Eintrag): Der
    // Wert speist die Rabatt-Quote der Cloud-Auswertung, also den Anteil
    // rabattierter Bestellungen. Eine Order mit zwei Rabatten ist eine
    // rabattierte Order, nicht zwei.
    const applied = Array.isArray(order.appliedDiscounts) ? order.appliedDiscounts : []
    if (applied.length > 0) {
      discountsCount++
      // `computedAmountCents` ist der von `computeOrderTax` zurückgeschriebene,
      // tatsächlich abgezogene Brutto-Betrag — keine Rückrechnung nötig. Bei
      // Bestands-Orders ohne Engine-Durchlauf steht dort 0; dann zählt die Order
      // als rabattiert mit 0 € statt mit einer geratenen Summe.
      for (const ad of applied) discountsCents += Math.max(0, Math.round(ad.computedAmountCents ?? 0))
    } else if (order.discount) {
      // Legacy-Fallback für Bestands-Orders von vor der Umstellung. Entfällt mit
      // dem Feld selbst (Schritt 3 von panary/panary-core#181).
      discountsCount++
      // `orderGross` ist der bereits rabattierte Brutto-Wert; bei PERCENT wird der
      // Abzug daraus zurückgerechnet, bei AMOUNT steht er direkt im Feld (Euro).
      if (order.discount.discountType === 'amount') {
        discountsCents += toCents(order.discount.discount)
      } else {
        discountsCents += Math.round((orderGross * order.discount.discount) / (100 - order.discount.discount))
      }
    }

    // Personalessen / Firmenkundenessen bleiben hier IM grossTotal —
    // separate KPIs liegen in meal-subsidies.ts.
    void isStaffMeal
    void isCorporateMeal
    void isRegularSale
  }

  // Map → sortiertes Array (kleinste Rate zuerst, deterministisch).
  // Im Bestellbetrieb bleibt der Split leer — siehe Options-Doku.
  const taxes: TaxSplitEntry[] = ordersOnly
    ? []
    : Array.from(taxAccumulator.entries())
        .sort(([a], [b]) => a - b)
        .map(([rate, agg]) => ({
          rate,
          netAmountCents: agg.netCents,
          taxAmountCents: agg.taxCents,
          grossAmountCents: agg.grossCents,
        }))

  return {
    grossTotalCents,
    netTotalCents,
    taxes,
    channels,
    dineLocation,
    payments,
    tipsCents,
    refundsCount,
    refundsCents,
    discountsCount,
    discountsCents,
    voidsCount,
    voidsCents,
  }
}

function addTransaction(payments: PaymentBreakdown, tx: Transaction): void {
  const amount = toCents(tx.amount)
  switch (tx.method) {
    case TransactionMethod.CASH:
      payments.cashCents += amount
      break
    case TransactionMethod.CARD:
      payments.cardCents += amount
      break
    case TransactionMethod.ONLINE:
      payments.onlineCents += amount
      break
    case TransactionMethod.OTHER:
      payments.otherCents += amount
      break
  }
}

/** Hilfsfunktion: Σ aller Channel-Cents (für Validierung). */
export function sumChannels(c: ChannelBreakdown): number {
  return sumCents([c.posCents, c.telephoneCents, c.onlineCents, c.appCents])
}

/** Hilfsfunktion: Σ aller Payment-Cents (für Validierung). */
export function sumPayments(p: PaymentBreakdown): number {
  return sumCents(PAYMENT_BUCKET_KEYS.map(key => p[key] ?? 0))
}

// Re-export für Konsumenten, die diese Werte direkt lesen wollen
export { PaymentState }
