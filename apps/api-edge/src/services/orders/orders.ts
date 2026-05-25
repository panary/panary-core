import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { getJsonFieldHooks } from '@panary/shared-backend'

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
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import { orderDataSchema, orderPatchSchema, orderQuerySchema, orderSchema } from '@panary/orders/domain'
import type { Order, OrderService } from './orders.class'
import { extractOrderInteractions } from '../../hooks/extract-order-interactions'
import { restrictOrderToBusinessDay } from '../../hooks/restrict-order-to-business-day'
import { assignDailySequenceNumber } from '../../hooks/assign-daily-sequence-number'
import { calculateTaxDetails } from '../../hooks/calculate-tax-details'
import { applyAutomaticDiscounts } from '../../hooks/apply-automatic-discounts'
import { checkMultiOperation } from '../../hooks/check-multi-operation'
import { createOrderInteractions } from '../../hooks/create-order-interactions'
import { ensureIndexes } from '@panary/shared-backend'

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

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'orders',
      [
        { name: 'idx_orders_tenant', columns: ['tenantId'] },
        { name: 'idx_orders_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_orders_status', columns: ['status'] },
      ],
      service,
    )

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

  const jsonHooks = getJsonFieldHooks(app, ORDER_JSON_FIELDS)

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
        // Automatik-Rabatte VOR der Steuerberechnung injizieren (greift nur ohne
        // bereits gesetzten manuellen Rabatt — Kombinationsregel Phase 2).
        applyAutomaticDiscounts,
        calculateTaxDetails,
        schemaHooks.validateData(orderDataValidator),
        schemaHooks.resolveData(orderDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        checkMultiOperation,
        schemaHooks.validateData(orderPatchValidator),
        schemaHooks.resolveData(orderPatchResolver),
        ...jsonHooks.before,
      ],
      remove: []
    },
    after: {
      all: [
        ...jsonHooks.after,
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
