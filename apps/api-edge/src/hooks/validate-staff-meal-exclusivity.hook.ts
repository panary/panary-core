/**
 * Validate-Staff-Meal-Exclusivity-Hook.
 *
 * Erzwingt serverseitig die Invariante „Personalessen ist rabatt-exklusiv"
 * (`assertStaffMealDiscountExclusivity` aus `@panary/orders/domain`): Traegt eine
 * Bestellung `staffPaymentInfo`, darf sie hoechstens den einen Personalessen-Rabatt
 * fuehren — keine Gutscheine, keine Stammgast-Nachlaesse obendrauf.
 *
 * Ausserhalb von Personalessen aendert der Hook nichts: normale Rabatte bleiben
 * frei kombinierbar.
 *
 * Laeuft NUR fuer echte externe Schreibzugriffe:
 *   - Interne Aufrufe (kein `provider`) werden durchgelassen. Das ist ZWINGEND:
 *     der Sync-Apply patcht komplette Cloud-Records, und ein 400 waere dort
 *     TERMINAL (rejected ohne Retry) — Bestandsbestellungen aus der Zeit vor
 *     dieser Regel wuerden dauerhaft haengenbleiben.
 *   - Patches, die weder `staffPaymentInfo` noch `appliedDiscounts` beruehren,
 *     sind Pass-Through (kein DB-Read).
 *   - Multi-Patch ohne konkrete `id` wird nicht geprueft (kein eindeutiger
 *     Vorzustand; `checkMultiOperation` blockt externe Null-ID-Patches ohnehin).
 *
 * Beim Patch wird der Zielzustand aus Vorzustand + Patch-Body gemerged — sonst
 * liesse sich die Regel umgehen, indem man Personalessen und Fremdrabatt in zwei
 * getrennten Patches setzt.
 */
import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

import { assertStaffMealDiscountExclusivity, type StaffMealExclusivityInput } from '@panary/orders/domain'

const assertOne = (candidate: StaffMealExclusivityInput): void => {
  try {
    assertStaffMealDiscountExclusivity(candidate)
  } catch (err) {
    throw new BadRequest(err instanceof Error ? err.message : String(err))
  }
}

export const validateStaffMealExclusivity = async (context: HookContext): Promise<HookContext> => {
  if (!context.params.provider) return context
  if (context.method !== 'create' && context.method !== 'patch') return context

  if (context.method === 'create') {
    const payload = context.data as StaffMealExclusivityInput | StaffMealExclusivityInput[]
    for (const candidate of Array.isArray(payload) ? payload : [payload]) {
      if (candidate) assertOne(candidate)
    }
    return context
  }

  const data = (context.data ?? {}) as StaffMealExclusivityInput
  const touchesStaff = 'staffPaymentInfo' in data
  const touchesDiscounts = 'appliedDiscounts' in data
  if (!touchesStaff && !touchesDiscounts) return context
  if (context.id === null || context.id === undefined) return context

  // Vorzustand intern laden, damit `multiTenancy` nicht filtert (sonst 404 statt 400
  // bei fremdem Tenant) — gleiches Muster wie im Status-FSM-Guard.
  const previous = (await context.service.get(context.id, {
    provider: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as StaffMealExclusivityInput

  assertOne({
    staffPaymentInfo: touchesStaff ? data.staffPaymentInfo : previous?.staffPaymentInfo,
    appliedDiscounts: touchesDiscounts ? data.appliedDiscounts : previous?.appliedDiscounts,
  })
  return context
}
