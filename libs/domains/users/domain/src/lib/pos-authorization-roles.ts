// Rollen-Kreise, die am POS-Terminal per PIN eine Freigabe erteilen duerfen —
// Single Source of Truth fuer die drei Notfall-/Freigabe-Dialoge, die vorher
// jeweils ihre eigene lokale Kopie hielten (Entkoppeln, Storno,
// Kassen-Eroeffnung).
//
// Warum hier und nicht in der jeweiligen Komponente: Die Geraete-Zuweisung
// (PNRY-FEAT-DEVICE-ASSIGNMENT-001, @panary/devices/domain,
// device-access-mode.ts) schraenkt `users.find` auf einem zugewiesenen Geraet
// ein. Genau diese Rollen muessen davon ausgenommen bleiben, sonst sperrt sich
// ein zugewiesenes Geraet selbst aus — das Entkoppeln waere unwiderruflich
// blockiert. Der Invarianten-Test in
// apps/api-edge/src/hooks/device-access-exempt-roles.spec.ts lockt
// `DEVICE_ACCESS_EXEMPT_ROLES ⊇ POS_AUTHORIZING_ROLES`; das funktioniert nur,
// wenn die Rollenkreise an einer Stelle stehen, die beide Seiten sehen.

import { UserSystemRole } from './user.schema'

/**
 * Rollen, deren PIN das Entkoppeln eines Geraets freigibt.
 * (Spiegel des Backend-Verhaltens; der Dialog prueft die Rueckgabe zusaetzlich.)
 */
export const UNPAIR_ALLOWED_ROLES: ReadonlySet<string> = new Set<string>([
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
  UserSystemRole.TENANT_TECHNICIAN,
])

/** Rollen, deren PIN einen Storno am POS freigibt. */
export const ORDER_CANCEL_AUTHORIZING_ROLES: ReadonlySet<string> = new Set<string>([
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
])

/**
 * Rollen, deren PIN eine Kassenlade fuer einen Mitarbeiter eroeffnet bzw. den
 * Kassenabschluss freigibt. Spiegel von `PRIVILEGED_CASH_SESSION_ROLES`
 * (apps/api-edge/src/hooks/restrict-cash-session-to-owner.hook.ts) — dort liegt
 * die durchsetzende Kopie, hier die fuer den Client sichtbare.
 */
export const CASH_SESSION_AUTHORIZING_ROLES: ReadonlySet<string> = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
  UserSystemRole.TENANT_TECHNICIAN,
])

/**
 * Vereinigung aller Freigabe-Kreise: jeder Personenkreis, der an einem POS
 * per PIN etwas autorisieren koennen muss — unabhaengig davon, ob das Geraet
 * einem Mitarbeiter zugewiesen ist.
 */
export const POS_AUTHORIZING_ROLES: ReadonlySet<string> = new Set<string>([
  ...UNPAIR_ALLOWED_ROLES,
  ...ORDER_CANCEL_AUTHORIZING_ROLES,
  ...CASH_SESSION_AUTHORIZING_ROLES,
])
