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
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  productGroupDataSchema,
  productGroupPatchSchema,
  productGroupQuerySchema,
  productGroupSchema
} from '@panary-core/product-groups/domain'
import type { ProductGroup, ProductGroupService } from './product-groups.class'
import { logger } from '../../logger'

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
          { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' },
          { key: { tenantId: 1, externalId: 1 }, unique: true, name: 'tenant_externalId_unique' },
          { key: { status: 1 }, name: 'status_index' },
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'product-groups' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'product-groups'

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
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_product_groups_tenant ON "${tableName}" (tenantId)`)
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_product_groups_tenant_location ON "${tableName}" (tenantId, locationId)`
          )
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_product_groups_status ON "${tableName}" (status)`)
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'product-groups' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'product-groups', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

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
