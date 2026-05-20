import { authenticate } from '@feathersjs/authentication'
import type { Location } from '@panary/locations/domain'
import type { Application } from '../../declarations'

export const organizationsPath = 'organizations'

/**
 * Leichtgewichtiger Service, der Organisationen (Tenants) aus der Locations-Tabelle ableitet.
 * Wird ausschließlich vom Setup-Wizard der POS-App genutzt, um Tenant/Standort auswählen zu können.
 *
 * Da der Edge-Server mandantenlos (single-tenant) betrieben werden kann, gibt dieser Service
 * alle eindeutigen tenantIds aus der Locations-Tabelle als Organisationen zurück.
 */
const organizationsService = (app: Application) => ({
  async find(_params?: unknown) {
    // DB-agnostisch: statt GROUP BY + MIN() laden wir alle Locations ueber den
    // Feathers-Service und sortieren + deduplizieren in JavaScript. Das reproduziert
    // die alte MIN-Semantik (alphabetisch erster Eintrag pro Tenant) portabel fuer
    // MongoDB-Cloud. `organizationName` ist nicht als Query-Property zugelassen,
    // daher erfolgt das Sortieren im Anwendungscode.
    const locations = (await app.service('locations').find({
      paginate: false,
    })) as Location[]

    const sorted = [...locations].sort((a, b) => {
      const aKey = a.organizationName || a.name || ''
      const bKey = b.organizationName || b.name || ''
      return aKey.localeCompare(bKey)
    })

    const byTenant = new Map<string, { _id: string; name: string }>()
    for (const loc of sorted) {
      if (!loc.tenantId || byTenant.has(loc.tenantId)) continue
      byTenant.set(loc.tenantId, {
        _id: loc.tenantId,
        name: loc.organizationName || loc.name,
      })
    }

    return Array.from(byTenant.values())
  },
})

export const organizations = (app: Application) => {
  app.use(organizationsPath, organizationsService(app))

  app.service(organizationsPath).hooks({
    around: {
      all: [authenticate('jwt')],
    },
  })
}
