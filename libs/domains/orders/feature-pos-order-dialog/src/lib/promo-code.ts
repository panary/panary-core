import type { AppliedDiscount } from '@panary/orders/domain'
import type { CodeCheckResult } from '@panary/discounts/data-access'

/**
 * Reine Logik der Rabattcode-Anwendung am POS — bewusst aus der Dialog-Komponente
 * heraus, damit sie ohne TestBed prüfbar ist (wie `board-selection` und
 * `order-channel` nebenan).
 */

export const PROMO_CODE_BLOCKED_STAFF_MEAL = 'Personalessen: kein zusätzlicher Rabatt möglich'
export const PROMO_CODE_BLOCKED_MANUAL = 'Es ist bereits ein Rabatt gewählt — erst entfernen'

export interface PromoCodeGateInput {
  isStaffMealOrder: boolean
  hasManualDiscount: boolean
}

/**
 * Darf jetzt ein Code eingegeben werden?
 *
 * Zwei Sperren, beide mit einem Grund im Backend:
 * - **Personalessen** ist rabatt-exklusiv (`assertStaffMealDiscountExclusivity`);
 *   ein zweiter Rabatt ließe die Bestellung serverseitig mit 400 scheitern.
 * - **Manueller Rabatt** bereits gewählt: Zwei Order-Rabatte nebeneinander sind
 *   an der Kasse nie gemeint und wären für den Gast nicht nachvollziehbar.
 */
export function evaluatePromoCodeGate(input: PromoCodeGateInput): { allowed: boolean; message?: string } {
  if (input.isStaffMealOrder) return { allowed: false, message: PROMO_CODE_BLOCKED_STAFF_MEAL }
  if (input.hasManualDiscount) return { allowed: false, message: PROMO_CODE_BLOCKED_MANUAL }
  return { allowed: true }
}

export interface RedeemForOrderDeps {
  /** Bucht die Einlösung in der Cloud (über den Edge-Proxy). */
  redeem: (input: { code: string; orderId: string }) => Promise<CodeCheckResult>
  /** Erzeugt die Order-ID (uuidv7) — injiziert, damit die Funktion rein bleibt. */
  newOrderId: () => string
}

export type RedeemForOrderResult =
  | { status: 'skipped' }
  | { status: 'redeemed'; orderId: string; redeemed: CodeCheckResult }
  | { status: 'failed'; reason: CodeCheckResult['reason'] }

/**
 * Löst einen geprüften Code für eine noch nicht existierende Bestellung ein.
 *
 * **Die Invariante, um die es hier geht:** Order-ID und Einlösung gehören
 * zusammen — entweder beides oder keines. Die Einlösung braucht die `orderId`,
 * damit sie später einer Bestellung zuzuordnen ist; die Bestellung darf aber
 * erst *nach* erfolgreicher Einlösung entstehen, sonst bekäme der Gast bei
 * einem aufgebrauchten Code den Rabatt ungezählt.
 *
 * Deshalb wird die ID hier vergeben und nur bei Erfolg weitergereicht. Schlägt
 * die Einlösung fehl, fällt sie weg und die Bestellung bekommt ihre ID wie
 * gewohnt vom Server.
 *
 * **Bewusst in Kauf genommen:** Scheitert das Anlegen der Bestellung *nach* einer
 * erfolgreichen Einlösung, zeigt die Einlösung auf eine Order, die es nicht gibt.
 * Das ist ein auditierbarer Zustand — die Alternative (`orderId: null`) war ein
 * unauffindbarer.
 */
export async function redeemCodeForOrder(
  checked: CodeCheckResult | null,
  deps: RedeemForOrderDeps,
): Promise<RedeemForOrderResult> {
  if (!checked?.ok) return { status: 'skipped' }

  const orderId = deps.newOrderId()
  const redeemed = await deps.redeem({ code: checked.code ?? '', orderId })
  if (!redeemed.ok) return { status: 'failed', reason: redeemed.reason }

  return { status: 'redeemed', orderId, redeemed }
}

export interface CodeSnapshotContext {
  /** uuidv7 des Snapshots — der Aufrufer erzeugt sie, damit die Funktion rein bleibt. */
  id: string
  appliedBy?: string | null
  appliedAt?: string
}

/**
 * Baut den `appliedDiscounts`-Eintrag eines eingelösten Codes.
 *
 * `computedAmountCents` bleibt 0: Den tatsächlichen Betrag füllt die kanonische
 * Engine (`computeOrderTax`). Hier selbst zu rechnen wäre eine zweite Wahrheit
 * neben ihr — genau das, was das Snapshot-Format vermeiden soll.
 */
export function buildCodeAppliedDiscount(checked: CodeCheckResult, ctx: CodeSnapshotContext): AppliedDiscount {
  const d = checked.discount
  // Die Cloud liefert `valueType` in der Schreibweise der Rabatt-Definition;
  // das Order-Schema kennt nur Kleinschreibung.
  const isPercent = d?.valueType?.toLowerCase() === 'percent'
  return {
    _id: ctx.id,
    discountId: d?.discountId ?? null,
    discountCodeId: checked.discountCodeId ?? null,
    code: checked.code ?? null,
    name: d?.name ?? 'Rabattcode',
    method: 'code',
    target: 'order',
    valueType: isPercent ? 'percent' : 'amount',
    valuePercent: isPercent ? (d?.valuePercent ?? 0) : 0,
    valueCents: isPercent ? 0 : (d?.valueCents ?? 0),
    computedAmountCents: 0,
    appliedBy: ctx.appliedBy ?? null,
    appliedAt: ctx.appliedAt ?? new Date().toISOString(),
    isStaffMeal: false,
  }
}
