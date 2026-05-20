import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  productsDataResolver,
  productsDataValidator,
  productsExternalResolver,
  productsPatchResolver,
  productsPatchValidator,
  productsQueryResolver,
  productsQueryValidator,
  productsResolver
} from './products.schema'

import type { Application } from '../../declarations'
import type { Product, ProductService } from './products.class'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { getJsonFieldHooks } from '@panary/shared-backend'

const PRODUCT_JSON_FIELDS = ['categoryIds', 'optionGroups', 'availability', 'ui', 'ingredientReferences', 'recipeReferences']
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  productDataSchema,
  productPatchSchema,
  productQuerySchema,
  productSchema
} from '@panary/products/domain'
import { ensureIndexes } from '@panary/shared-backend'

export const productsPath = 'products'
export const productsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './products.schema'
export type { ProductService } from './products.class'

export const products = (app: Application) => {
  const paginate = app.get('paginate')

  // Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // MongoDB Model (für Enterprise/Cloud)
    // Model = require('./products.model').default(app)
  }

  // Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<Product>(app, {
    name: 'products',
    Model,
    paginate,
    id: '_id',
    multi: ['create', 'patch', 'remove']
  }) as unknown as ProductService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'products',
      [
        { name: 'idx_products_tenant', columns: ['tenantId'] },
        { name: 'idx_products_tenant_location', columns: ['tenantId', 'locationId'] },
        {
          name: 'idx_products_tenant_externalId_unique',
          columns: ['tenantId', 'externalId'],
          unique: true,
          whereSqlite: 'externalId IS NOT NULL',
        },
        { name: 'idx_products_status', columns: ['status'] },
        // SQLite: prefix-LIKE-Unterstuetzung ueber normalen Index auf name.
        { name: 'idx_products_name', columns: ['name'], dbTypes: [DatabaseType.SQLITE] },
        // MongoDB: echter Text-Index fuer Suche ueber name + acronym.
        {
          name: 'idx_products_text_search',
          columns: ['name', 'acronym'],
          mongoSpec: { name: 'text', acronym: 'text' },
          dbTypes: [DatabaseType.MONGODB],
        },
      ],
      service,
    )

  // 4. Register service
  app.use(productsPath, service as any, {
    methods: productsMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Produkte',
      schemas: {
        product: productSchema,
        productData: productDataSchema,
        productPatch: productPatchSchema,
        productQuery: productQuerySchema
      }
    }
  })

  const jsonHooks = getJsonFieldHooks(app, PRODUCT_JSON_FIELDS)

  // 5. Register hooks
  app.service(productsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(productsExternalResolver),
        schemaHooks.resolveResult(productsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(productsQueryValidator),
        schemaHooks.resolveQuery(productsQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(productsDataValidator),
        schemaHooks.resolveData(productsDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        schemaHooks.validateData(productsPatchValidator),
        schemaHooks.resolveData(productsPatchResolver),
        ...jsonHooks.before,
      ],
      remove: []
    },
    after: {
      all: [
        ...jsonHooks.after,
      ]
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
