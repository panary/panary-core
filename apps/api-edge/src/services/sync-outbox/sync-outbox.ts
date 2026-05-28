import { authenticate } from '@feathersjs/authentication'
import { BadRequest } from '@feathersjs/errors'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { authorize, dataValidator, queryValidator } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  type ReEnqueueOutboxArgs,
  reEnqueueOutboxArgsSchema,
  SyncOp,
  SyncSource,
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
const reEnqueueArgsValidator = getValidator(reEnqueueOutboxArgsSchema, dataValidator)

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

/**
 * Re-Enqueue: aus einem rejected Outbox-Eintrag wird ein frischer pending-
 * Eintrag mit dem AKTUELLEN Stand des Edge-Records erzeugt. Anschliessend wird
 * die alte rejected-Row entfernt, damit die Operator-UI clean bleibt (kein
 * doppelter Zeileneintrag).
 *
 * Operator-Use-Case: Cloud hat den urspruenglichen Push wegen Schema-Mismatch
 * abgelehnt. Der lokale Datensatz wurde inzwischen korrigiert. Statt den
 * Eintrag zu „verwerfen" (was nur den Outbox-State loescht, NICHT den Edge-
 * Record cloud-faehig macht), schickt diese Methode den Datensatz frisch
 * in die Sync-Schlange.
 *
 * Vertrag:
 *  - Nur Status `rejected` ist erlaubt. Verhindert Races mit pending/in-flight
 *    (Worker arbeitet diese gerade ab) und mit acked (bereits synchronisiert).
 *  - Der `op`-Wert wird BEIBEHALTEN. Wurde ein `create` von der Cloud nie
 *    angenommen, existiert dort kein Record — ein `patch` wuerde 404. Daher
 *    nicht „immer patch", sondern semantisch korrektes Re-Enqueue.
 *  - Bei `create`/`patch` wird der Edge-Record nachgeladen, um den frischen
 *    Payload-Stand zu pushen. Bei `remove` ist kein Refetch noetig (Payload
 *    leer; entityId reicht).
 *  - Wenn der Edge-Record bei `create`/`patch` lokal nicht mehr existiert
 *    (vom Operator geloescht), erhaelt der Aufrufer einen klaren BadRequest —
 *    die alte rejected-Row bleibt erhalten, es gehen keine Daten verloren.
 */
async function reEnqueueOutboxEntry(
  app: Application,
  data: ReEnqueueOutboxArgs,
): Promise<SyncOutboxEntry> {
  await reEnqueueArgsValidator(data)

  const outboxService = app.service(syncOutboxPath) as unknown as {
    get(id: string, params: { provider: undefined }): Promise<SyncOutboxEntry>
    create(data: Partial<SyncOutboxEntry>, params: { provider: undefined }): Promise<SyncOutboxEntry>
    remove(id: string, params: { provider: undefined }): Promise<unknown>
  }

  const entry = await outboxService.get(data.id, { provider: undefined })

  if (entry.status !== SyncOutboxStatus.REJECTED) {
    throw new BadRequest(
      `Nur abgelehnte Eintraege koennen erneut eingereiht werden (Status: ${entry.status})`,
    )
  }

  let payload: unknown = undefined
  if (entry.op === SyncOp.CREATE || entry.op === SyncOp.PATCH) {
    try {
      // `entry.service` ist ein generischer string aus der Outbox-Row, deshalb
      // wird der Pfad ueber `any` aufgeloest — Feathers' typisiertes Registry
      // akzeptiert nur die Union der registrierten Service-Pfade.
      payload = await (app.service(entry.service as never) as unknown as {
        get(id: string, params: { provider: undefined }): Promise<unknown>
      }).get(entry.entityId, { provider: undefined })
    } catch {
      throw new BadRequest(
        'Lokaler Datensatz existiert nicht mehr — kann nicht erneut eingereiht werden',
      )
    }
  }

  const newEntry = await outboxService.create(
    {
      _id: uuidv7(),
      service: entry.service,
      op: entry.op,
      entityId: entry.entityId,
      payload,
      occurredAt: new Date().toISOString(),
      syncSource: SyncSource.LIVE,
    },
    { provider: undefined },
  )

  await outboxService.remove(entry._id, { provider: undefined })

  return newEntry
}

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

  ;(service as unknown as { reEnqueue: (data: ReEnqueueOutboxArgs) => Promise<SyncOutboxEntry> })
    .reEnqueue = (data: ReEnqueueOutboxArgs) => reEnqueueOutboxEntry(app, data)

  ;(app as any).use(syncOutboxPath, service, {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'reEnqueue'],
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
