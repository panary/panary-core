import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { parseJsonFields } from '@panary-core/shared-backend'
import { stringifyJsonFields } from '@panary-core/shared-backend'

const ORDER_JSON_FIELDS = ['lineItems', 'cancellation', 'customerPaymentInfo', 'discount', 'staffPaymentInfo', 'taxSnapshot', 'creationContext', 'payment']

import {
  orderDataResolver,
  orderDataValidator,
  orderExternalResolver,
  orderPatchResolver,
  orderPatchValidator,
  orderQueryResolver,
  orderQueryValidator,
  orderResolver
} from './orders.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary-core/shared-backend'
import { multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import { orderDataSchema, orderPatchSchema, orderQuerySchema, orderSchema } from '@panary-core/orders/domain'
import type { Order, OrderService } from './orders.class'
import { extractOrderInteractions } from '../../hooks/extract-order-interactions'
import { restrictOrderToBusinessDay } from '../../hooks/restrict-order-to-business-day'
import { assignDailySequenceNumber } from '../../hooks/assign-daily-sequence-number'
import { calculateTaxDetails } from '../../hooks/calculate-tax-details'
import { checkMultiOperation } from '../../hooks/check-multi-operation'
import { createOrderInteractions } from '../../hooks/create-order-interactions'
import { logger } from '@panary-core/shared-backend'

export const ordersPath = 'orders'
export const ordersMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './orders.schema'

export const orders = (app: Application) => {
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
  const service = createServiceAdapter<Order>(app, {
    name: 'orders',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as OrderService

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
          // TODO: Add specific indexes, e.g.
          { key: { tenantId: 1 }, name: 'tenant_index' },
          { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' },
          { key: { status: 1 }, name: 'status_index' }
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'orders' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'orders'

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
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_orders_tenant ON ${tableName} (tenantId)`)
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_orders_tenant_location ON ${tableName} (tenantId, locationId)`
          )
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_orders_status ON ${tableName} (status)`)
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'orders' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'orders', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(ordersPath, service as any, {
    methods: ordersMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Orders',
      schemas: {
        order: orderSchema,
        orderData: orderDataSchema,
        orderPatch: orderPatchSchema,
        orderQuery: orderQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(ordersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(orderExternalResolver),
        schemaHooks.resolveResult(orderResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(orderQueryValidator), schemaHooks.resolveQuery(orderQueryResolver)],
      find: [],
      get: [],
      create: [
        extractOrderInteractions(),
        restrictOrderToBusinessDay(),
        assignDailySequenceNumber(),
        calculateTaxDetails,
        schemaHooks.validateData(orderDataValidator),
        schemaHooks.resolveData(orderDataResolver),
        stringifyJsonFields(...ORDER_JSON_FIELDS),
      ],
      patch: [
        checkMultiOperation,
        schemaHooks.validateData(orderPatchValidator),
        schemaHooks.resolveData(orderPatchResolver),
        stringifyJsonFields(...ORDER_JSON_FIELDS),
      ],
      remove: []
    },
    after: {
      all: [
        parseJsonFields(...ORDER_JSON_FIELDS),
      ],
      create: [createOrderInteractions()]
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
