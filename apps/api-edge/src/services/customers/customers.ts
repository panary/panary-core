import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  customerDataResolver,
  customerDataValidator,
  customerExternalResolver,
  customerPatchResolver,
  customerPatchValidator,
  customerQueryResolver,
  customerQueryValidator,
  customerResolver
} from './customers.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  customerDataSchema,
  customerPatchSchema,
  customerQuerySchema,
  customerSchema
} from '@panary/customers/domain'
import type { Customer, CustomerService } from './customers.class'
import { ensureIndexes } from '@panary/shared-backend'

export const customersPath = 'customers'
export const customersMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './customers.schema'

export const customers = (app: Application) => {
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
  const service = createServiceAdapter<Customer>(app, {
    name: 'customers',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as CustomerService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'customers',
      [
        { name: 'idx_customers_tenant', columns: ['tenantId'] },
        { name: 'idx_customers_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_customers_status', columns: ['status'], dbTypes: [DatabaseType.MONGODB] },
      ],
      service,
    )

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(customersPath, service as any, {
    methods: customersMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Customers',
      schemas: {
        customer: customerSchema,
        customerData: customerDataSchema,
        customerPatch: customerPatchSchema,
        customerQuery: customerQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(customersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(customerExternalResolver),
        schemaHooks.resolveResult(customerResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(customerQueryValidator),
        schemaHooks.resolveQuery(customerQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(customerDataValidator),
        schemaHooks.resolveData(customerDataResolver)
      ],
      patch: [
        schemaHooks.validateData(customerPatchValidator),
        schemaHooks.resolveData(customerPatchResolver)
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
