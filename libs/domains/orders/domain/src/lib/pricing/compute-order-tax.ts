import { Discount, GenericOrderLineItem, Order, OrderLineItem, TaxInfo } from '../order.schema'
import { distributeByLargestRemainder, fromCents, multiplyCents, netFromGross, sumCents, toCents } from './money'

// Kanonische, cents-interne Preis-/Steuer-Engine für den Order-`taxSnapshot`.
//
// Single Source of Truth: sowohl der api-edge-Hook (`calculate-tax-details.ts`)
// als auch der Frontend-Util (`prices-and-taxes.ts → calculateTaxSummary`) rufen
// diese Funktion. Dadurch entfällt die frühere Duplikation der Steuer-/Rabatt-
// Arithmetik in zwei divergierenden Implementierungen.
//
// Wichtige Eigenschaften:
//   - `price`-Felder sind BRUTTO (Bruttopreise inkl. MwSt — Gastronomie-Standard).
//   - MwSt wird fiskalisch korrekt EXTRAHIERT (`netFromGross`), nicht aufgeschlagen.
//     Der Brutto-Betrag (was der Kunde zahlt) bleibt unverändert; nur der
//     Netto-/Steuer-Split ist korrekt. Konsistent zum Reporting-Aggregator.
//   - Pro Steuersatz gilt invariant: netto + steuer === brutto (cent-genau).
//   - Rabatte werden auf BRUTTO angewandt, danach wird netto/steuer pro Eimer neu
//     extrahiert → Tax-Integrität bleibt automatisch erhalten.
//   - Festbetrags-Rabatte werden via Largest-Remainder proportional zum Brutto
//     verteilt (summen-exakt, kein Cent-Drift).

// Arithmetik der Positionsbestandteile bewusst identisch zur bisherigen Engine:
//   - Hauptartikel: price × amount
//   - Modifier: price × modifier.amount (NICHT mit Parent-Menge skaliert)
//   - Menü-Beilage / -Getränk: price (ohne × amount)
// Eine Vereinheitlichung mit der Aggregator-Logik (die Modifier/Menü mit der
// Parent-Menge skaliert) ist bewusst NICHT Teil dieser Konsolidierung, da sie die
// Brutto-Summen bestehender Bons verschieben würde.

interface RateBucket {
  taxRate: number
  grossCents: number
}

function addToBucket(buckets: RateBucket[], taxRate: number, grossCents: number): void {
  if (grossCents <= 0) return
  const existing = buckets.find(b => b.taxRate === taxRate)
  if (existing) {
    existing.grossCents += grossCents
  } else {
    buckets.push({ taxRate, grossCents })
  }
}

function lineItemGrossByRate(line: OrderLineItem, taxRate: number, buckets: RateBucket[]): void {
  if (line.price) {
    addToBucket(buckets, taxRate, multiplyCents(toCents(line.price), line.amount))
  }
  line.modifiers.forEach((extra: GenericOrderLineItem) => {
    if (extra.price) {
      addToBucket(buckets, taxRate, multiplyCents(toCents(extra.price), extra.amount))
    }
  })
  if (line.menuSideDish && line.menuSideDish.price) {
    addToBucket(buckets, taxRate, toCents(line.menuSideDish.price))
  }
  if (line.menuDrink && line.menuDrink.price) {
    addToBucket(buckets, taxRate, toCents(line.menuDrink.price))
  }
}

function collectBuckets(order: Order): RateBucket[] {
  const dineIn = order.dineLocation === 'dine-in'
  const buckets: RateBucket[] = []
  order.lineItems.forEach((line: OrderLineItem) => {
    const taxRate = dineIn ? line.taxInside : line.taxOutside
    lineItemGrossByRate(line, taxRate, buckets)
  })
  return buckets
}

/**
 * Wendet einen Order-Level-Rabatt auf die Brutto-Beträge der Eimer an (in-place).
 * PERCENT und AMOUNT werden beide über eine summen-exakte Brutto-Verteilung gelöst,
 * damit Reihenfolge mehrerer Rabatte deterministisch bleibt und kein Cent verloren geht.
 */
function applyOrderDiscount(buckets: RateBucket[], discount: Discount): void {
  const totalGross = sumCents(buckets.map(b => b.grossCents))
  if (totalGross <= 0) return

  let discountCents: number
  if (discount.discountType === 'percent') {
    discountCents = Math.round((totalGross * discount.discount) / 100)
  } else {
    discountCents = toCents(discount.discount)
  }
  if (discountCents <= 0) return
  if (discountCents > totalGross) discountCents = totalGross

  const allocations = distributeByLargestRemainder(
    discountCents,
    buckets.map(b => b.grossCents),
  )
  buckets.forEach((b, i) => {
    b.grossCents -= allocations[i]
  })
}

function bucketsToTaxInfo(buckets: RateBucket[]): TaxInfo {
  const taxes = buckets
    .filter(b => b.grossCents > 0)
    .map(b => {
      const net = netFromGross(b.grossCents, b.taxRate)
      const tax = b.grossCents - net
      return { taxRate: b.taxRate, amount: fromCents(net), tax: fromCents(tax) }
    })
  const nettoCents = sumCents(buckets.map(b => (b.grossCents > 0 ? netFromGross(b.grossCents, b.taxRate) : 0)))
  const bruttoCents = sumCents(buckets.map(b => Math.max(0, b.grossCents)))
  return { taxes, netto: fromCents(nettoCents), brutto: fromCents(bruttoCents) }
}

/**
 * Berechnet den `taxSnapshot` einer Order: Steuer-Split pro Satz, Netto, Brutto.
 * Deterministisch, idempotent, keine I/O. Cents-intern, Ausgabe in Euro.
 */
export function computeOrderTax(order: Order): TaxInfo {
  const buckets = collectBuckets(order)
  if (order.discount) {
    applyOrderDiscount(buckets, order.discount)
  }
  return bucketsToTaxInfo(buckets)
}
