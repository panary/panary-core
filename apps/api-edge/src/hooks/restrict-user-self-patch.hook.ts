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

  const user = context.params.user as SelfPatchUser | undefined
  const violation = checkUserSelfPatch(user, context.id, withoutTenantStamp(user, context.data))
  if (violation) {
    throw new Forbidden(violation.message)
  }

  return context
}

type SelfPatchUser = SelfPatchActor & { tenantId?: string }

/**
 * `multiTenancy()` haengt am users-Service in `around.all` und stempelt `data.tenantId =
 * user.tenantId`, BEVOR dieser Hook laeuft. Die geteilte Policy saehe das Feld sonst in jedem
 * Self-Patch und lehnte ihn ab — jeder Self-Patch eines Mitarbeiters scheiterte so am Edge mit
 * 403 (panary/panary-core#827; dieselbe Luecke schloss panary/panary-cloud#1021 in der Cloud).
 * Nur ein Wert gleich dem eigenen Mandanten ist der Stempel; ein abweichender bleibt im Body und
 * wird von der Policy abgewiesen. Den Stempel selbst verwirft der Patch-Resolver ohnehin.
 */
const withoutTenantStamp = (user: SelfPatchUser | undefined, data: unknown): unknown => {
  if (!user?.tenantId || !data || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (record['tenantId'] !== user.tenantId) return data
  const { tenantId: _stamp, ...rest } = record
  return rest
}
