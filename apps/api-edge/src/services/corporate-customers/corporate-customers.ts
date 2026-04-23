import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  corporateCustomerDataResolver,
  corporateCustomerDataValidator,
  corporateCustomerExternalResolver,
  corporateCustomerPatchResolver,
  corporateCustomerPatchValidator,
  corporateCustomerQueryResolver,
  corporateCustomerQueryValidator,
  corporateCustomerResolver
} from './corporate-customers.schema'

import type { Application } from '../../declarations'
import type { CorporateCustomer, CorporateCustomerService } from './corporate-customers.class'
import { authorize } from '@panary-core/shared-backend'
import { multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  corporateCustomerDataSchema,
  corporateCustomerPatchSchema,
  corporateCustomerQuerySchema,
  corporateCustomerSchema
} from '@panary-core/corporate-customers/domain'
import { ensureIndexes } from '@panary-core/shared-backend'

export const corporateCustomersPath = 'corporate-customers'
export const corporateCustomersMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './corporate-customers.schema'

export const corporateCustomers = (app: Application) => {
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
  const service = createServiceAdapter<CorporateCustomer>(app, {
    name: 'corporate-customers',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as CorporateCustomerService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'corporate-customers',
      [
        { name: 'idx_corporate_customers_tenant', columns: ['tenantId'] },
        { name: 'idx_corporate_customers_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_corporate_customers_status', columns: ['status'] },
      ],
      service,
    )

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(corporateCustomersPath, service as any, {
    methods: corporateCustomersMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Corporate Customers',
      schemas: {
        corporateCustomer: corporateCustomerSchema,
        corporateCustomerData: corporateCustomerDataSchema,
        corporateCustomerPatch: corporateCustomerPatchSchema,
        corporateCustomerQuery: corporateCustomerQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(corporateCustomersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(corporateCustomerExternalResolver),
        schemaHooks.resolveResult(corporateCustomerResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(corporateCustomerQueryValidator),
        schemaHooks.resolveQuery(corporateCustomerQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(corporateCustomerDataValidator),
        schemaHooks.resolveData(corporateCustomerDataResolver)
      ],
      patch: [
        schemaHooks.validateData(corporateCustomerPatchValidator),
        schemaHooks.resolveData(corporateCustomerPatchResolver)
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
