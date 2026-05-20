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
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  orderInteractionDataSchema,
  orderInteractionPatchSchema,
  orderInteractionQuerySchema,
  orderInteractionSchema
} from '@panary/order-interactions/domain'
import type { OrderInteraction, OrderInteractionService } from './order-interactions.class'
import { ensureIndexes } from '@panary/shared-backend'

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

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'order-interactions',
      [
        { name: 'idx_order_interactions_tenant', columns: ['tenantId'] },
        { name: 'idx_order_interactions_tenant_location', columns: ['tenantId', 'locationId'] },
      ],
      service,
    )

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
