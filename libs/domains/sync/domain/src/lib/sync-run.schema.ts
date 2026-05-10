import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

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
    errorMessage: Type.Optional(Type.String()),
    triggeredBy: StringEnum(Object.values(SyncRunTrigger)),
    /**
     * Optionale Korrelation zu einem Bootstrap-Report. Wird vom Bootstrap-
     * Worker gesetzt, damit der Report alle zugehoerigen sync-runs
     * verlinken kann. Bei Sync-Scheduler-Runs (Heartbeat etc.) `undefined`.
     */
    bootstrapReportId: Type.Optional(Type.String({ format: 'uuid' })),
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
