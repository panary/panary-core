import type { Order, OrderLineItem } from './order.schema'

/**
 * Was dieser Vorgang noch traegt: `lineItems` minus die Gegenbuchungen aus
 * `splitOff` (panary/panary-core#349).
 *
 * 🚨 Die EINZIGE Fassung dieser Ableitung. Preis-Engine (`computeOrderTax`) und
 * Bon-Renderer lesen sie; wer die Restmenge anderswo selbst zusammenrechnet,
 * druckt nach einem Split eine andere Zahl, als die API ausweist — still, ohne
 * Fehler, auf einem steuerrelevanten Dokument.
 *
 * Warum die Trennung ueberhaupt existiert: Anforderung A5 des Rechtsgutachtens
 * zu panary/panary-core#345 verlangt, dass die Quellzeile beim Split UNVERAENDERT
 * bestehen bleibt (kein `UPDATE` auf Menge, Preis, Steuersatz, Zuordnung);
 * A13 (§ 14c UStG) verlangt zugleich, dass die Quelle danach nicht mehr den
 * vollen Betrag traegt. Beides zusammen geht nur als Gegenbuchung plus
 * Ableitung — nicht als Aenderung. Details in ADR 0049.
 *
 * Ohne `splitOff` gibt die Funktion das Original-Array unveraendert zurueck:
 * Bestandsdaten und der Regelfall laufen durch denselben Pfad wie vorher.
 *
 * 🚫 Diese Datei importiert bewusst NICHTS ausser den Typen. Sie liegt zwischen
 * `compute-order-tax.ts` und `order-split.ts`, die beide sie brauchen — laege
 * sie in einer der beiden, waere der Import zyklisch.
 */
export function effectiveLineItems(order: Pick<Order, 'lineItems' | 'splitOff'>): OrderLineItem[] {
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : []
  const splitOff = Array.isArray(order.splitOff) ? order.splitOff : []
  if (splitOff.length === 0) return lineItems

  const movedByRow = new Map<string, number>()
  for (const entry of splitOff) {
    movedByRow.set(entry.lineItemRowId, (movedByRow.get(entry.lineItemRowId) ?? 0) + entry.amount)
  }

  const out: OrderLineItem[] = []
  for (const line of lineItems) {
    const moved = movedByRow.get(line._id) ?? 0
    if (moved <= 0) {
      out.push(line)
      continue
    }
    const remaining = line.amount - moved
    // Vollstaendig abgegebene Zeilen entfallen aus der ABLEITUNG — in
    // `lineItems` stehen sie weiter, das ist der Zweck der Trennung.
    if (remaining <= 0) continue
    out.push({ ...line, amount: remaining })
  }
  return out
}

/** Restmenge einer Zeile nach bereits erfolgten Umbuchungen. */
export function remainingLineAmount(order: Pick<Order, 'lineItems' | 'splitOff'>, lineItemRowId: string): number {
  const line = (order.lineItems ?? []).find(l => l._id === lineItemRowId)
  if (!line) return 0
  let moved = 0
  for (const entry of order.splitOff ?? []) {
    if (entry.lineItemRowId === lineItemRowId) moved += entry.amount
  }
  return line.amount - moved
}
