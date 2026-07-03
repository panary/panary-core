// Self-Patch-Policy fuer den `users`-Service — Single Source of Truth fuer die
// PATCH-Self-Restriction der Backend-Hooks (Edge: apps/api-edge, Cloud:
// apps/api-cloud, jeweils restrict-user-self-patch.hook.ts).
//
// Mitarbeiter mit Rolle TENANT_MANAGER und TENANT_STAFF haben in der
// RolePermissions-Matrix `users: UPDATE` — damit sie ihren EIGENEN PIN/
// Passwort/E-Mail aendern koennen (Self-Service im POS-Client). Sie duerfen
// aber NICHT:
//   - Andere User patchen (z.B. einen anderen Mitarbeiter umbenennen)
//   - Sicherheits-relevante Felder eskalieren (`role`, `permissions`,
//     `tenantId`, `activeLocationId`, `allowedLocationIds` etc.)
//
// Framework-agnostisch: Verletzungen werden strukturiert zurueckgegeben (statt
// geworfen) — der Feathers-Adapter im jeweiligen Backend mappt `message` 1:1
// auf Forbidden. Der Bypass fuer interne Aufrufe (`provider: undefined`) ist
// Hook-Mechanik und lebt bewusst NICHT hier, sondern im Adapter.

import { UserSystemRole } from './user.schema'

// Rollen mit MANAGE auf users — duerfen alle User patchen, alle Felder.
export const PRIVILEGED_ROLES: ReadonlySet<string> = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_TECHNICIAN,
])

// Erlaubte Self-Patch-Felder fuer non-privilegierte Rollen. Strikt — niemals
// `role`, `permissions`, `tenantId`, `*LocationId*` aufnehmen (Eskalations-
// Vektor; Invarianten-Test in self-patch-policy.spec.ts lockt das).
export const SELF_PATCHABLE_FIELDS: ReadonlySet<string> = new Set<string>(['posPin', 'password', 'email'])

/** Minimal benoetigter Ausschnitt des authentifizierten Users (`context.params.user`). */
export interface SelfPatchActor {
  _id?: string
  role?: string
}

export interface SelfPatchViolation {
  reason: 'MISSING_USER' | 'FOREIGN_RECORD' | 'FORBIDDEN_FIELD'
  /** Nur bei FORBIDDEN_FIELD: der abgelehnte Body-Key. */
  field?: string
  /** Client-stabile Meldung — Adapter werfen sie unveraendert als Forbidden. */
  message: string
}

/**
 * Kernpruefung der PATCH-Self-Restriction. Liefert `null`, wenn der Patch
 * erlaubt ist, sonst die erste Verletzung. Privilegierte Rollen umgehen die
 * Restriction; alle anderen duerfen nur den eigenen Datensatz und darin nur
 * whitelisted Felder patchen.
 */
export const checkUserSelfPatch = (
  user: SelfPatchActor | undefined,
  targetUserId: string | number | null | undefined,
  data: unknown,
): SelfPatchViolation | null => {
  if (!user || !user.role) {
    return { reason: 'MISSING_USER', message: 'Authentifizierter User fehlt.' }
  }

  // Privilegierte Rollen mit MANAGE-Permission umgehen die Restriction.
  if (PRIVILEGED_ROLES.has(user.role)) return null

  // Non-privilegiert: PATCH nur auf eigene `_id`.
  if (targetUserId !== user._id) {
    return {
      reason: 'FOREIGN_RECORD',
      message: 'Eigene User-Daten koennen nur vom eingeloggten User selbst geaendert werden.',
    }
  }

  // Body darf nur whitelisted Felder enthalten.
  if (data && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      if (!SELF_PATCHABLE_FIELDS.has(key)) {
        const allowed = [...SELF_PATCHABLE_FIELDS].join(', ')
        return {
          reason: 'FORBIDDEN_FIELD',
          field: key,
          message: `Feld '${key}' kann nicht im Self-Service geaendert werden. Erlaubt: ${allowed}.`,
        }
      }
    }
  }

  return null
}
