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

function computeLineItemGrossCents(line: OrderLineItem): number {
  const base = multiplyCents(toCents(line.price), line.amount)
  const modifierCents = (line.modifiers ?? []).map(m => computeGenericGrossCents(m, line.amount))

  // FIXED_PROPORTIONAL: `line.price` IST der Festpreis (Komponenten sind darin
  // eingerechnet) → Komponenten NICHT erneut addieren; nur Ad-hoc-Modifier on top.
  if (line.bundlePricingMode === 'FIXED_PROPORTIONAL') {
    return base + sumCents(modifierCents)
  }

  // Neues Komponenten-Modell (ROLLUP/à-la-carte): Komponenten addieren on top,
  // am Parent-Amount skaliert — analog zur Engine `collectLineGrosses`.
  if (Array.isArray(line.components) && line.components.length > 0) {
    const componentCents = line.components.map(c => computeGenericGrossCents(c, line.amount))
    return base + sumCents(modifierCents) + sumCents(componentCents)
  }

  // Legacy: separate menuDrink/menuSideDish-Slots.
  const drink = line.menuDrink ? computeGenericGrossCents(line.menuDrink, line.amount) : 0
  const side = line.menuSideDish ? computeGenericGrossCents(line.menuSideDish, line.amount) : 0
  return base + sumCents(modifierCents) + drink + side
}

function computeGenericGrossCents(line: GenericOrderLineItem, parentAmount: number): number {
  // Modifier-amount wird mit dem Parent-Amount skaliert (z. B. "2× Burger
  // mit Extra-Käse" → Modifier 2× berechnet).
  return multiplyCents(toCents(line.price), line.amount * parentAmount)
}
