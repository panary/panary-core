import type { AppliedDiscount } from '@panary/orders/domain'
import type { Discount as ManagedDiscount } from '@panary/discounts/domain'

/**
 * Reine Logik der Positionsrabatte am POS — bewusst aus der Dialog-Komponente
 * heraus, damit sie ohne TestBed prüfbar ist (wie `promo-code` und
 * `board-selection` nebenan).
 *
 * Positionsrabatte wirken auf **eine** Bestellzeile (`target: 'line'` +
 * `lineItemId`). Den Betrag rechnet ausschliesslich `computeOrderTax` — hier
 * entsteht nur der Snapshot, `computedAmountCents` bleibt 0 (ADR 0004: eine
 * zweite Rechenstelle driftet gegen den fiskalischen Snapshot).
 */

export const LINE_DISCOUNT_BLOCKED_STAFF_MEAL = 'Personalessen: kein zusätzlicher Rabatt möglich'
export const LINE_DISCOUNT_BLOCKED_NO_SELECTION = 'Erst eine Position im Warenkorb antippen'
export const LINE_DISCOUNT_BLOCKED_AMBIGUOUS = 'Position mehrfach im Warenkorb — bitte Menge nutzen statt zweiter Zeile'

/** Ein Positionsrabatt je Zeile, abgelegt unter der `lineItemId`. */
export type LineDiscountMap = Readonly<Record<string, ManagedDiscount>>

export interface LineDiscountGateInput {
  isStaffMealOrder: boolean
  /** `_id` der aktuell markierten Zeile, `null` wenn nichts markiert ist. */
  selectedLineItemId: string | null
  /** Alle `_id`s im Warenkorb — für die Eindeutigkeitsprüfung unten. */
  lineItemIds: readonly string[]
}

/**
 * Darf jetzt ein Positionsrabatt gesetzt werden?
 *
 * Drei Sperren:
 * - **Personalessen** ist rabatt-exklusiv (`assertStaffMealDiscountExclusivity`);
 *   ein zweiter Rabatt liesse die Bestellung serverseitig mit 400 scheitern.
 * - **Keine Zeile markiert** — ohne Ziel gibt es keinen Positionsrabatt.
 * - 🛡️ **Mehrdeutige Zeilen-ID — seit #230 eine Rückfallsicherung, keine
 *   Einschränkung mehr.** `increaseLineItem` vergibt seither je Zeile eine eigene
 *   `uuidv7`; zwei gleiche Menüs sind damit unterscheidbar, und diese Sperre feuert
 *   im Normalbetrieb nicht mehr (belegt in `order-dialog.component.spec.ts`).
 *
 *   Sie bleibt trotzdem stehen, weil die Folge einer doppelten ID still wäre:
 *   `computeOrderTax` matcht Positionsrabatte über genau diese `lineItemId`
 *   (`lines.filter(l => l.lineItemId === ad.lineItemId)`), ein Rabatt träfe also
 *   die Steuer-Atome **beider** Zeilen — eine Position rabattiert, zwei abgezogen,
 *   und die Summe sieht plausibel aus. Zwei Wege führen weiterhin dorthin: eine
 *   **Bestands-Order** (vor #230 angelegt, bewusst nicht migriert), die im Dialog
 *   bearbeitet wird, und jede künftige Änderung, die die ID-Vergabe zurückdreht.
 *   Eine Sperre, die nie feuert, kostet nichts; ihr Wegfall kostet stillen Umsatz.
 */
export function evaluateLineDiscountGate(input: LineDiscountGateInput): { allowed: boolean; message?: string } {
  if (input.isStaffMealOrder) return { allowed: false, message: LINE_DISCOUNT_BLOCKED_STAFF_MEAL }
  if (!input.selectedLineItemId) return { allowed: false, message: LINE_DISCOUNT_BLOCKED_NO_SELECTION }
  const occurrences = input.lineItemIds.filter(id => id === input.selectedLineItemId).length
  if (occurrences > 1) return { allowed: false, message: LINE_DISCOUNT_BLOCKED_AMBIGUOUS }
  return { allowed: true }
}

export interface LineSnapshotContext {
  /** uuidv7 des Snapshots — der Aufrufer erzeugt sie, damit die Funktion rein bleibt. */
  id: string
  lineItemId: string
  appliedBy?: string | null
  appliedAt?: string
}

/**
 * Baut den `appliedDiscounts`-Eintrag eines Positionsrabatts.
 *
 * `isStaffMeal` ist hart `false`: Personalessen läuft ausschliesslich über den
 * Order-Pfad (zugewiesener Rabatt + `staffPaymentInfo`). Ein Positionsrabatt mit
 * `isStaffMeal: true` würde `findStaffMealDiscountConflict` einen zweiten
 * Personalessen-Rabatt vortäuschen und die Bestellung abweisen.
 */
export function buildLineAppliedDiscount(d: ManagedDiscount, ctx: LineSnapshotContext): AppliedDiscount {
  return {
    _id: ctx.id,
    discountId: d._id,
    name: d.name,
    method: 'manual',
    target: 'line',
    lineItemId: ctx.lineItemId,
    valueType: d.valueType,
    valuePercent: d.valueType === 'percent' ? d.valuePercent : 0,
    valueCents: d.valueType === 'amount' ? d.valueCents : 0,
    computedAmountCents: 0,
    appliedBy: ctx.appliedBy ?? null,
    appliedAt: ctx.appliedAt ?? new Date().toISOString(),
    isStaffMeal: false,
  }
}

/** Setzt den Rabatt einer Zeile — genau einer je Zeile, ein zweiter ersetzt den ersten. */
export function setLineDiscount(
  current: LineDiscountMap,
  lineItemId: string,
  discount: ManagedDiscount,
): LineDiscountMap {
  return { ...current, [lineItemId]: discount }
}

/** Nimmt den Rabatt einer Zeile zurück. */
export function removeLineDiscount(current: LineDiscountMap, lineItemId: string): LineDiscountMap {
  if (!(lineItemId in current)) return current
  const next = { ...current }
  delete next[lineItemId]
  return next
}

/**
 * Wirft Rabatte weg, deren Zeile nicht mehr im Warenkorb steht.
 *
 * Ohne das überlebt ein Rabatt das Löschen seiner Position: Die Engine fände
 * keine Atome mehr (`amount` bliebe 0), der Bon druckte aber eine Rabattzeile
 * über 0,00 € — ein Beleg, der eine Kulanz ausweist, die niemand bekommen hat.
 */
export function pruneLineDiscounts(current: LineDiscountMap, lineItemIds: readonly string[]): LineDiscountMap {
  const alive = new Set(lineItemIds)
  const kept = Object.keys(current).filter(id => alive.has(id))
  if (kept.length === Object.keys(current).length) return current
  return Object.fromEntries(kept.map(id => [id, current[id]]))
}

/** Snapshot-Einträge aller Positionsrabatte (Reihenfolge = Warenkorb-Reihenfolge). */
export function buildLineAppliedDiscounts(
  current: LineDiscountMap,
  lineItemIds: readonly string[],
  ctx: { newId: () => string; appliedBy?: string | null; appliedAt?: string },
): AppliedDiscount[] {
  return lineItemIds
    .filter(id => !!current[id])
    .map(id =>
      buildLineAppliedDiscount(current[id], {
        id: ctx.newId(),
        lineItemId: id,
        appliedBy: ctx.appliedBy,
        appliedAt: ctx.appliedAt,
      }),
    )
}
