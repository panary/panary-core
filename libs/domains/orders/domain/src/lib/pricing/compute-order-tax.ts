import { AppliedDiscount, Discount, GenericOrderLineItem, Order, OrderLineItem, TaxInfo } from '../order.schema'
import { distributeByLargestRemainder, fromCents, multiplyCents, netFromGross, sumCents, toCents } from './money'

// Kanonische, cents-interne Preis-/Steuer-Engine für den Order-`taxSnapshot`.
//
// Single Source of Truth: api-edge-Hook (`calculate-tax-details.ts`) und
// Frontend-Util (`prices-and-taxes.ts → calculateTaxSummary`) rufen diese Funktion.
//
// Eigenschaften:
//   - `price`-Felder sind BRUTTO (inkl. MwSt). MwSt wird fiskalisch korrekt
//     EXTRAHIERT (`netFromGross`) — Brutto bleibt, Netto/Steuer-Split ist korrekt.
//   - Pro Steuersatz invariant: netto + steuer === brutto (cent-genau).
//   - Rabatte wirken auf BRUTTO; netto/steuer werden danach pro Eimer neu extrahiert
//     → Tax-Integrität automatisch erhalten.
//   - Reihenfolge: erst LINE-Rabatte (auf der jeweiligen Position), dann ORDER-Rabatte
//     (auf die verbleibende Summe). Mehrere ORDER-Rabatte sequenziell in Array-Reihenfolge.
//   - Festbeträge werden via Largest-Remainder summen-exakt über Steuersätze verteilt.
//
// Rabattquellen (Priorität):
//   1. `order.appliedDiscounts[]` — wenn gesetzt, führend (Mehrfach-/Positionsrabatte).
//   2. `order.discount` — Legacy-Einzel-Order-Rabatt (Rückwärtskompatibilität).
//
// NEBENEFFEKT: Bei `appliedDiscounts` schreibt die Engine `computedAmountCents` je
// Eintrag zurück (tatsächlich abgezogener Brutto-Betrag) — bewusst, damit der Bon-
// Snapshot die realen Beträge führt.
//
// „OHNE"-Modifier (amount −1) sind preisneutral — siehe `modifierGrossCents`.
//
// Positions-Arithmetik: Hauptartikel price×amount, Modifier price×modifier.amount
// (nicht mit Parent-Menge skaliert — Bestandsverhalten), Menü-Beilage/-Getränk
// price×amount×Zeilen-Menge (PRO Menü; Entscheidung 2026-07-04 — vorher einmalig,
// dadurch war der taxSnapshot bei Menü-Menge > 1 fiskal zu niedrig; jetzt identisch
// zum Reporting-Fallback `order-total.ts`).

interface RateBucket {
  taxRate: number
  grossCents: number
}

interface LineGross {
  lineItemId: string
  taxRate: number
  grossCents: number
}

/**
 * Brutto-Beitrag eines Modifiers in Cents.
 *
 * Ein „OHNE"-Modifier (`amount` −1, gesetzt von `decreaseExtra()` im POS-
 * Bestelldialog) trägt NICHTS bei: das Extra wurde nie berechnet, also gibt es
 * beim Weglassen auch keine Gutschrift. Ohne diese Klemme zöge „Margherita ohne
 * Bacon" den Bacon-Aufpreis vom Zeilenpreis ab, während der Bon die OHNE-Zeile
 * ohne Betrag druckt — der Beleg rechnete sich nicht auf.
 *
 * `scale` bildet die bestehende Asymmetrie ab: im Legacy-Pfad zählt der
 * Modifier einmal (Bestandsverhalten), im Komponenten-Pfad parent-skaliert.
 */
function modifierGrossCents(extra: GenericOrderLineItem, scale = 1): number {
  if (!extra.price || extra.amount <= 0) return 0
  return multiplyCents(toCents(extra.price), extra.amount * scale)
}

function lineGrossCents(line: OrderLineItem): number {
  let cents = 0
  if (line.price) cents += multiplyCents(toCents(line.price), line.amount)
  ;(line.modifiers ?? []).forEach((extra: GenericOrderLineItem) => {
    cents += modifierGrossCents(extra)
  })
  // Beilage/Getränk zählen PRO Menü: 2 Menüs = 2 Aufpreise (Entscheidung 2026-07-04).
  if (line.menuSideDish && line.menuSideDish.price) {
    cents += multiplyCents(toCents(line.menuSideDish.price), line.menuSideDish.amount * line.amount)
  }
  if (line.menuDrink && line.menuDrink.price) {
    cents += multiplyCents(toCents(line.menuDrink.price), line.menuDrink.amount * line.amount)
  }
  return cents
}

const rateOf = (it: { taxInside: number; taxOutside: number }, dineIn: boolean): number =>
  dineIn ? it.taxInside : it.taxOutside

/**
 * Bundle-Komponenten einer Zeile: neues `components[]` bevorzugt, sonst Legacy
 * `menuSideDish`/`menuDrink` (Reihenfolge wie bisher: Beilage, dann Getränk).
 */
function lineComponents(line: OrderLineItem): GenericOrderLineItem[] {
  if (Array.isArray(line.components) && line.components.length > 0) {
    return line.components as GenericOrderLineItem[]
  }
  const legacy: GenericOrderLineItem[] = []
  if (line.menuSideDish) legacy.push(line.menuSideDish)
  if (line.menuDrink) legacy.push(line.menuDrink)
  return legacy
}

/**
 * Brutto-Atome je Zeile, jeweils mit eigenem Steuersatz.
 *  - ROLLUP / à-la-carte (`components[]`, kein FIXED): Hauptartikel + Modifier am
 *    Zeilensatz, jede Komponente am EIGENEN Steuersatz (parent-skaliert) →
 *    mehrsatzige Menüs werden fiskalisch korrekt gesplittet.
 *  - FIXED_PROPORTIONAL (`bundlePricingMode === 'FIXED_PROPORTIONAL'`): `line.price`
 *    ist der FESTPREIS (Brutto). Er wird summen-exakt (`distributeByLargestRemainder`)
 *    über die Komponenten-NORMALPREISE verteilt — jede Komponente behält ihren
 *    eigenen Steuersatz (Marktwertmethode). Das Hauptgericht ist dabei eine
 *    Komponente (role 'main') mit eigenem Normalpreis-Gewicht; ist kein Gewicht
 *    gesetzt, trägt der Writer es als Restbetrag (Festpreis − Σ übrige) ein →
 *    Verteilung bleibt exakt. Ad-hoc-Modifier liegen ON TOP (à-la-carte, am Zeilensatz).
 *  - Legacy-Zeilen (ohne `components[]`): unverändert — alles am Zeilensatz
 *    summiert (kein Snapshot-Drift für Bestands-Orders).
 */
function collectLineAtoms(line: OrderLineItem, dineIn: boolean): LineGross[] {
  const lineRate = rateOf(line, dineIn)
  const out: LineGross[] = []
  if (!(Array.isArray(line.components) && line.components.length > 0)) {
    out.push({ lineItemId: line._id, taxRate: lineRate, grossCents: lineGrossCents(line) })
    return out
  }

  // FIXED_PROPORTIONAL: Festpreis (`line.price`) wird über die Komponenten-
  // Normalpreise verteilt; jede Komponente behält ihren Steuersatz.
  if (line.bundlePricingMode === 'FIXED_PROPORTIONAL') {
    const fixedGross = line.price ? multiplyCents(toCents(line.price), line.amount) : 0
    const comps = lineComponents(line).filter((c: GenericOrderLineItem) => !!c.price)
    const weights = comps.map((c: GenericOrderLineItem) => multiplyCents(toCents(c.price as number), c.amount * line.amount))
    const totalWeight = sumCents(weights)
    if (fixedGross > 0 && totalWeight > 0) {
      const allocations = distributeByLargestRemainder(fixedGross, weights)
      comps.forEach((c: GenericOrderLineItem, i: number) => {
        out.push({ lineItemId: line._id, taxRate: rateOf(c, dineIn), grossCents: allocations[i] })
      })
    } else if (fixedGross > 0) {
      out.push({ lineItemId: line._id, taxRate: lineRate, grossCents: fixedGross })
    }
    // Ad-hoc-Modifier sind NICHT Teil des Festpreises → on top am Zeilensatz.
    ;(line.modifiers ?? []).forEach((extra: GenericOrderLineItem) => {
      const gross = modifierGrossCents(extra, line.amount)
      if (gross !== 0) {
        out.push({ lineItemId: line._id, taxRate: lineRate, grossCents: gross })
      }
    })
    return out
  }

  let mainGross = line.price ? multiplyCents(toCents(line.price), line.amount) : 0
  ;(line.modifiers ?? []).forEach((extra: GenericOrderLineItem) => {
    mainGross += modifierGrossCents(extra, line.amount)
  })
  out.push({ lineItemId: line._id, taxRate: lineRate, grossCents: mainGross })
  for (const c of lineComponents(line)) {
    if (c.price) {
      out.push({
        lineItemId: line._id,
        taxRate: rateOf(c, dineIn),
        grossCents: multiplyCents(toCents(c.price), c.amount * line.amount),
      })
    }
  }
  return out
}

function collectLineGrosses(order: Order): LineGross[] {
  const dineIn = order.dineLocation === 'dine-in'
  const out: LineGross[] = []
  for (const line of order.lineItems) {
    out.push(...collectLineAtoms(line, dineIn))
  }
  return out
}

/**
 * Brutto-Zeilenpreis in Cents — die geteilte Zeilenpreis-Quelle für POS-Anzeige
 * (`prices-and-taxes.ts`) und Bon-Renderer (`order-receipt.renderer.ts`).
 * Summiert exakt die Brutto-Atome, die auch `computeOrderTax` (vor Rabatten)
 * bildet → Anzeige == Engine per Konstruktion (Entscheidung 2026-07-04).
 * Der Steuersatz-Kontext (dine-in/take-out) beeinflusst nur den Steuer-Split,
 * nicht das Brutto — für den Zeilenpreis daher irrelevant.
 */
export function lineItemGrossCents(line: OrderLineItem): number {
  return sumCents(collectLineAtoms(line, true).map(atom => atom.grossCents))
}

function bucketize(lines: LineGross[]): RateBucket[] {
  const buckets: RateBucket[] = []
  for (const l of lines) {
    if (l.grossCents <= 0) continue
    const existing = buckets.find(b => b.taxRate === l.taxRate)
    if (existing) existing.grossCents += l.grossCents
    else buckets.push({ taxRate: l.taxRate, grossCents: l.grossCents })
  }
  return buckets
}

/** Rabattbetrag in Cents für eine Brutto-Basis, geklemmt auf [0, base]. */
function discountAmountCents(valueType: string, valuePercent: number, valueCents: number, baseGrossCents: number): number {
  if (baseGrossCents <= 0) return 0
  const raw = valueType === 'percent' ? Math.round((baseGrossCents * valuePercent) / 100) : valueCents
  return Math.min(Math.max(0, raw), baseGrossCents)
}

/** Verteilt einen Order-Rabattbetrag (Cents) summen-exakt über die Eimer (in-place). */
function applyOrderDiscountCents(buckets: RateBucket[], discountCents: number): void {
  const totalGross = sumCents(buckets.map(b => b.grossCents))
  if (totalGross <= 0 || discountCents <= 0) return
  const clamped = Math.min(discountCents, totalGross)
  const allocations = distributeByLargestRemainder(clamped, buckets.map(b => b.grossCents))
  buckets.forEach((b, i) => {
    b.grossCents -= allocations[i]
  })
}

function bucketsToTaxInfo(buckets: RateBucket[]): TaxInfo {
  const positive = buckets.filter(b => b.grossCents > 0)
  const taxes = positive.map(b => {
    const net = netFromGross(b.grossCents, b.taxRate)
    return { taxRate: b.taxRate, amount: fromCents(net), tax: fromCents(b.grossCents - net) }
  })
  const nettoCents = sumCents(positive.map(b => netFromGross(b.grossCents, b.taxRate)))
  const bruttoCents = sumCents(positive.map(b => b.grossCents))
  return { taxes, netto: fromCents(nettoCents), brutto: fromCents(bruttoCents) }
}

/** Wendet appliedDiscounts an (LINE zuerst, dann ORDER) und schreibt computedAmountCents zurück. */
function applyAppliedDiscounts(lines: LineGross[], applied: AppliedDiscount[]): RateBucket[] {
  // 1. LINE-Rabatte auf die jeweilige Position. Eine Zeile kann mehrere
  //    Steuer-Atome haben (Hauptsatz + Komponenten-Sätze) → der Rabatt wird
  //    summen-exakt über die Atome dieser Zeile verteilt (largest-remainder).
  //    Genau dieser Pfad bildet auch Festpreis-Menüs ab (Menü-Rabatt = Σ
  //    Normalpreise − Festpreis): das Brutto sinkt auf den Festpreis, pro
  //    Steuersatz korrekt.
  for (const ad of applied) {
    if (ad.target !== 'line' || !ad.lineItemId) continue
    const atoms = lines.filter(l => l.lineItemId === ad.lineItemId)
    const lineTotal = sumCents(atoms.map(l => l.grossCents))
    const amount = discountAmountCents(ad.valueType, ad.valuePercent, ad.valueCents, lineTotal)
    if (amount > 0 && lineTotal > 0) {
      const allocations = distributeByLargestRemainder(amount, atoms.map(l => l.grossCents))
      atoms.forEach((l, i) => {
        l.grossCents -= allocations[i]
      })
    }
    ad.computedAmountCents = amount
  }

  // 2. ORDER-Rabatte sequenziell auf die verbleibende Summe.
  const buckets = bucketize(lines)
  for (const ad of applied) {
    if (ad.target !== 'order') continue
    const totalGross = sumCents(buckets.map(b => b.grossCents))
    const amount = discountAmountCents(ad.valueType, ad.valuePercent, ad.valueCents, totalGross)
    applyOrderDiscountCents(buckets, amount)
    ad.computedAmountCents = amount
  }
  return buckets
}

/**
 * Berechnet den `taxSnapshot` einer Order. Deterministisch, cents-intern, Ausgabe in Euro.
 * Seiteneffekt: füllt `computedAmountCents` der `order.appliedDiscounts`-Einträge.
 */
export function computeOrderTax(order: Order): TaxInfo {
  const lines = collectLineGrosses(order)

  if (order.appliedDiscounts && order.appliedDiscounts.length > 0) {
    const buckets = applyAppliedDiscounts(lines, order.appliedDiscounts)
    return bucketsToTaxInfo(buckets)
  }

  // Legacy-Fallback: einzelner Order-Rabatt.
  const buckets = bucketize(lines)
  if (order.discount) {
    applyLegacyDiscount(buckets, order.discount)
  }
  return bucketsToTaxInfo(buckets)
}

function applyLegacyDiscount(buckets: RateBucket[], discount: Discount): void {
  const totalGross = sumCents(buckets.map(b => b.grossCents))
  if (totalGross <= 0) return
  const amount =
    discount.discountType === 'percent'
      ? Math.round((totalGross * discount.discount) / 100)
      : toCents(discount.discount)
  applyOrderDiscountCents(buckets, amount)
}
