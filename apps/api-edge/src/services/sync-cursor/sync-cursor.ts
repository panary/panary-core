import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { validateData } from '../../hooks/validate-data.hook'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { authorize, dataValidator, queryValidator } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  type SyncCursor,
  syncCursorDataSchema,
  syncCursorPatchSchema,
  syncCursorQuerySchema,
} from '@panary/sync/domain'

import type { Application, HookContext } from '../../declarations'

export const syncCursorPath = 'sync-cursor'

// Create validiert gegen das Data-Schema (ohne createdAt/updatedAt) — die
// Timestamps stempelt der syncCursorDataResolver NACH der Validierung.
const syncCursorDataValidator = getValidator(syncCursorDataSchema, dataValidator)
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
        // KEIN multiTenancy() — wie bei `sync-outbox`: sync-cursor ist
        // edge-internaler Sync-Zustand, die Tabelle hat keine `tenantId`-Spalte
        // (Migration 20260502000004_sync_cursor) und das Domain-Schema kennt das
        // Feld nicht. Der Hook machte den Service extern vollstaendig unbenutzbar,
        // in BEIDE Richtungen: Er stempelte `data.tenantId` (→ 400 „must NOT have
        // additional properties" am geschlossenen Data-/Patch-Schema) und setzte
        // `query.tenantId` (→ 400 am geschlossenen Query-Schema). Beides ist nie
        // aufgefallen, weil der Cursor ausschliesslich intern geschrieben wird
        // (`cloud-sync-scheduler.worker.ts`, `repair-location-restamp.worker.ts`
        // mit `provider: undefined` und ohne `user`) — der Hook laeuft dort ins
        // Early-Return. Gefunden vom erweiterten Boot-Check (#267).
        //
        // Sicherheit kommt durch authenticate('jwt') + RBAC; ein Edge bedient
        // genau einen Tenant, Cross-Tenant-Leckage ist strukturell ausgeschlossen.
        schemaHooks.resolveExternal(syncCursorExternalResolver),
        schemaHooks.resolveResult(syncCursorResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(syncCursorQueryValidator), schemaHooks.resolveQuery(syncCursorQueryResolver)],
      create: [validateData(syncCursorDataValidator), schemaHooks.resolveData(syncCursorDataResolver)],
      patch: [validateData(syncCursorPatchValidator), schemaHooks.resolveData(syncCursorPatchResolver)],
    },
    error: { all: [] },
  })
}
