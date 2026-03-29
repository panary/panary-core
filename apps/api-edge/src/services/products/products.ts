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
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { parseJsonFields } from '../../hooks/parse-json-fields.hook'
import { stringifyJsonFields } from '../../hooks/stringify-json-fields.hook'

const PRODUCT_JSON_FIELDS = ['categoryIds', 'optionGroups', 'availability', 'ui', 'recipeReferences']
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared/common'
import {
  productDataSchema,
  productPatchSchema,
  productQuerySchema,
  productSchema
} from '@panary-core/products/domain'
import { logger } from '../../logger'

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
          { key: { tenantId: 1 }, name: 'tenant_index' },
          { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' },
          { key: { tenantId: 1, externalId: 1 }, unique: true, name: 'tenant_externalId_unique' },
          { key: { status: 1 }, name: 'status_index' },
          // Text Index (Important for searching!)
          {
            key: { name: 'text', acronym: 'text' },
            name: 'text_search_index'
          }
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'products' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'products'

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

          // Safe way for SQLite indexes (idempotent):
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_products_tenant ON ${tableName} (tenantId)`)
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_products_tenant_location ON ${tableName} (tenantId, locationId)`
          )
          await knex.raw(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_external_unique ON ${tableName} (tenantId, externalId) WHERE externalId IS NOT NULL`
          )
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_products_status ON ${tableName} (status)`)

          // ATTENTION: SQLite does not have "text indexes" like MongoDB.
          // For full-text searches, you would need FTS5 tables.
          // However, a normal index on 'name' helps with 'LIKE "X%"' queries.
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_products_name ON ${tableName} (name)`)

          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'products' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'products', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

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
        stringifyJsonFields(...PRODUCT_JSON_FIELDS),
      ],
      patch: [
        schemaHooks.validateData(productsPatchValidator),
        schemaHooks.resolveData(productsPatchResolver),
        stringifyJsonFields(...PRODUCT_JSON_FIELDS),
      ],
      remove: []
    },
    after: {
      all: [
        parseJsonFields(...PRODUCT_JSON_FIELDS),
      ]
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
