// Before-Hook fuer den `users`-Service: PATCH-Self-Restriction.
//
// Duenner Feathers-Adapter um die geteilte Self-Patch-Policy
// (`checkUserSelfPatch` aus @panary/users/domain — Single Source of Truth
// fuer Edge und Cloud). Whitelist (`SELF_PATCHABLE_FIELDS`), Rollen-Bypass
// (`PRIVILEGED_ROLES`) und Begruendung: siehe self-patch-policy.ts.
//
// Interne Aufrufe (`provider: undefined`, z.B. Sync-Apply) sind unbeeintraechtigt.
import { Forbidden } from '@feathersjs/errors'

import { checkUserSelfPatch, type SelfPatchActor } from '@panary/users/domain'

import type { HookContext } from '../declarations'

/**
 * Before-Hook fuer `before.patch` im users-Service. Wird VOR
 * `validateData`/`resolveData` registriert, damit Self-Restriction-Verstoesse
 * frueh fehlschlagen — kein Aufwand fuer Schema-Pruefung wenn der User
 * sowieso nicht patchen darf.
 */
export const restrictUserSelfPatch = async (context: HookContext): Promise<HookContext> => {
  // Interne Aufrufe (Sync-Apply, Bootstrap, Service-internal) sind frei.
  if (!context.params.provider) return context

  const user = context.params.user as SelfPatchActor | undefined
  const violation = checkUserSelfPatch(user, context.id, context.data)
  if (violation) {
    throw new Forbidden(violation.message)
  }

  return context
}
