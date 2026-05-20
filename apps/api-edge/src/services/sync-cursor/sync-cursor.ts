import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { authorize, multiTenancy, dataValidator, queryValidator } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  type SyncCursor,
  syncCursorPatchSchema,
  syncCursorQuerySchema,
  syncCursorSchema,
} from '@panary/sync/domain'

import type { Application, HookContext } from '../../declarations'

export const syncCursorPath = 'sync-cursor'

const syncCursorDataValidator = getValidator(syncCursorSchema, dataValidator)
const syncCursorPatchValidator = getValidator(syncCursorPatchSchema, dataValidator)
const syncCursorQueryValidator = getValidator(syncCursorQuerySchema, queryValidator)

const syncCursorResolver = resolve<SyncCursor, HookContext>({})
const syncCursorExternalResolver = resolve<SyncCursor, HookContext>({})

const syncCursorDataResolver = resolve<SyncCursor, HookContext>({
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

const syncCursorPatchResolver = resolve<SyncCursor, HookContext>({
  _id: async () => undefined,
  service: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})

const syncCursorQueryResolver = resolve<SyncCursor, HookContext>({})

export const syncCursor = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<SyncCursor>(app, {
    name: syncCursorPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  })

  app.use(syncCursorPath, service as any, {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: [],
  })

  app.service(syncCursorPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(syncCursorExternalResolver),
        schemaHooks.resolveResult(syncCursorResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(syncCursorQueryValidator),
        schemaHooks.resolveQuery(syncCursorQueryResolver),
      ],
      create: [
        schemaHooks.validateData(syncCursorDataValidator),
        schemaHooks.resolveData(syncCursorDataResolver),
      ],
      patch: [
        schemaHooks.validateData(syncCursorPatchValidator),
        schemaHooks.resolveData(syncCursorPatchResolver),
      ],
    },
    error: { all: [] },
  })
}
