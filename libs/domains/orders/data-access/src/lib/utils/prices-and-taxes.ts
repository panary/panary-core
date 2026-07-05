import {
  computeOrderTax,
  fromCents,
  lineItemGrossCents,
  Order,
  OrderLineItem,
  sumCents,
  TaxInfo,
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
//     (taxSnapshot/payment) enthielt sie nie. Der Aufpreis-Ausweis im Template
//     (menuSideDish.price − generalPrice) bleibt davon unberührt.

/** Zeilenpreis OHNE Ad-hoc-Modifier (Menü-Bestandteile inklusive). */
export function calculateArticlePriceWithoutExtras(articleItem: OrderLineItem): number {
  return fromCents(lineItemGrossCents({ ...articleItem, modifiers: [] }))
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
