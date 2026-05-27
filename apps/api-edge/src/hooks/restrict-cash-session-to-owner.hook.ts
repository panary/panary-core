import { Forbidden } from '@feathersjs/errors'

import { UserSystemRole } from '@panary/users/domain'

import type { HookContext } from '../declarations'

/**
 * Rollen mit MANAGE auf cash-sessions — sehen/aendern alle Laden des Tenants
 * und duerfen eine Lade FUER einen Mitarbeiter eroeffnen (`openedBy` frei
 * waehlbar). STAFF/POS-Geraet sind auf die eigene Lade beschraenkt. Geteilt mit
 * dem cash-sessions-Data-Resolver (Single Source of Truth).
 *
 * DEVICE_POS ist bewusst NICHT privilegiert: das Geraet kann zwar Kassen
 * anlegen/lesen, aber nur die eigene (openedBy == aktueller Kassierer).
 */
export const PRIVILEGED_CASH_SESSION_ROLES = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
  UserSystemRole.TENANT_TECHNICIAN,
])

/**
 * Self-Scope fuer `cash-sessions`: STAFF/POS darf nur die EIGENEN Kassenladen
 * (`openedBy === user._id`) lesen/aendern. Privilegierte Rollen
 * (OWNER/MANAGER/TECHNICIAN, Platform) sehen alle Laden des Tenants.
 *
 * Defense-in-depth — `multiTenancy` filtert bereits auf Tenant/Location; dieser
 * Hook ergaenzt die Mitarbeiter-Ebene (eine Lade „gehoert" ihrem Eroeffner).
 * Interne Aufrufe (kein provider, z.B. recompute / Sync-Apply / Auto-Open)
 * bleiben unbeeintraechtigt.
 *
 * Registriert auf `find`/`get`/`patch`/`remove`. `create` ist inhaerent self
 * (der Resolver stempelt `openedBy = aktueller User`).
 */
export const restrictCashSessionToOwner = async (context: HookContext): Promise<HookContext> => {
  if (!context.params.provider) return context

  const user = context.params.user as { _id?: string; role?: string } | undefined
  if (!user?._id || !user.role) {
    throw new Forbidden('Authentifizierter User fehlt.')
  }
  if (PRIVILEGED_CASH_SESSION_ROLES.has(user.role)) return context

  // FIND: harter Filter auf eigene Laden.
  if (context.method === 'find') {
    context.params.query = { ...(context.params.query ?? {}), openedBy: user._id }
    return context
  }

  // GET/PATCH/REMOVE: Ziel-Datensatz muss dem User gehoeren.
  if (context.id != null) {
    let record: { openedBy?: string } | undefined
    try {
      record = (await context.service.get(context.id, { provider: undefined })) as {
        openedBy?: string
      }
    } catch {
      // Not-Found u.ae. vom Adapter klaeren lassen.
      return context
    }
    if (record?.openedBy !== user._id) {
      throw new Forbidden('Kassenlade gehoert einem anderen Mitarbeiter.')
    }
  }

  return context
}
