import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { authorize, multiTenancy, dataValidator, queryValidator } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  type SyncOutboxEntry,
  syncOutboxEntryDataSchema,
  syncOutboxEntryPatchSchema,
  syncOutboxEntryQuerySchema,
  SyncOutboxStatus,
} from '@panary-core/sync/domain'

import type { Application, HookContext } from '../../declarations'

export const syncOutboxPath = 'sync-outbox'

const syncOutboxDataValidator = getValidator(syncOutboxEntryDataSchema, dataValidator)
const syncOutboxPatchValidator = getValidator(syncOutboxEntryPatchSchema, dataValidator)
const syncOutboxQueryValidator = getValidator(syncOutboxEntryQuerySchema, queryValidator)

const syncOutboxResolver = resolve<SyncOutboxEntry, HookContext>({})
const syncOutboxExternalResolver = resolve<SyncOutboxEntry, HookContext>({})

const syncOutboxDataResolver = resolve<SyncOutboxEntry, HookContext>({
  _id: async value => value || uuidv7(),
  status: async () => SyncOutboxStatus.PENDING,
  attempts: async () => 0,
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

const syncOutboxPatchResolver = resolve<SyncOutboxEntry, HookContext>({
  _id: async () => undefined,
  service: async () => undefined,
  op: async () => undefined,
  entityId: async () => undefined,
  occurredAt: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})

const syncOutboxQueryResolver = resolve<SyncOutboxEntry, HookContext>({})

export const syncOutbox = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<SyncOutboxEntry>(app, {
    name: syncOutboxPath,
    Model,
    paginate,
    id: '_id',
    multi: ['patch'],
  })

  app.use(syncOutboxPath, service as any, {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: [],
  })

  app.service(syncOutboxPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(syncOutboxExternalResolver),
        schemaHooks.resolveResult(syncOutboxResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(syncOutboxQueryValidator),
        schemaHooks.resolveQuery(syncOutboxQueryResolver),
      ],
      create: [
        schemaHooks.validateData(syncOutboxDataValidator),
        schemaHooks.resolveData(syncOutboxDataResolver),
      ],
      patch: [
        schemaHooks.validateData(syncOutboxPatchValidator),
        schemaHooks.resolveData(syncOutboxPatchResolver),
      ],
    },
    error: { all: [] },
  })
}
