/**
 * Reject-Legacy-Discount-Hook.
 *
 * Erzwingt serverseitig die Abschaffung des Legacy-Rabattfelds `order.discount`
 * (`assertNoLegacyDiscountWrite` aus `@panary/orders/domain`, ADR 0030): Rabatte
 * gehoeren als Snapshot nach `appliedDiscounts` — ein Client, der stattdessen
 * `discount` setzt, bekommt einen `400` statt eines still verworfenen Rabatts.
 *
 * Das Leeren (`discount: null`) bleibt erlaubt: Es ist der Migrationspfad fuer
 * Bestands-Orders, kein Legacy-Schreibzugriff.
 *
 * Laeuft NUR fuer echte externe Schreibzugriffe:
 *   - Interne Aufrufe (kein `provider`) werden durchgelassen. Das ist ZWINGEND:
 *     der Sync-Apply patcht komplette Cloud-Records, und ein 400 waere dort
 *     TERMINAL (rejected ohne Retry) — Bestandsbestellungen von Alt-Edges
 *     wuerden dauerhaft haengenbleiben. Dort greift weiterhin der Mutex
 *     (`clearLegacyDiscountIfApplied`) im Data-Resolver.
 *
 * Anders als `validateStaffMealExclusivity` braucht dieser Hook KEINEN
 * Vorzustand: Verboten ist der Schreibzugriff selbst, nicht eine Kombination.
 * Genau daran scheiterte die Vorgaengerloesung — sie verglich nur innerhalb des
 * Payloads und sah einen bereits gespeicherten `appliedDiscounts` nicht
 * (panary/panary-core#181).
 */
import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

import { assertNoLegacyDiscountWrite, type LegacyDiscountWriteInput } from '@panary/orders/domain'

const assertOne = (candidate: LegacyDiscountWriteInput): void => {
  try {
    assertNoLegacyDiscountWrite(candidate)
  } catch (err) {
    throw new BadRequest(err instanceof Error ? err.message : String(err))
  }
}

export const rejectLegacyDiscount = async (context: HookContext): Promise<HookContext> => {
  if (!context.params.provider) return context
  if (context.method !== 'create' && context.method !== 'patch') return context

  const payload = context.data as LegacyDiscountWriteInput | LegacyDiscountWriteInput[]
  for (const candidate of Array.isArray(payload) ? payload : [payload]) {
    if (candidate) assertOne(candidate)
  }
  return context
}
