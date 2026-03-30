import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { parseJsonFields } from '../../hooks/parse-json-fields.hook'
import { stringifyJsonFields } from '../../hooks/stringify-json-fields.hook'

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
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared/common'
import {
  locationDataSchema,
  locationPatchSchema,
  locationQuerySchema,
  locationSchema,
  generateDefaultLocationSettings,
} from '@panary-core/locations/domain'
import type { Location, LocationService } from './locations.class'
import { logger } from '../../logger'

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

  ;(service as any).setup = async (app: Application, path: string) => {
    const systemConfig = app.get('system') || {}
    const dbType = systemConfig.dbType || DatabaseType.SQLITE

    // --- A) MONGODB STRATEGY ---
    if (dbType === DatabaseType.MONGODB) {
      // In der Factory ist 'Model' bei Mongo der Mongoose/Mongo Client
      // We retrieve the specific model (collection)
      const adapter = service as any
      const model = await adapter.getModel(app)

      if (model?.createIndexes) {
        await model.createIndexes([
          { key: { tenantId: 1 }, name: 'tenant_index' },
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'locations' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'locations'

      try {
        const hasTable = await knex.schema.hasTable(tableName)
        if (hasTable) {
          await knex.schema.alterTable(tableName, (table: any) => {
            // Indizes nur erstellen, wenn sie nicht existieren
            // Hinweis: Knex hat keine einfache 'createIndexIfNotExists' API innerhalb von alterTable
            // daher fängt man Fehler oft ab oder prüft vorher.
            // Der einfachste Weg für SQLite "Offline First" (Idempotent):
            // Wir führen Raw SQL aus, da Knex Schema Builder hier manchmal limitiert ist.
          })

          // Sicherer Weg für SQLite Indizes (Idempotent):
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_locations_tenant ON ${tableName} (tenantId)`)
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'locations' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'locations', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

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

  // 5. Register hooks
  app.service(locationsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
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
        stringifyJsonFields(...LOCATION_JSON_FIELDS),
      ],
      patch: [
        schemaHooks.validateData(locationPatchValidator),
        schemaHooks.resolveData(locationPatchResolver),
        stringifyJsonFields(...LOCATION_JSON_FIELDS),
      ],
      remove: []
    },
    after: {
      all: [
        parseJsonFields(...LOCATION_JSON_FIELDS),
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
