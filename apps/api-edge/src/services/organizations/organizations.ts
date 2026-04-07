import { authenticate } from '@feathersjs/authentication'
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
    const knex = app.get('sqliteClient')

    // organizationName hat Vorrang; Fallback auf den ersten Location-Namen
    const rows = await knex('locations')
      .select('tenantId')
      .min('organizationName as organizationName')
      .min('name as name')
      .groupBy('tenantId')
      .whereNotNull('tenantId') as { tenantId: string; organizationName: string | null; name: string }[]

    return rows.map(row => ({
      _id: row.tenantId,
      name: row.organizationName || row.name,
    }))
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
