import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

import { SyncOp } from './sync-op.schema'

/**
 * Sync-Run = ein einzelner, fachlich relevanter Sync-Vorgang im
 * Edge↔Cloud-Replikations-Pfad. Wird ausschliesslich vom Edge geschrieben
 * (lokale SQLite-Persistenz), damit die Cloud-Connection-Seite des Admin-
 * Panels eine chronologische Uebersicht anzeigen kann — auch wenn der Edge
 * gerade offline ist.
 *
 * Filter-Regel "nur sinnvolle Vorgaenge": stille Heartbeats und leere Pulls
 * werden gar nicht erst geschrieben (siehe recordSyncRun-Helper).
 */

export const SyncRunPhase = {
  BOOTSTRAP: 'bootstrap',
  PUSH: 'push',
  PULL: 'pull',
  HEARTBEAT: 'heartbeat',
  RECONCILE: 'reconcile',
} as const
export type SyncRunPhase = (typeof SyncRunPhase)[keyof typeof SyncRunPhase]

export const SyncRunDirection = {
  EDGE_TO_CLOUD: 'edge-to-cloud',
  CLOUD_TO_EDGE: 'cloud-to-edge',
} as const
export type SyncRunDirection = (typeof SyncRunDirection)[keyof typeof SyncRunDirection]

export const SyncRunOutcome = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILURE: 'failure',
} as const
export type SyncRunOutcome = (typeof SyncRunOutcome)[keyof typeof SyncRunOutcome]

export const SyncRunTrigger = {
  BOOTSTRAP: 'bootstrap',
  SCHEDULER: 'scheduler',
  MANUAL: 'manual',
  STARTUP: 'startup',
} as const
export type SyncRunTrigger = (typeof SyncRunTrigger)[keyof typeof SyncRunTrigger]

/**
 * Ergebnis-Status eines einzelnen Records innerhalb eines Sync-Vorgangs.
 * - `accepted`: Push erfolgreich von der Cloud uebernommen / Pull lokal angewandt.
 * - `rejected`: Cloud hat den Push final abgelehnt (terminal, kein Retry).
 * - `conflict`: Daten-Konflikt — wurde zur User-Resolution eskaliert.
 * - `retry`:    Transienter Reject — wird mit Backoff erneut versucht.
 */
export const SyncRunRecordStatus = {
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CONFLICT: 'conflict',
  RETRY: 'retry',
} as const
export type SyncRunRecordStatus = (typeof SyncRunRecordStatus)[keyof typeof SyncRunRecordStatus]

/**
 * Ein einzelner Record, der im Rahmen eines sync-runs synchronisiert wurde.
 * Wird als gekappte Liste (`MAX_SYNC_RUN_DETAILS`) im `details`-Feld des
 * sync-run-Eintrags persistiert, damit der Operator im Admin-Panel exakt
 * nachvollziehen kann, WELCHE Records (Entity-Typ + ID + Operation) ein Push/
 * Pull betraf — und das gegen die DB abgleichen kann.
 */
export const syncRunRecordDetailSchema = Type.Object(
  {
    // Service-/Entity-Typ (z.B. `orders`, `order-interactions`, `users`).
    service: Type.String({ minLength: 1, maxLength: 80 }),
    entityId: Type.String({ maxLength: 80 }),
    op: StringEnum(Object.values(SyncOp)),
    status: Type.Optional(StringEnum(Object.values(SyncRunRecordStatus))),
    // Klartext-Begruendung bei rejected/conflict (Cloud-Reject-Reason).
    reason: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { $id: 'SyncRunRecordDetail', additionalProperties: false },
)
export type SyncRunRecordDetail = Static<typeof syncRunRecordDetailSchema>

export const syncRunSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    // Tenant-Affiliation — uuidv7-String, konsistent mit baseSchema-Konvention
    // (siehe libs/shared/common/src/lib/schemas/base.schema.ts).
    tenantId: Type.String({ format: 'uuid' }),
    phase: StringEnum(Object.values(SyncRunPhase)),
    direction: StringEnum(Object.values(SyncRunDirection)),
    /**
     * Service-Name (z.B. `users`, `products`, `product-groups`). `null` fuer
     * aggregierte Phasen wie `heartbeat`, die keinen einzelnen Service betreffen.
     */
    service: Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
    recordCount: Type.Integer({ minimum: 0 }),
    accepted: Type.Optional(Type.Integer({ minimum: 0 })),
    rejected: Type.Optional(Type.Integer({ minimum: 0 })),
    archived: Type.Optional(Type.Integer({ minimum: 0 })),
    durationMs: Type.Integer({ minimum: 0 }),
    outcome: StringEnum(Object.values(SyncRunOutcome)),
    errorMessage: Type.Optional(Type.String({ maxLength: 1000 })),
    triggeredBy: StringEnum(Object.values(SyncRunTrigger)),
    /**
     * Optionale Korrelation zu einem Bootstrap-Report. Wird vom Bootstrap-
     * Worker gesetzt, damit der Report alle zugehoerigen sync-runs
     * verlinken kann. Bei Sync-Scheduler-Runs (Heartbeat etc.) `undefined`.
     */
    bootstrapReportId: Type.Optional(Type.String({ format: 'uuid' })),
    /**
     * Per-Record-Details des Vorgangs (gekappt auf MAX_SYNC_RUN_DETAILS).
     * In SQLite als JSON-TEXT-Spalte persistiert: der recordSyncRun-Helper
     * uebergibt ein Array (validateData erwartet ein Array), Knex serialisiert
     * es beim Insert, der resolveResult des sync-runs-Service parsed beim Lesen
     * zurueck. `undefined` bei Vorgaengen ohne erfasste Records (z.B. Fehler vor
     * dem ersten Record).
     */
    details: Type.Optional(Type.Array(syncRunRecordDetailSchema)),
    startedAt: Type.String({ format: 'date-time' }),
    finishedAt: Type.String({ format: 'date-time' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncRun', additionalProperties: false },
)
export type SyncRun = Static<typeof syncRunSchema>

// Internes Create-Schema — ohne createdAt/updatedAt (wird im Resolver gesetzt).
export const syncRunDataSchema = Type.Omit(syncRunSchema, ['createdAt', 'updatedAt'], {
  $id: 'SyncRunData',
})
export type SyncRunData = Static<typeof syncRunDataSchema>

// Patch-Schema — Sync-Runs sind append-only fuer externe Aufrufer; existiert
// nur, damit Feathers-Service-Typings keine Compile-Fehler werfen.
export const syncRunPatchSchema = Type.Partial(syncRunSchema, { $id: 'SyncRunPatch' })
export type SyncRunPatch = Static<typeof syncRunPatchSchema>

export const syncRunQueryProperties = Type.Pick(syncRunSchema, [
  '_id',
  'tenantId',
  'phase',
  'direction',
  'service',
  'outcome',
  'startedAt',
  'createdAt',
  // Pflicht fuer collectSyncRunIds(reportId) im Bootstrap-Report-Helper:
  // ohne diesen Pick blockt AJV den Find mit "additional properties" und der
  // try/catch in collectSyncRunIds verschluckt es zu []. Folge: leere
  // syncRunIds im Report-JSON-Dump trotz vorhandener DB-Records.
  'bootstrapReportId',
])

export const syncRunQuerySchema = Type.Intersect(
  [querySyntax(syncRunQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type SyncRunQuery = Static<typeof syncRunQuerySchema>
