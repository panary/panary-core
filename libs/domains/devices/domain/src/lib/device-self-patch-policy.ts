// Self-Patch-Policy fuer den `devices`-Service — Single Source of Truth fuer
// die PATCH-Self-Restriction des Backend-Hooks (Edge: apps/api-edge,
// restrict-device-self-patch.hook.ts). Spiegelt das Muster der User-Policy
// (@panary/users/domain, self-patch-policy.ts).
//
// DEVICE_POS bekommt fuer die fluide UI-Skalierung
// (PNRY-FEAT-POS-UI-SCALE-001) `devices: UPDATE` in der RolePermissions-
// Matrix — damit das Terminal seine eigene Darstellungsdichte (`uiScale`)
// persistieren kann. Damit das kein Eskalationsvektor wird, gilt fuer alle
// nicht-privilegierten Rollen:
//   - Nur der EIGENE Device-Datensatz (deviceId des authentifizierten
//     Geraets == deviceId des Ziel-Datensatzes)
//   - Nur Whitelist-Felder (`SELF_PATCHABLE_DEVICE_FIELDS`) — niemals
//     `apiKeyId`, `active`, `type`, `deviceId` etc.
//
// Framework-agnostisch: Verletzungen werden strukturiert zurueckgegeben
// (statt geworfen) — der Feathers-Adapter mappt `message` 1:1 auf Forbidden.
// Der Bypass fuer interne Aufrufe (`provider: undefined`) ist Hook-Mechanik
// und lebt bewusst NICHT hier, sondern im Adapter.

// Rollen mit devices:MANAGE laut RolePermissions-Matrix (TENANT_OWNER,
// TENANT_TECHNICIAN) plus PLATFORM_OWNER (struktureller Gott-Modus-Bypass im
// authorize-Hook). Bewusst String-Literale statt Import aus
// @panary/users/domain — die devices-Domain haengt sonst im Publish-Build an
// der users-Domain (Cross-Lib-Wiring, CLAUDE.md §2.1). Der Invarianten-Test
// in apps/api-edge/src/hooks/restrict-device-self-patch.hook.spec.ts lockt
// die Werte gegen die Matrix.
export const DEVICE_PRIVILEGED_ROLES: ReadonlySet<string> = new Set<string>([
  'platform:owner',
  'tenant:owner',
  'tenant:technician',
])

// Erlaubte Self-Patch-Felder fuer non-privilegierte Rollen. Strikt — niemals
// `apiKeyId`, `tenantId`, `locationId`, `active`, `type`, `deviceId`
// aufnehmen (Eskalations-Vektor; Invarianten-Test in
// device-self-patch-policy.spec.ts lockt das).
export const SELF_PATCHABLE_DEVICE_FIELDS: ReadonlySet<string> = new Set<string>(['uiScale'])

// Der multiTenancy-Hook (around.all) stempelt tenantId/locationId in den
// Patch-Body BEVOR die before-Hooks laufen — diese Keys sind daher im Body
// tolerierbar, aber NUR wenn der Wert dem eigenen Tenant/Standort des Actors
// entspricht (der devicePatchResolver strippt sie ohnehin vor dem Write).
const STAMPED_FIELDS = new Set<string>(['tenantId', 'locationId'])

/** Minimal benoetigter Ausschnitt des authentifizierten Actors (`context.params.user`). */
export interface DeviceSelfPatchActor {
  role?: string
  /** deviceId des authentifizierten Geraets (API-Key-Auth) — bei User-Auth undefined. */
  deviceId?: string
  tenantId?: string
  locationId?: string
}

export interface DeviceSelfPatchViolation {
  reason: 'MISSING_ACTOR' | 'FOREIGN_RECORD' | 'FORBIDDEN_FIELD'
  /** Nur bei FORBIDDEN_FIELD: der abgelehnte Body-Key. */
  field?: string
  /** Client-stabile Meldung — Adapter werfen sie unveraendert als Forbidden. */
  message: string
}

/**
 * Kernpruefung der PATCH-Self-Restriction fuer devices. Liefert `null`, wenn
 * der Patch erlaubt ist, sonst die erste Verletzung. Privilegierte Rollen
 * umgehen die Restriction; alle anderen (insb. DEVICE_POS) duerfen nur den
 * eigenen Datensatz und darin nur whitelisted Felder patchen.
 *
 * `targetDeviceId` ist die deviceId des Ziel-Datensatzes — der Adapter laedt
 * den Datensatz intern (provider: undefined) und reicht sie hier durch.
 */
export const checkDeviceSelfPatch = (
  actor: DeviceSelfPatchActor | undefined,
  targetDeviceId: string | null | undefined,
  data: unknown,
): DeviceSelfPatchViolation | null => {
  if (!actor || !actor.role) {
    return { reason: 'MISSING_ACTOR', message: 'Authentifizierter Actor fehlt.' }
  }

  // Privilegierte Rollen mit MANAGE-Permission umgehen die Restriction.
  if (DEVICE_PRIVILEGED_ROLES.has(actor.role)) return null

  // Non-privilegiert: PATCH nur auf den eigenen Device-Datensatz.
  if (!actor.deviceId || targetDeviceId !== actor.deviceId) {
    return {
      reason: 'FOREIGN_RECORD',
      message: 'Geraete-Einstellungen koennen nur vom Geraet selbst geaendert werden.',
    }
  }

  // Body darf nur whitelisted Felder (plus harmlose Stamp-Echos) enthalten.
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (SELF_PATCHABLE_DEVICE_FIELDS.has(key)) continue
      if (STAMPED_FIELDS.has(key)) {
        // Stamp-Echo nur mit dem EIGENEN Wert tolerieren — alles andere ist
        // ein Injektionsversuch.
        const own = key === 'tenantId' ? actor.tenantId : actor.locationId
        if (record[key] === own) continue
      }
      const allowed = [...SELF_PATCHABLE_DEVICE_FIELDS].join(', ')
      return {
        reason: 'FORBIDDEN_FIELD',
        field: key,
        message: `Feld '${key}' kann nicht im Geraete-Self-Service geaendert werden. Erlaubt: ${allowed}.`,
      }
    }
  }

  return null
}
