// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  apikeyDataResolver,
  apikeyDataValidator,
  apikeyExternalResolver,
  apikeyPatchResolver,
  apikeyPatchValidator,
  apikeyQueryResolver,
  apikeyQueryValidator,
  apikeyResolver
} from './apikeys.schema'

import type { Application } from '../../declarations'
import { Apikey, ApiKeyService } from './apikeys.class'
import { DatabaseType } from '@panary-core/shared/common'
import { createServiceAdapter } from '@panary-core/shared/data-access'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'

export const apikeysPath = 'apikeys'
export const apikeysMethods: Array<keyof ApiKeyService> = ['find', 'get', 'create', 'patch', 'remove']

export type { ApiKeyService } from './apikeys.class'
export * from './apikeys.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const apikeys = (app: Application) => {
  const paginate = app.get('paginate')

  // Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // MongoDB Model (for Enterprise/Cloud)
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // but that's okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the library. For now, the placeholder is sufficient.
    // Model = require('./users.model').default(app)
  }

  // Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<Apikey>(app, {
    name: 'users',
    Model,
    paginate,
    id: '_id',
    multi: []
  })

  // Register service
  app.use(apikeysPath, service as any, {
    methods: apikeysMethods,
    events: []
  })

  // Register hooks
  app.service(apikeysPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(apikeyExternalResolver),
        schemaHooks.resolveResult(apikeyResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(apikeyQueryValidator), schemaHooks.resolveQuery(apikeyQueryResolver)],
      find: [],
      get: [],
      create: [schemaHooks.validateData(apikeyDataValidator), schemaHooks.resolveData(apikeyDataResolver)],
      patch: [schemaHooks.validateData(apikeyPatchValidator), schemaHooks.resolveData(apikeyPatchResolver)],
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
// We'll clean that up in declarations.ts.
