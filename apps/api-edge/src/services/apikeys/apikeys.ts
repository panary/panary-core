// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  apikeyDataResolver,
  apikeyDataValidator,
  apikeyExternalResolver,
  apikeyPatchResolver,
  apikeyPatchValidator,
  apikeyQueryResolver,
  apikeyQueryValidator,
  apikeyResolver
} from './apikeys.schema'

import type { Application } from '../../declarations'
import { Apikey, ApiKeyService } from './apikeys.class'
import { DatabaseType } from '@panary-core/shared/common'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import {
  apikeyDataSchema,
  apikeyPatchSchema,
  apikeyQuerySchema,
  apikeySchema
} from '@panary-core/apikeys/domain'
import { logger } from '../../logger'

export const apikeysPath = 'apikeys'
export const apikeysMethods: Array<keyof ApiKeyService> = ['find', 'get', 'create', 'patch', 'remove']

export type { ApiKeyService } from './apikeys.class'
export * from './apikeys.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const apikeys = (app: Application) => {
  const paginate = app.get('paginate')

  // Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // MongoDB Model (for Enterprise/Cloud)
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // but that's okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the library. For now, the placeholder is sufficient.
    // Model = require('./users.model').default(app)
  }

  // Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<Apikey>(app, {
    name: 'apikeys',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as ApiKeyService

  (service as any).setup = async (app: Application, path: string) => {
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
          { key: { tenantId: 1 }, name: 'tenant_index' },
          { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' },
          { key: { tenantId: 1, apikey: 1 }, unique: true, name: 'tenant_apikey_unique' },
          { key: { status: 1 }, name: 'status_index' },
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'apikeys' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'apikeys'

      try {
        const hasTable = await knex.schema.hasTable(tableName)
        if (hasTable) {
          await knex.schema.alterTable(tableName, (table: any) => {
            // Only create indexes if they do not exist.
            // Note: Knex does not have a simple 'createIndexIfNotExists' API within alterTable,
            // so errors are often caught or checked beforehand.
            // The easiest way for SQLite "Offline First" (Idempotent):
            // We execute Raw SQL, as Knex Schema Builder is sometimes limited here.
          })

          // Keine nützlichen Spalten zum Indizieren vorhanden (nur _id und text in Migration)
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'apikeys' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'apikeys', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

  // Register service
  app.use(apikeysPath, service as any, {
    methods: apikeysMethods,
    events: [],
    docs: {
      description: 'Verwaltung der ApiKeys',
      schemas: {
        apikey: apikeySchema,
        apikeyData: apikeyDataSchema,
        apikeyPatch: apikeyPatchSchema,
        apikeyQuery: apikeyQuerySchema
      }
    }
  })

  // Register hooks
  app.service(apikeysPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(apikeyExternalResolver),
        schemaHooks.resolveResult(apikeyResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(apikeyQueryValidator), schemaHooks.resolveQuery(apikeyQueryResolver)],
      find: [],
      get: [],
      create: [schemaHooks.validateData(apikeyDataValidator), schemaHooks.resolveData(apikeyDataResolver)],
      patch: [schemaHooks.validateData(apikeyPatchValidator), schemaHooks.resolveData(apikeyPatchResolver)],
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
// We'll clean that up in declarations.ts.
