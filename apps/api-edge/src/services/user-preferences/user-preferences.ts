import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  userPreferenceDataResolver,
  userPreferenceDataValidator,
  userPreferenceExternalResolver,
  userPreferencePatchResolver,
  userPreferencePatchValidator,
  userPreferenceQueryResolver,
  userPreferenceQueryValidator,
  userPreferenceResolver
} from './user-preferences.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  userPreferenceDataSchema,
  userPreferencePatchSchema,
  userPreferenceQuerySchema,
  userPreferenceSchema
} from '@panary/user-preferences/domain'
import type { UserPreference, UserPreferenceService } from './user-preferences.class'
import { ensureIndexes } from '@panary/shared-backend'

export const userPreferencesPath = 'user-preferences'
export const userPreferencesMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './user-preferences.schema'

export const userPreferences = (app: Application) => {
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
  const service = createServiceAdapter<UserPreference>(app, {
    name: 'user-preferences',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as UserPreferenceService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'user-preferences',
      [
        { name: 'idx_user_preferences_tenant', columns: ['tenantId'] },
        { name: 'idx_user_preferences_tenant_location', columns: ['tenantId', 'locationId'] },
      ],
      service,
    )

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(userPreferencesPath, service as any, {
    methods: userPreferencesMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Produkte',
      schemas: {
        userPreference: userPreferenceSchema,
        userPreferenceData: userPreferenceDataSchema,
        userPreferencePatch: userPreferencePatchSchema,
        userPreferenceQuery: userPreferenceQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(userPreferencesPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(userPreferenceExternalResolver),
        schemaHooks.resolveResult(userPreferenceResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(userPreferenceQueryValidator),
        schemaHooks.resolveQuery(userPreferenceQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(userPreferenceDataValidator),
        schemaHooks.resolveData(userPreferenceDataResolver)
      ],
      patch: [
        schemaHooks.validateData(userPreferencePatchValidator),
        schemaHooks.resolveData(userPreferencePatchResolver)
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
