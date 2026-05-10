import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

/**
 * Bootstrap-Report = Diagnose-Datensatz pro Pairing-Vorgang.
 *
 * Persistent in der SQLite-Tabelle `bootstrap-reports` UND als JSON-Datei
 * unter `<dataDir>/bootstrap-reports/<pairingDate>-<reportId>.json`.
 *
 * Zweck: Nachvollziehbarkeit, ob das Restamp lief, welche Tabellen betroffen
 * waren, und ob der DB-Stand am Ende konsistent ist. Ohne diesen Report kann
 * ein Pairing-Bug nur durch SQL-Forensik diagnostiziert werden.
 */

export const BootstrapReportStatus = {
  IN_PROGRESS: 'in-progress',
  DONE: 'done',
  FAILED: 'failed',
} as const
export type BootstrapReportStatus = (typeof BootstrapReportStatus)[keyof typeof BootstrapReportStatus]

export const BootstrapReportDirection = {
  BOOTSTRAP_EDGE_TO_CLOUD: 'bootstrap-edge-to-cloud',
  PULL_CLOUD_TO_EDGE: 'pull-cloud-to-edge',
  MERGE_BY_EXTERNAL_ID: 'merge-by-external-id',
} as const
export type BootstrapReportDirection =
  (typeof BootstrapReportDirection)[keyof typeof BootstrapReportDirection]

const identitySchema = Type.Object(
  {
    edgeTenantIdBefore: Type.Union([Type.String(), Type.Null()]),
    cloudTenantId: Type.String(),
    edgeLocationIdBefore: Type.Union([Type.String(), Type.Null()]),
    cloudLocationId: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
)

const stateSnapshotSchema = Type.Object(
  {
    locations: Type.Array(
      Type.Object(
        {
          _id: Type.String(),
          tenantId: Type.String(),
        },
        { additionalProperties: true }, // weitere Felder optional ignoriert
      ),
    ),
    counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
)

const restampSchema = Type.Object(
  {
    skipped: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    locationsTableUpdated: Type.Boolean(),
    affectedTables: Type.Array(Type.String()),
    updatedRowsTotal: Type.Integer({ minimum: 0 }),
    perTable: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
    backupPath: Type.Optional(Type.String()),
    durationMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

const consistencyCheckSchema = Type.Object(
  {
    isHealthy: Type.Boolean(),
    ghostLocations: Type.Array(Type.String()),
    tenantIdMismatchCount: Type.Integer({ minimum: 0 }),
    locationIdMismatchCount: Type.Integer({ minimum: 0 }),
    issues: Type.Array(
      Type.Object(
        {
          severity: StringEnum(['WARN', 'ERROR']),
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

export const bootstrapReportSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    cloudConnectionId: Type.String({ format: 'uuid' }),
    tenantId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    startedAt: Type.String({ format: 'date-time' }),
    completedAt: Type.Optional(Type.String({ format: 'date-time' })),
    status: StringEnum(Object.values(BootstrapReportStatus)),
    direction: StringEnum(Object.values(BootstrapReportDirection)),
    errorMessage: Type.Optional(Type.String()),

    identity: identitySchema,
    preState: stateSnapshotSchema,
    postState: Type.Optional(stateSnapshotSchema),

    restamp: Type.Optional(restampSchema),
    syncRunIds: Type.Array(Type.String()),
    consistencyCheck: Type.Optional(consistencyCheckSchema),

    // JSON-Datei-Pfad (relativ zu dataDir), gesetzt nach `dumpToFile`.
    jsonExportPath: Type.Optional(Type.String()),

    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'BootstrapReport', additionalProperties: false },
)
export type BootstrapReport = Static<typeof bootstrapReportSchema>

export const bootstrapReportDataSchema = Type.Omit(
  bootstrapReportSchema,
  ['createdAt', 'updatedAt'],
  { $id: 'BootstrapReportData' },
)
export type BootstrapReportData = Static<typeof bootstrapReportDataSchema>

export const bootstrapReportPatchSchema = Type.Partial(bootstrapReportSchema, {
  $id: 'BootstrapReportPatch',
})
export type BootstrapReportPatch = Static<typeof bootstrapReportPatchSchema>

export const bootstrapReportQueryProperties = Type.Pick(bootstrapReportSchema, [
  '_id',
  'cloudConnectionId',
  'tenantId',
  'status',
  'direction',
  'startedAt',
  'createdAt',
])
export const bootstrapReportQuerySchema = Type.Intersect(
  [
    querySyntax(bootstrapReportQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type BootstrapReportQuery = Static<typeof bootstrapReportQuerySchema>
