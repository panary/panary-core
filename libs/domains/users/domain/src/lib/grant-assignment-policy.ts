// Grant-Assignment-Policy fuer den `users`-Service — Single Source of Truth
// fuer den Escalation-Guard beim Vergeben additiver Pro-User-Grants
// (`user.permissions`, Format `grant:<resource>:<action>`).
//
// SICHERHEITSKRITISCH: der einzige Schutz davor, dass ein Admin einem
// Mitarbeiter mehr Rechte zuteilt, als er selbst besitzt (bzw. dass ein
// Plattform-Operator — auch unter Impersonation — ueber Tenant-Owner-Niveau
// hinaus vergibt). Wichtig am Edge: PRIVILEGED_ROLES (z.B. TENANT_OWNER)
// umgehen die Self-Patch-Restriction — ohne diesen Guard koennte sich ein
// Owner beliebige grant:-Tokens oberhalb der eigenen Befugnis geben.
//
// Framework-agnostisch (analog self-patch-policy.ts): Verletzungen werden
// strukturiert zurueckgegeben (statt geworfen) — der Feathers-Adapter im
// jeweiligen Backend (Edge/Cloud: restrict-permission-grants.hook.ts) mappt
// `reason` auf BadRequest (INVALID_GRANT) bzw. Forbidden. Der Bypass fuer
// interne Aufrufe (`provider: undefined`) und die Delta-Bildung gegen den
// bestehenden Datensatz sind Hook-Mechanik und leben bewusst im Adapter.

import { GRANT_PREFIX, hasEffectivePermission, parseGrant } from './effective-permissions'
import { UserSystemRole } from './user.schema'

/** Minimal benoetigter Ausschnitt des authentifizierten Users (`context.params.user`). */
export interface GrantAssignmentActor {
  _id?: string
  role?: string
  permissions?: string[]
  /** Cloud-Impersonation: Plattform-Operator handelt als Tenant-User. */
  actAs?: { originalRole?: string }
}

export interface GrantAssignmentViolation {
  reason: 'MISSING_USER' | 'INVALID_GRANT' | 'ESCALATION'
  /** Nur bei INVALID_GRANT/ESCALATION: das abgelehnte grant:-Token. */
  grant?: string
  /** Client-stabile Meldung — Adapter werfen sie unveraendert. */
  message: string
}

/**
 * Extrahiert die NEU hinzukommenden grant:-Tokens (Delta gegen den bestehenden
 * Datensatz). Entzug/Beibehalten bereits gesetzter Grants ist immer erlaubt;
 * Nicht-grant-Tokens (`can_*`-AppAbilities) sind nicht Teil des Guards.
 */
export const extractAddedGrants = (next: readonly unknown[], existing: readonly string[]): string[] =>
  next.filter((p): p is string => typeof p === 'string' && p.startsWith(GRANT_PREFIX) && !existing.includes(p))

/**
 * Kernpruefung des Escalation-Guards. Liefert `null`, wenn der Akteur alle
 * `addedGrants` vergeben darf, sonst die erste Verletzung. „Decke" = effektive
 * Rechte des Akteurs; bei Plattform-Akteuren ODER unter Impersonation gedeckelt
 * auf TENANT_OWNER des Ziel-Tenants (nie die Plattform-Rechte des Operators).
 */
export const checkGrantAssignment = (
  actor: GrantAssignmentActor | undefined,
  addedGrants: readonly string[],
): GrantAssignmentViolation | null => {
  if (addedGrants.length === 0) return null
  if (!actor) {
    return { reason: 'MISSING_USER', message: 'Authentifizierter User fehlt.' }
  }

  const isPlatformActor = (typeof actor.role === 'string' && actor.role.startsWith('platform:')) || !!actor.actAs
  const ceilingRole = isPlatformActor ? UserSystemRole.TENANT_OWNER : (actor.role as UserSystemRole | undefined)
  const ceilingPerms = isPlatformActor ? [] : (actor.permissions ?? [])

  for (const raw of addedGrants) {
    const grant = parseGrant(raw)
    if (!grant) {
      return { reason: 'INVALID_GRANT', grant: raw, message: `Ungültige Berechtigung: ${raw}` }
    }
    if (!hasEffectivePermission(ceilingRole, ceilingPerms, grant.resource, grant.action)) {
      return {
        reason: 'ESCALATION',
        grant: raw,
        message: `Sie dürfen die Berechtigung „${raw}" nicht vergeben.`,
      }
    }
  }

  return null
}
