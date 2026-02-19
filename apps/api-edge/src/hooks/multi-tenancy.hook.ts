import { HookContext, NextFunction } from '../declarations'
import { UserSystemRole } from '@panary-core/users/domain'

export interface MultiTenancyOptions {
  isolateLocation?: boolean // Soll nach Filiale gefiltert werden?
  allowGlobalData?: boolean // Dürfen globale Daten (locationId: null) gesehen werden?
}

// 3. SCHICHT: Daten-Isolation (Multi-Tenancy)
// Prüft: Gehört der angefragte User zu meinem Tenant?
// Konfiguration:
// - isolateLocation: true -> Staff sieht nur Kollegen seiner Filiale?
// - allowGlobalData: false -> User gehören immer fest zu etwas.
export const multiTenancy =
  (options: MultiTenancyOptions = {}) =>
  async (context: HookContext, next: NextFunction) => {
    const { isolateLocation = false, allowGlobalData = false } = options
    const { user } = context.params

    // 1. Interne Aufrufe (kein User/Provider) durchlassen
    if (!user) return next()

    // 2. Platform Bypass: Admins sehen alles
    if (user.role && user.role.startsWith('platform:')) {
      return next()
    }

    // ---------------------------------------------------------
    // WRITE OPERATIONS (create, update, patch) -> "Stamping"
    // Wir erzwingen, dass Daten dem Ersteller "gehören".
    // ---------------------------------------------------------
    if (['create', 'update', 'patch'].includes(context.method)) {
      const data = context.data || {}

      // A. Tenant ist Pflicht
      data.tenantId = user.tenantId

      // B. Location ist optional (aber für Staff Pflicht)
      if (isolateLocation && user.locationId) {
        // Wenn ich Staff bin, MUSS ich Daten meiner Filiale zuordnen
        // Wenn ich Owner bin, DARF ich wählen (Default: Meine Homebase)
        if (!data.locationId) {
          data.locationId = user.locationId
        }
      }
      context.data = data
    }

    // ---------------------------------------------------------
    // READ OPERATIONS (find, get, remove) -> "Scoping"
    // Wir filtern die Sicht auf die Daten.
    // ---------------------------------------------------------
    if (['find', 'get', 'remove', 'update', 'patch'].includes(context.method)) {
      const query = context.params.query || {}

      // A. Tenant Isolation (Harter Filter)
      query.tenantId = user.tenantId

      // B. Location Isolation
      if (isolateLocation) {
        // Privilegierte User (Chef/Manager) sehen ALLE Filialen
        const isPrivileged = [UserSystemRole.TENANT_OWNER, UserSystemRole.TENANT_MANAGER].includes(
          user.role as UserSystemRole
        )

        // Normale Mitarbeiter sehen NUR ihre Filiale
        if (!isPrivileged && user.locationId) {
          if (allowGlobalData) {
            // Zeige: Meine Filiale ODER Globale Daten
            query.$or = [{ locationId: user.locationId }, { locationId: null }]
          } else {
            // Zeige: NUR Meine Filiale
            query.locationId = user.locationId
          }
        }
      }

      context.params.query = query
    }

    return next()
  }
