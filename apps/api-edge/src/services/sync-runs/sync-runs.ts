// Edge-Sync-Runs-Service.
//
// Fachliche Telemetrie ueber alle nicht-leeren Sync-Vorgaenge — wird vom
// Edge-Admin-Panel als History-Liste auf der Cloud-Connection-Seite angezeigt.
//
// - Methoden: find, get. create ist NICHT registriert: Eintraege werden
//   ausschliesslich von den Sync-Workern via `recordSyncRun(app, ...)`
//   geschrieben (siehe record-sync-run.helper.ts).
// - Tenant-Isolation via multiTenancy(). isolateLocation:false, weil sync-runs
//   tenant-weit relevant sind (Edge ist single-location, aber semantisch nicht
//   filial-spezifisch — z.B. heartbeat).
// - Append-Telemetrie, KEIN SQLite-Trigger gegen UPDATE/DELETE: der Cleanup-
//   Worker (sync-runs-cleanup.worker.ts) braucht DELETE.
import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'
import { hooks as schemaHooks, resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  type SyncRun,
  type SyncRunData,
  syncRunDataSchema,
  syncRunQuerySchema,
} from '@panary/sync/domain'
import {
  authorize,
  dataValidator,
  multiTenancy,
  queryValidator,
} from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'

import type { Application, HookContext, NextFunction } from '../../declarations'

export const syncRunsPath = 'sync-runs'

const syncRunDataValidator = getValidator(syncRunDataSchema, dataValidator)
const syncRunQueryValidator = getValidator(syncRunQuerySchema, queryValidator)

const syncRunResolver = resolve<SyncRun, HookContext>({
  // SQLite gibt die JSON-TEXT-Spalte `details` als String zurueck (Knex parsed
  // beim SELECT nicht) — hier zurueck in ein Array wandeln, damit das Frontend
  // direkt damit arbeiten kann. Identisches Muster wie sync-conflicts-Payloads.
  details: async value => {
    if (value == null) return undefined
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  },
})
const syncRunExternalResolver = resolve<SyncRun, HookContext>({})

const syncRunDataResolver = resolve<SyncRun, HookContext>({
  _id: async value => value || uuidv7(),
  createdAt: async (value, entity) =>
    value || (entity as { startedAt?: string })?.startedAt || new Date().toISOString(),
  updatedAt: async (value, entity) =>
    value || (entity as { startedAt?: string })?.startedAt || new Date().toISOString(),
})

const syncRunQueryResolver = resolve<SyncRun, HookContext>({})

// Around-Hook: blockt externe Schreibzugriffe — nur intern via
// `provider: undefined` darf der Sync-Run-Helper Eintraege anlegen.
const blockExternalWrites = async (context: HookContext, next: NextFunction) => {
  if (context.method === 'create' && context.params.provider) {
    throw new Forbidden('Sync-Runs werden nur intern vom Sync-Worker erzeugt')
  }
  await next()
}

export const syncRuns = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<SyncRun, SyncRunData>(app, {
    name: syncRunsPath,
    Model,
    paginate,
    id: '_id',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(syncRunsPath, service as any, {
    // create wird NICHT exponiert — der recordSyncRun-Helper ruft es intern
    // via _create() (Adapter-API, umgeht Hooks). Wir registrieren `create`
    // trotzdem als Methode, damit die internen Calls funktionieren — der
    // around-Hook unten blockt externe Aufrufer.
    methods: ['find', 'get', 'create'],
    events: [],
  })

  app.service(syncRunsPath).hooks({
    around: {
      all: [
        blockExternalWrites,
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(syncRunExternalResolver),
        schemaHooks.resolveResult(syncRunResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(syncRunQueryValidator),
        schemaHooks.resolveQuery(syncRunQueryResolver),
      ],
      create: [
        schemaHooks.validateData(syncRunDataValidator),
        schemaHooks.resolveData(syncRunDataResolver),
      ],
    },
    after: { all: [] },
    error: { all: [] },
  })
}
