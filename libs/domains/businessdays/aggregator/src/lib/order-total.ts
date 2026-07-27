import { Order, OrderLineItem, GenericOrderLineItem } from '@panary/orders/domain'
import { toCents, multiplyCents, sumCents } from './money'

// Kanonische Order-Total-Berechnung.
//
// Source of Truth-Priorität:
//   1. order.payment.totalAmount  → wenn gesetzt, ist das die autoritative Summe
//      (vom POS bei Bezahlung gestempelt, kein Float-Drift, da round-trip-fixed)
//   2. taxSnapshot.brutto         → wenn payment fehlt, aber Tax-Snapshot da ist
//   3. Σ lineItems (incl. Modifier, Menu-Items)  → letzter Fallback
//
// Der Legacy-Dashboard-Code (`dashboard.store.ts:123-130`) hatte einen
// Fallback `Σ price × amount`, der Modifier komplett ignorierte und Float-
// Multiplikation verwendete. Das produziert bis zu ±5 ct Drift pro Order und
// ist nicht KassenSichV-tauglich. Wir korrigieren das hier zentral.

/** Gesamt-Cents einer Order. Idempotent, deterministisch, keine I/O. */
export function getOrderGrossCents(order: Order): number {
  // Primary: Payment-Snapshot
  if (order.payment?.totalAmount !== undefined && order.payment?.totalAmount !== null) {
    return toCents(order.payment.totalAmount)
  }

  // Secondary: Tax-Snapshot (vom POS pre-payment berechnet)
  if (order.taxSnapshot?.brutto !== undefined && order.taxSnapshot?.brutto !== null) {
    return toCents(order.taxSnapshot.brutto)
  }

  // Fallback: aus Line-Items rekonstruieren, inklusive Modifier und Menu-Items
  return computeGrossFromLineItems(order.lineItems ?? [])
}

/** Netto-Cents einer Order — bevorzugt taxSnapshot, sonst aus Brutto rückgerechnet. */
export function getOrderNetCents(order: Order): number {
  if (order.taxSnapshot?.netto !== undefined && order.taxSnapshot?.netto !== null) {
    return toCents(order.taxSnapshot.netto)
  }
  // Ohne taxSnapshot kennen wir den Steuersplit nicht — Brutto = Netto als
  // Notfall-Fallback. Caller sollte das via aggregator.validations erkennen.
  return getOrderGrossCents(order)
}

/** Trinkgeld-Cents einer Order. */
export function getOrderTipCents(order: Order): number {
  return toCents(order.payment?.tipAmount ?? 0)
}

/**
 * Berechnet die Brutto-Summe einer Line-Items-Liste inklusive Modifier
 * und Menü-Bestandteile (Drink + Side).
 *
 * Wichtig:
 *   - `amount` ist die Stückzahl (typischerweise Integer, kann aber bei
 *     Gewichts-Produkten dezimal sein).
 *   - `price` ist der Einzelpreis pro Stück.
 *   - Modifier addieren sich on-top zum Hauptprodukt (`price` × `amount`).
 *   - Menu-Drink / Menu-Side sind separate Line-Items mit eigenem Preis.
 */
export function computeGrossFromLineItems(lineItems: OrderLineItem[]): number {
  const lineCents = lineItems.map(line => computeLineItemGrossCents(line))
  return sumCents(lineCents)
}

/**
 * Modifier-Brutto einer Zeile in Cents.
 *
 * Modifier mit `pricingMode === 'HIGHEST'` werden nach `topic` gruppiert; je
 * HIGHEST-Gruppe zählt nur der HÖCHSTE Einzel-Aufpreis (`price × amount ×
 * parentAmount`), nicht die Summe (Pizzableche-Regel). Alle übrigen Modifier
 * (SUM/kein Modus) werden regulär summiert.
 *
 * Konsistenz-Hinweis: Der POS nullt bei HIGHEST-Gruppen die unterlegenen
 * Aufpreise bereits beim Erzeugen der Order (Snapshot). Diese Aggregation ist
 * der Fallback-Pfad und rechnet auch dann korrekt, wenn die Preise NICHT
 * genullt wurden (z.B. Fremd-erzeugte Orders) — der gestempelte `pricingMode`
 * macht das deterministisch.
 */
function computeModifierGrossCents(modifiers: GenericOrderLineItem[], parentAmount: number): number {
  const highestByTopic = new Map<string, number>()
  const regularCents: number[] = []

  for (const m of modifiers) {
    // „OHNE"-Modifier (amount −1, POS-Marker aus `decreaseExtra()`) sind
    // preisneutral: das Extra wurde nie berechnet, also gibt es beim Weglassen
    // keine Gutschrift. Muss zur Engine `computeOrderTax` passen, sonst driftet
    // der Reporting-Fallback vom `taxSnapshot` ab.
    const cents = m.amount <= 0 ? 0 : computeGenericGrossCents(m, parentAmount)
    if (m.pricingMode === 'HIGHEST') {
      const key = m.topic ?? ''
      const current = highestByTopic.get(key) ?? 0
      if (cents > current) highestByTopic.set(key, cents)
    } else {
      regularCents.push(cents)
    }
  }

  return sumCents([...regularCents, ...highestByTopic.values()])
}

function computeLineItemGrossCents(line: OrderLineItem): number {
  const base = multiplyCents(toCents(line.price), line.amount)
  const modifierGross = computeModifierGrossCents(line.modifiers ?? [], line.amount)

  // FIXED_PROPORTIONAL: `line.price` IST der Festpreis (Komponenten sind darin
  // eingerechnet) → Komponenten NICHT erneut addieren; nur Ad-hoc-Modifier on top.
  if (line.bundlePricingMode === 'FIXED_PROPORTIONAL') {
    return base + modifierGross
  }

  // Neues Komponenten-Modell (ROLLUP/à-la-carte): Komponenten addieren on top,
  // am Parent-Amount skaliert — analog zur Engine `collectLineGrosses`.
  if (Array.isArray(line.components) && line.components.length > 0) {
    const componentCents = line.components.map(c => computeGenericGrossCents(c, line.amount))
    return base + modifierGross + sumCents(componentCents)
  }

  // Legacy: separate menuDrink/menuSideDish-Slots.
  const drink = line.menuDrink ? computeGenericGrossCents(line.menuDrink, line.amount) : 0
  const side = line.menuSideDish ? computeGenericGrossCents(line.menuSideDish, line.amount) : 0
  return base + modifierGross + drink + side
}

function computeGenericGrossCents(line: GenericOrderLineItem, parentAmount: number): number {
  // Modifier-amount wird mit dem Parent-Amount skaliert (z. B. "2× Burger
  // mit Extra-Käse" → Modifier 2× berechnet).
  return multiplyCents(toCents(line.price), line.amount * parentAmount)
}
