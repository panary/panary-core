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
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared/common'
import {
  corporateCustomerDataSchema,
  corporateCustomerPatchSchema,
  corporateCustomerQuerySchema,
  corporateCustomerSchema
} from '@panary-core/corporate-customers/domain'
import { logger } from '../../logger'

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

  (service as any).setup = async (app: Application, path: string) => {
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
          // TODO: Add specific indexes, e.g.
          { key: { tenantId: 1 }, name: 'tenant_index' },
          { key: { tenantId: 1, locationId: 1 }, name: 'tenant_location_index' },
          { key: { status: 1 }, name: 'status_index' },
        ])
        logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'mongodb', service: 'corporate-customers' })
      }
    }

    // --- B) SQLITE / KNEX STRATEGY ---
    else if (dbType === DatabaseType.SQLITE) {
      // At Knex, the 'model' is the query builder (knex instance).
      const knex = app.get('sqliteClient') // Or app.get('knexClient')
      const tableName = 'corporate-customers'

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
            `CREATE INDEX IF NOT EXISTS idx_corporate_customers_tenant ON "${tableName}" (tenantId)`
          )
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS idx_corporate_customers_tenant_location ON "${tableName}" (tenantId, locationId)`
          )
          await knex.raw(`CREATE INDEX IF NOT EXISTS idx_corporate_customers_status ON "${tableName}" (status)`)
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'corporate-customers' })
        }
      } catch (error) {
        logger.error({ message: 'Failed to ensure indexes', event: 'db.indexes_error', dbType: 'sqlite', service: 'corporate-customers', error: String(error) })
        // App should still start, maybe the database is locked
      }
    }
  }

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
