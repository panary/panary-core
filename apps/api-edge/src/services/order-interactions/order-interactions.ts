import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  orderInteractionDataResolver,
  orderInteractionDataValidator,
  orderInteractionExternalResolver,
  orderInteractionPatchResolver,
  orderInteractionPatchValidator,
  orderInteractionQueryResolver,
  orderInteractionQueryValidator,
  orderInteractionResolver
} from './order-interactions.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary-core/shared-backend'
import { multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  orderInteractionDataSchema,
  orderInteractionPatchSchema,
  orderInteractionQuerySchema,
  orderInteractionSchema
} from '@panary-core/order-interactions/domain'
import type { OrderInteraction, OrderInteractionService } from './order-interactions.class'
import { logger } from '@panary-core/shared-backend'

export const orderInteractionsPath = 'order-interactions'
export const orderInteractionsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './order-interactions.schema'

export const orderInteractions = (app: Application) => {
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
  const service = createServiceAdapter<OrderInteraction>(app, {
    name: 'order-interactions',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as OrderInteractionService

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
          { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' }
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'order-interactions' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'order-interactions'

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
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_order_interactions_tenant ON "${tableName}" (tenantId)`
          )
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_order_interactions_tenant_location ON "${tableName}" (tenantId, locationId)`
          )
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'order-interactions' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'order-interactions', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(orderInteractionsPath, service as any, {
    methods: orderInteractionsMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Order Interactions',
      schemas: {
        orderInteraction: orderInteractionSchema,
        orderInteractionData: orderInteractionDataSchema,
        orderInteractionPatch: orderInteractionPatchSchema,
        orderInteractionQuery: orderInteractionQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(orderInteractionsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(orderInteractionExternalResolver),
        schemaHooks.resolveResult(orderInteractionResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(orderInteractionQueryValidator),
        schemaHooks.resolveQuery(orderInteractionQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(orderInteractionDataValidator),
        schemaHooks.resolveData(orderInteractionDataResolver)
      ],
      patch: [
        schemaHooks.validateData(orderInteractionPatchValidator),
        schemaHooks.resolveData(orderInteractionPatchResolver)
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
