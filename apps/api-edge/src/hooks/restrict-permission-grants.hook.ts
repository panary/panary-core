// Before-Hook fuer den `users`-Service: Grant-Escalation-Guard (create + patch).
//
// Duenner Feathers-Adapter um die geteilte Grant-Assignment-Policy
// (`checkGrantAssignment` aus @panary/users/domain — Single Source of Truth,
// Semantik identisch zum Cloud-Pendant apps/api-cloud/src/hooks/
// restrict-permission-grants.hook.ts). Validiert nur die NEU hinzukommenden
// grant:-Tokens (Delta gegen den bestehenden Datensatz) — Entzug/Beibehalten
// bereits gesetzter Grants ist immer erlaubt.
//
// SICHERHEITSKRITISCH: PRIVILEGED_ROLES (z.B. TENANT_OWNER) umgehen den
// Self-Patch-Hook — ohne diesen Guard koennte sich ein Owner (oder ein
// kompromittierter Owner-Account) beliebige grant:-Tokens oberhalb der
// eigenen Befugnis geben.
//
// Interne Aufrufe (`provider: undefined`, z.B. Sync-Apply/Bootstrap) sind
// unbeeintraechtigt.
import { BadRequest, Forbidden } from '@feathersjs/errors'

import { checkGrantAssignment, extractAddedGrants, type GrantAssignmentActor } from '@panary/users/domain'
import { logger } from '@panary/shared-backend'

import type { HookContext } from '../declarations'

const extractPermissions = (data: unknown): unknown[] | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const perms = (data as { permissions?: unknown }).permissions
  return Array.isArray(perms) ? perms : undefined
}

/**
 * Before-Hook fuer `before.create` + `before.patch` im users-Service. Wird
 * VOR `validateData`/`resolveData` (und nach `restrictUserSelfPatch`)
 * registriert — analog zur Cloud-Hook-Chain.
 */
export const restrictPermissionGrants = async (context: HookContext): Promise<HookContext> => {
  // Interne Aufrufe (Sync-Apply, Bootstrap, Service-internal) sind frei.
  if (!context.params.provider) return context

  // Multi-Create defensiv abdecken (Adapter hat multi aus — Zukunftssicherung).
  const datasets = Array.isArray(context.data) ? context.data : [context.data]
  const actor = context.params.user as GrantAssignmentActor | undefined

  // Bestehende Grants nur bei Einzel-PATCH laden (Delta-Basis). Multi-Patch
  // (id null) bleibt konservativ: alle grant:-Tokens gelten als neu.
  let existing: string[] = []
  if (context.method === 'patch' && context.id != null) {
    const current = (await context.app
      .service('users')
      .get(context.id, { provider: undefined })) as { permissions?: string[] }
    existing = Array.isArray(current?.permissions) ? current.permissions : []
  }

  for (const dataset of datasets) {
    const next = extractPermissions(dataset)
    if (next === undefined) continue

    const violation = checkGrantAssignment(actor, extractAddedGrants(next, existing))
    if (!violation) continue

    if (violation.reason === 'INVALID_GRANT') {
      throw new BadRequest(violation.message)
    }
    if (violation.reason === 'ESCALATION') {
      logger.warn({
        message: 'Vergabe einer Berechtigung jenseits der eigenen Decke blockiert',
        event: 'security.grant_escalation_blocked',
        actorId: actor?._id,
        actorRole: actor?.role,
        impersonating: !!actor?.actAs,
        grant: violation.grant,
        service: context.path,
        method: context.method,
      })
    }
    throw new Forbidden(violation.message)
  }

  return context
}
