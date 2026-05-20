import {
  Order,
  OrderChannel,
  DineLocation,
  TransactionMethod,
  PaymentState,
  Transaction,
} from '@panary/orders/domain'
import { toCents, sumCents } from './money'
import { isCancelled, isRefunded, isRegularSale, isStaffMeal, isCorporateMeal } from './classifications'
import { getOrderGrossCents, getOrderNetCents, getOrderTipCents } from './order-total'

/** Steuersplit-Eintrag pro Steuersatz (z. B. 7%, 19%). */
export interface TaxSplitEntry {
  rate: number              // 7, 19, ...
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
}

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
  discountsCents: number       // Summe der gewährten Rabatte (rabattierter Brutto-Anteil)
  voidsCount: number
  voidsCents: number           // Stornierte Bons-Brutto
}

const ZERO_FINANCIALS: FinancialsAggregate = Object.freeze({
  grossTotalCents: 0,
  netTotalCents: 0,
  taxes: [],
  channels: { posCents: 0, telephoneCents: 0, onlineCents: 0, appCents: 0 },
  dineLocation: { dineInCents: 0, takeOutCents: 0 },
  payments: { cashCents: 0, cardCents: 0, onlineCents: 0, otherCents: 0 },
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
export function aggregateFinancials(orders: ReadonlyArray<Order>): FinancialsAggregate {
  if (orders.length === 0) return { ...ZERO_FINANCIALS, taxes: [] }

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
  const payments: PaymentBreakdown = { cashCents: 0, cardCents: 0, onlineCents: 0, otherCents: 0 }

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
    if (order.taxSnapshot?.taxes) {
      for (const taxLine of order.taxSnapshot.taxes) {
        // taxLine.amount = Brutto-Anteil dieser Steuerstufe; taxLine.tax = enthaltene Steuer
        const rate = taxLine.taxRate
        const gross = toCents(taxLine.amount)
        const tax = toCents(taxLine.tax)
        const net = gross - tax
        const entry = taxAccumulator.get(rate) ?? { netCents: 0, taxCents: 0, grossCents: 0 }
        entry.netCents += net
        entry.taxCents += tax
        entry.grossCents += gross
        taxAccumulator.set(rate, entry)
      }
    }

    // Channel-Aggregation
    switch (order.orderChannel) {
      case OrderChannel.POS:       channels.posCents += orderGross; break
      case OrderChannel.TELEPHONE: channels.telephoneCents += orderGross; break
      case OrderChannel.ONLINE:    channels.onlineCents += orderGross; break
      case OrderChannel.APP:       channels.appCents += orderGross; break
    }

    // DineLocation-Aggregation (relevant für Steuersatz-Erkennung in DE: 7% vs 19%)
    switch (order.dineLocation) {
      case DineLocation.DINE_IN:  dineLocation.dineInCents += orderGross; break
      case DineLocation.TAKE_OUT: dineLocation.takeOutCents += orderGross; break
    }

    // Zahlungsart-Aggregation
    if (order.payment?.transactions) {
      for (const tx of order.payment.transactions) {
        addTransaction(payments, tx)
      }
    }

    // Rabatt-Zählung
    if (order.discount) {
      discountsCount++
      // Konservative Schätzung: discount.discount ist der Wert (bei AMOUNT)
      // bzw. der Prozentsatz (bei PERCENT). Wir aggregieren nur den
      // tatsächlich abgezogenen Betrag, der im POS bereits in
      // payment.totalAmount eingerechnet ist; für reine Statistik:
      // bei AMOUNT direkt summieren, bei PERCENT mit grossTotal berechnen
      if (order.discount.discountType === 'amount') {
        discountsCents += toCents(order.discount.discount)
      } else {
        // PERCENT: rabattierter Bruttoanteil
        discountsCents += Math.round((orderGross * order.discount.discount) / (100 - order.discount.discount))
      }
    }

    // Personalessen / Firmenkundenessen bleiben hier IM grossTotal —
    // separate KPIs liegen in meal-subsidies.ts.
    void isStaffMeal
    void isCorporateMeal
    void isRegularSale
  }

  // Map → sortiertes Array (kleinste Rate zuerst, deterministisch)
  const taxes: TaxSplitEntry[] = Array.from(taxAccumulator.entries())
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
    case TransactionMethod.CASH:   payments.cashCents += amount; break
    case TransactionMethod.CARD:   payments.cardCents += amount; break
    case TransactionMethod.ONLINE: payments.onlineCents += amount; break
    case TransactionMethod.OTHER:  payments.otherCents += amount; break
  }
}

/** Hilfsfunktion: Σ aller Channel-Cents (für Validierung). */
export function sumChannels(c: ChannelBreakdown): number {
  return sumCents([c.posCents, c.telephoneCents, c.onlineCents, c.appCents])
}

/** Hilfsfunktion: Σ aller Payment-Cents (für Validierung). */
export function sumPayments(p: PaymentBreakdown): number {
  return sumCents([p.cashCents, p.cardCents, p.onlineCents, p.otherCents])
}

// Re-export für Konsumenten, die diese Werte direkt lesen wollen
export { PaymentState }
