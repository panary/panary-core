// Before-Hook fuer den `users`-Service: PATCH-Self-Restriction.
//
// Mitarbeiter mit Rolle TENANT_MANAGER und TENANT_STAFF haben in der
// RolePermissions-Matrix `users: UPDATE` — damit sie ihren EIGENEN PIN/
// Passwort/E-Mail aendern koennen (Self-Service im POS-Client). Sie duerfen
// aber NICHT:
//   - Andere User patchen (z.B. einen anderen Mitarbeiter umbenennen)
//   - Sicherheits-relevante Felder eskalieren (`role`, `permissions`,
//     `tenantId`, `activeLocationId`, `allowedLocationIds`, `posPin`-fremd
//     etc.)
//
// Privilegierte Rollen (PLATFORM_*, TENANT_OWNER, TENANT_TECHNICIAN) haben
// MANAGE auf users — sie umgehen diesen Hook bewusst.
//
// Interne Aufrufe (`provider: undefined`, z.B. Sync-Apply) sind unbeeintraechtigt.
import { Forbidden } from '@feathersjs/errors'

import { UserSystemRole } from '@panary/users/domain'

import type { HookContext } from '../declarations'

// Rollen mit MANAGE auf users — duerfen alle User patchen, alle Felder.
const PRIVILEGED_ROLES = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_TECHNICIAN,
])

// Erlaubte Self-Patch-Felder fuer non-privilegierte Rollen.
// Strikt — keine `role`, `permissions`, `tenantId`, `*LocationId*`-Eskalation.
const SELF_PATCHABLE_FIELDS = new Set<string>(['posPin', 'password', 'email'])

/**
 * Before-Hook fuer `before.patch` im users-Service. Wird VOR
 * `validateData`/`resolveData` registriert, damit Self-Restriction-Verstoesse
 * frueh fehlschlagen — kein Aufwand fuer Schema-Pruefung wenn der User
 * sowieso nicht patchen darf.
 */
export const restrictUserSelfPatch = async (context: HookContext): Promise<HookContext> => {
  // Interne Aufrufe (Sync-Apply, Bootstrap, Service-internal) sind frei.
  if (!context.params.provider) return context

  const user = context.params.user as { _id?: string; role?: string } | undefined
  if (!user || !user.role) {
    throw new Forbidden('Authentifizierter User fehlt.')
  }

  // Privilegierte Rollen mit MANAGE-Permission umgehen die Restriction.
  if (PRIVILEGED_ROLES.has(user.role)) return context

  // Non-privilegiert: PATCH nur auf eigene `_id`.
  if (context.id !== user._id) {
    throw new Forbidden('Eigene User-Daten koennen nur vom eingeloggten User selbst geaendert werden.')
  }

  // Body darf nur whitelisted Felder enthalten.
  const data = context.data as Record<string, unknown> | undefined
  if (data && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      if (!SELF_PATCHABLE_FIELDS.has(key)) {
        throw new Forbidden(
          `Feld '${key}' kann nicht im Self-Service geaendert werden. Erlaubt: ${[...SELF_PATCHABLE_FIELDS].join(', ')}.`,
        )
      }
    }
  }

  return context
}
