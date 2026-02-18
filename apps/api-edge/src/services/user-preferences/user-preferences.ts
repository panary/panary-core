import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  userPreferenceDataResolver,
  userPreferenceDataValidator,
  userPreferenceExternalResolver,
  userPreferencePatchResolver,
  userPreferencePatchValidator,
  userPreferenceQueryResolver,
  userPreferenceQueryValidator,
  userPreferenceResolver
} from './user-preferences.schema'

import type { Application } from '../../declarations'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access'
import { DatabaseType } from '@panary-core/shared/common'
import {
  userPreferenceDataSchema,
  userPreferencePatchSchema,
  userPreferenceQuerySchema,
  userPreferenceSchema
} from '@panary-core/user-preferences/domain'
import type { UserPreference, UserPreferenceService } from './user-preferences.class'

export const userPreferencesPath = 'user-preferences'
export const userPreferencesMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './user-preferences.schema'

export const userPreferences = (app: Application) => {
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
  const service = createServiceAdapter<UserPreference>(app, {
    name: 'user-preferences',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as UserPreferenceService

  ;(service as any).setup = async (app: Application, path: string) => {
    const systemConfig = app.get('system') || {}
    const dbType = systemConfig.dbType || DatabaseType.SQLITE

    // --- A) MONGODB STRATEGY ---
    if (dbType === DatabaseType.MONGODB) {
      // In der Factory ist 'Model' bei Mongo der Mongoose/Mongo Client
      // We retrieve the specific model (collection)
      const adapter = this as any
      const model = await adapter.getModel(app)

      if (model?.createIndexes) {
        await model.createIndexes([
          // TODO: Add specific indexes, e.g.
          // { key: { tenantId: 1 }, name: 'tenant_index' },
          // { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' },
          // { key: { tenantId: 1, externalId: 1 }, unique: true, name: 'tenant_externalId_unique' },
          // { key: { status: 1 }, name: 'status_index' },
          // Text Index (Wichtig für Suche!)
          // {
          //   key: { name: 'text', acronym: 'text' },
          //   name: 'text_search_index'
          // }
        ])
        console.log('MongoDB Indexes ensured for UserPreferences.')
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'user-preferences'

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
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_user-preferences_tenant ON ${tableName} (tenantId)`)
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_user-preferences_tenant_location ON ${tableName} (tenantId, locationId)`
          )
          await knex.raw(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_user-preferences_tenant_external_unique ON ${tableName} (tenantId, externalId) WHERE externalId IS NOT NULL`
          )
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_user-preferences_status ON ${tableName} (status)`)

          // ACHTUNG: SQLite hat keine "Text Indexes" wie MongoDB.
          // Für Volltextsuche bräuchte man FTS5 Tabellen.
          // Ein normaler Index auf 'name' hilft aber bei 'LIKE "X%"' Abfragen.
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_user-preferences_name ON ${tableName} (name)`)

          console.log('SQLite Indexes ensured for UserPreferences.')
        }
      } catch (error) {
        console.error('Error ensuring SQLite indexes:', error)
        // App should still start, maybe the database is locked
      }
    }
  }

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(userPreferencesPath, service as any, {
    methods: userPreferencesMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Produkte',
      schemas: {
        userPreference: userPreferenceSchema,
        userPreferenceData: userPreferenceDataSchema,
        userPreferencePatch: userPreferencePatchSchema,
        userPreferenceQuery: userPreferenceQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(userPreferencesPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(userPreferenceExternalResolver),
        schemaHooks.resolveResult(userPreferenceResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(userPreferenceQueryValidator),
        schemaHooks.resolveQuery(userPreferenceQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(userPreferenceDataValidator),
        schemaHooks.resolveData(userPreferenceDataResolver)
      ],
      patch: [
        schemaHooks.validateData(userPreferencePatchValidator),
        schemaHooks.resolveData(userPreferencePatchResolver)
      ],
      remove: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
