import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { getJsonFieldHooks } from '@panary/shared-backend'

const LOCATION_JSON_FIELDS = ['address', 'currentBusinessDay', 'settings']

import {
  locationDataResolver,
  locationDataValidator,
  locationExternalResolver,
  locationPatchResolver,
  locationPatchValidator,
  locationQueryResolver,
  locationQueryValidator,
  locationResolver
} from './locations.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { cloudManaged } from '../../hooks/cloud-managed.hook'
import { recordEmergencyOverride } from '../../hooks/record-emergency-override.hook'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  locationDataSchema,
  locationPatchSchema,
  locationQuerySchema,
  locationSchema,
  generateDefaultLocationSettings,
} from '@panary/locations/domain'
import type { Location, LocationService } from './locations.class'
import { ensureIndexes } from '@panary/shared-backend'

export const locationsPath = 'locations'
export const locationsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './locations.schema'

export const locations = (app: Application) => {
  const paginate = app.get('paginate')

  // 1. Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // 2. Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // MongoDB Model (for Enterprise/Cloud)
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // which is okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the lib. For now, the placeholder is sufficient.
    // Model = require('./users.model').default(app)
  }

  // 3. Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<Location>(app, {
    name: 'locations',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as LocationService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'locations',
      [
        { name: 'idx_locations_tenant', columns: ['tenantId'] },
      ],
      service,
    )

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(locationsPath, service as any, {
    methods: locationsMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Locations',
      schemas: {
        location: locationSchema,
        locationData: locationDataSchema,
        locationPatch: locationPatchSchema,
        locationQuery: locationQuerySchema
      }
    }
  })

  const jsonHooks = getJsonFieldHooks(app, LOCATION_JSON_FIELDS)

  // 5. Register hooks
  app.service(locationsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        // cloudManaged() vor multiTenancy: externe Writes blocken, sobald die
        // Edge gepaart ist. Source of Truth fuer Standort-Settings ist die
        // Cloud — siehe documentation/standort-einstellungen.md.
        cloudManaged(),
        // Emergency-Override (ADR `emergency-override-adr.md`):
        // Wenn cloudManaged() den Marker `isEmergencyOverride=true` setzt,
        // diffed dieser Hook den Vor-/Nach-Zustand der printSettings und
        // persistiert die Änderung in `pending-local-overrides` (statt der
        // Sync-Outbox), damit der Reconciliation-Flow beim nächsten Heartbeat
        // entscheiden kann, ob Edge oder Cloud gewinnt.
        recordEmergencyOverride(),
        multiTenancy({ isolateLocation: false }),

        schemaHooks.resolveExternal(locationExternalResolver),
        schemaHooks.resolveResult(locationResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(locationQueryValidator),
        schemaHooks.resolveQuery(locationQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(locationDataValidator),
        schemaHooks.resolveData(locationDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        schemaHooks.validateData(locationPatchValidator),
        schemaHooks.resolveData(locationPatchResolver),
        ...jsonHooks.before,
      ],
      remove: []
    },
    after: {
      all: [
        ...jsonHooks.after,
        // Settings mit Defaults auffüllen, falls leer oder unvollständig (Migration von Alt-Daten)
        async (context: any) => {
          const ensureDefaults = (record: any) => {
            if (!record?.settings || typeof record.settings !== 'object') return
            const s = record.settings
            if (!s.generalSettings) {
              // Settings sind leer/unvollständig — mit Defaults auffüllen
              const merged = { ...generateDefaultLocationSettings, ...s }
              // printSettings aus DB bevorzugen, Rest aus Defaults
              for (const key of Object.keys(generateDefaultLocationSettings)) {
                if (!s[key]) merged[key] = (generateDefaultLocationSettings as any)[key]
              }
              record.settings = merged
            }
          }

          const { result } = context
          if (result?.data && Array.isArray(result.data)) {
            for (const item of result.data) ensureDefaults(item)
          } else if (Array.isArray(result)) {
            for (const item of result) ensureDefaults(item)
          } else if (typeof result === 'object') {
            ensureDefaults(result)
          }
          return context
        },
      ]
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
