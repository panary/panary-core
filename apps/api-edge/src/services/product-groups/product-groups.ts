import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  productGroupDataResolver,
  productGroupDataValidator,
  productGroupExternalResolver,
  productGroupPatchResolver,
  productGroupPatchValidator,
  productGroupQueryResolver,
  productGroupQueryValidator,
  productGroupResolver
} from './product-groups.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  productGroupDataSchema,
  productGroupPatchSchema,
  productGroupQuerySchema,
  productGroupSchema
} from '@panary/product-groups/domain'
import type { ProductGroup, ProductGroupService } from './product-groups.class'
import { ensureIndexes } from '@panary/shared-backend'

export const productGroupsPath = 'product-groups'
export const productGroupsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './product-groups.schema'

export const productGroups = (app: Application) => {
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
  const service = createServiceAdapter<ProductGroup>(app, {
    name: 'product-groups',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as ProductGroupService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'product-groups',
      [
        { name: 'idx_product_groups_tenant', columns: ['tenantId'] },
        { name: 'idx_product_groups_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_product_groups_status', columns: ['status'] },
        {
          name: 'idx_product_groups_tenant_externalId_unique',
          columns: ['tenantId', 'externalId'],
          unique: true,
          dbTypes: [DatabaseType.MONGODB],
        },
      ],
      service,
    )

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(productGroupsPath, service as any, {
    methods: productGroupsMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Product Groups.',
      schemas: {
        productGroup: productGroupSchema,
        productGroupData: productGroupDataSchema,
        productGroupPatch: productGroupPatchSchema,
        productGroupQuery: productGroupQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(productGroupsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(productGroupExternalResolver),
        schemaHooks.resolveResult(productGroupResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(productGroupQueryValidator),
        schemaHooks.resolveQuery(productGroupQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(productGroupDataValidator),
        schemaHooks.resolveData(productGroupDataResolver)
      ],
      patch: [
        schemaHooks.validateData(productGroupPatchValidator),
        schemaHooks.resolveData(productGroupPatchResolver)
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
