import {
  computeOrderTax,
  fromCents,
  GenericOrderLineItem,
  isUnstampedPaymentPlaceholder,
  lineItemGrossCents,
  modifierLineGrossCents,
  Order,
  OrderLineItem,
  sumCents,
  TaxInfo,
  toCents,
} from '@panary/orders/domain'

// POS-Anzeige-Preise — delegieren vollständig an die kanonische Cents-Engine
// (@panary/orders/domain): Zeilenpreise über die geteilte Quelle
// `lineItemGrossCents`, Summen mit Rabatt über `computeOrderTax`.
//
// Entscheidung 2026-07-04 (bindend): Die Engine ist überall führend; die frühere
// Float-Logik dieser Datei wurde bewusst entfernt. Damit entfallen die
// dokumentierten Drift-Fälle (siehe prices-and-taxes.spec.ts):
//   - FIXED_PROPORTIONAL: Ad-hoc-Modifier zählen jetzt on top des Festpreises.
//   - Prozentrabatt-Halbcents runden wie die Engine (Rabattbetrag half-up),
//     nicht mehr über toFixed am Endbetrag.
//   - General-Menü-Preise (generalSideDish-/generalDrinkPrice) werden NICHT mehr
//     aufgeschlagen — die Engine kennt sie nicht, der fakturierte Betrag
//     (taxSnapshot/payment) enthielt sie nie. Der Aufpreis-Ausweis im Warenkorb
//     (`menuComponentSurcharge`, unten) zeigt price − generalPrice,
//     beim Festpreis-Menü (FIXED_PROPORTIONAL) aber nichts — wie der Bon (core#781).

/** Zeilenpreis OHNE Ad-hoc-Modifier (Menü-Bestandteile inklusive). */
export function calculateArticlePriceWithoutExtras(articleItem: OrderLineItem): number {
  return fromCents(lineItemGrossCents({ ...articleItem, modifiers: [] }))
}

/**
 * Betrag eines Modifiers auf seiner Zeile — cent-identisch zur Engine (#698): bei
 * `modifierScope: 'unit'` der Aufpreis für alle Stück, sonst einmal je Zeile.
 */
export function calculateModifierPrice(articleItem: OrderLineItem, modifier: GenericOrderLineItem): number {
  return fromCents(modifierLineGrossCents(articleItem, modifier))
}

/** Voller Zeilenpreis inkl. Modifier — cent-identisch zur Engine. */
export function calculateArticlePrice(articleItem: OrderLineItem): number {
  return fromCents(lineItemGrossCents(articleItem))
}

export function calculateSumPriceSeperated(
  articleItems: OrderLineItem[],
  combinations: Array<OrderLineItem[]>,
): number {
  const articleCents = articleItems.map(article => lineItemGrossCents(article))
  const comboCents = combinations.map(articles => sumCents(articles.map(article => lineItemGrossCents(article))))
  return fromCents(sumCents([...articleCents, ...comboCents]))
}

export function calculateSumPrice(orderItem: Order): number {
  return fromCents(sumCents(orderItem.lineItems.map(article => lineItemGrossCents(article))))
}

/**
 * Betrag einer gespeicherten Bestellung, wie ihn Bon und Tagesabschluss führen (#703):
 * gestempelte Zahlung, sonst `taxSnapshot.brutto`, sonst die Engine. Dieselbe Reihenfolge wie
 * `getOrderGrossCents` im Aggregator — der Verlauf zeigt so keine dritte Zahl neben Bon und
 * Bericht. Bis #703 summierte der Verlauf `price × amount` und das Altfeld `extras`; Modifier,
 * Rabatte und Menü-Bestandteile fehlten.
 */
export function calculateOrderTotal(order: Order): number {
  if (order.payment?.totalAmount != null && !isUnstampedPaymentPlaceholder(order)) return order.payment.totalAmount
  if (order.taxSnapshot?.brutto != null) return order.taxSnapshot.brutto
  return computeOrderTax(structuredClone(order)).brutto
}

/** Brutto-Summe inkl. Rabatt — identisch zu `computeOrderTax(order).brutto`. */
export function calculateSumPriceWithDiscountDetails(orderItem: Order): number {
  return computeOrderTax(orderItem).brutto
}

export function calculateCombinationPrice(combination: Array<OrderLineItem>): number {
  return fromCents(sumCents(combination.map(article => lineItemGrossCents(article))))
}

// Delegiert an die kanonische Engine `computeOrderTax` (@panary/orders/domain):
// cents-intern, fiskalisch korrekte MwSt-Extraktion, Single Source of Truth.
export function calculateTaxSummary(order: Order): TaxInfo {
  return computeOrderTax(order)
}

/**
 * Aufpreis einer Menü-Komponente (Beilage/Getränk) für die Anzeige an der Kasse, je Stück —
 * Warenkorb und „Offene Bestellungen“ (core#807) rechnen damit dasselbe. Beim Festpreis-Menü
 * (`FIXED_PROPORTIONAL`) ist die Komponente im Festpreis enthalten — die Engine verteilt
 * `line.price` über die Komponenten und schlägt nichts auf, der Bon weist deshalb ebenfalls keinen
 * Aufpreis aus (`order-receipt.renderer.ts`, `appendMenuComponentLine`). Ein „+€…" stünde dort
 * als Zuschlag, der nie berechnet wird (core#781).
 */
export function menuComponentSurcharge(
  line: Pick<OrderLineItem, 'bundlePricingMode'>,
  component: { price?: number | null } | null | undefined,
  generalPrice: number,
): number {
  if (!component || line.bundlePricingMode === 'FIXED_PROPORTIONAL') return 0
  return fromCents(Math.max(0, toCents(component.price ?? 0) - toCents(generalPrice)))
}
