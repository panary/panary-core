import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

export const SyncConflictStatus = {
  OPEN: 'open',
  RESOLVED: 'resolved',
} as const

export type SyncConflictStatus = (typeof SyncConflictStatus)[keyof typeof SyncConflictStatus]

export const SyncConflictResolution = {
  USE_CLOUD: 'use-cloud',
  USE_EDGE: 'use-edge',
  DISCARD: 'discard',
} as const

export type SyncConflictResolution =
  (typeof SyncConflictResolution)[keyof typeof SyncConflictResolution]

export const SyncConflictReason = {
  EXTERNAL_ID_MISMATCH: 'external-id-mismatch',
  EXTERNAL_ID_MISSING: 'external-id-missing',
  AMBIGUOUS_NAME_MATCH: 'ambiguous-name-match',
  PUSH_REJECTED: 'push-rejected',
} as const

export type SyncConflictReason = (typeof SyncConflictReason)[keyof typeof SyncConflictReason]

export const syncConflictSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    // Tenant-Affiliation — von der DB-Migration vorgesehen (notNullable),
    // damit der multiTenancy()-Hook seine Filter setzen kann.
    tenantId: Type.String({ format: 'uuid' }),
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    edgeRecordId: Type.String({ format: 'uuid' }),
    cloudRecordId: Type.Optional(Type.String({ format: 'uuid' })),
    reason: StringEnum(Object.values(SyncConflictReason)),
    edgePayload: Type.Optional(Type.Unknown()),
    cloudPayload: Type.Optional(Type.Unknown()),
    status: StringEnum(Object.values(SyncConflictStatus)),
    resolution: Type.Optional(StringEnum(Object.values(SyncConflictResolution))),
    resolvedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    resolvedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncConflict', additionalProperties: false },
)

export type SyncConflict = Static<typeof syncConflictSchema>

export const syncConflictPatchSchema = Type.Object(
  {
    resolution: StringEnum(Object.values(SyncConflictResolution)),
  },
  { $id: 'SyncConflictPatch', additionalProperties: false },
)

export type SyncConflictPatch = Static<typeof syncConflictPatchSchema>

export const syncConflictQueryProperties = Type.Pick(syncConflictSchema, [
  '_id',
  'tenantId',
  'locationId',
  'service',
  'status',
  'reason',
  'edgeRecordId',
])

export const syncConflictQuerySchema = Type.Intersect(
  [
    querySyntax(syncConflictQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)

export type SyncConflictQuery = Static<typeof syncConflictQuerySchema>
