import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { authorize, dataValidator, queryValidator } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  type SyncOutboxEntry,
  syncOutboxEntryDataSchema,
  syncOutboxEntryPatchSchema,
  syncOutboxEntryQuerySchema,
  SyncOutboxStatus,
} from '@panary/sync/domain'

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
  // Pflicht-Default: Neue Outbox-Eintraege sind sofort faellig
  // (nextAttemptAt = occurredAt). Verhindert NULL-Werte, die der Worker-
  // Query nicht filtern kann (AJV laesst NULL fuer date-time-Format nicht
  // zu; siehe sync-hardening-adr Hotfix 2026-05-19). Bei transient Retries
  // setzt der Worker das Feld auf now + backoffMs(attempts) neu.
  nextAttemptAt: async (_value, data) => {
    const d = data as Partial<SyncOutboxEntry>
    return d.occurredAt ?? new Date().toISOString()
  },
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
        // KEIN multiTenancy() — sync-outbox ist edge-internal Workflow-State,
        // die DB-Tabelle hat keine `tenantId`-Spalte. Der Hook wuerde
        // `query.tenantId = user.tenantId` einstempeln und damit jede
        // authentifizierte UI-Anfrage mit "additional properties: tenantId"
        // ablehnen. Sicherheit kommt durch authenticate('jwt') + RBAC
        // (SYNC_OUTBOX: MANAGE nur fuer Owner/Manager/Technician) —
        // single-tenant Edge erlaubt keine Cross-Tenant-Leckage.
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
