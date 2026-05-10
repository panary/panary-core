import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

import { SyncOp, SyncSource } from './sync-op.schema'

export const SyncOutboxStatus = {
  PENDING: 'pending',
  IN_FLIGHT: 'in-flight',
  ACKED: 'acked',
  REJECTED: 'rejected',
} as const

export type SyncOutboxStatus = (typeof SyncOutboxStatus)[keyof typeof SyncOutboxStatus]

export const syncOutboxEntrySchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    op: StringEnum(Object.values(SyncOp)),
    entityId: Type.String({ format: 'uuid' }),
    payload: Type.Optional(Type.Unknown()),
    occurredAt: Type.String({ format: 'date-time' }),
    syncSource: StringEnum(Object.values(SyncSource)),
    status: StringEnum(Object.values(SyncOutboxStatus)),
    attempts: Type.Integer({ minimum: 0 }),
    lastAttemptAt: Type.Optional(Type.String({ format: 'date-time' })),
    syncedAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastError: Type.Optional(Type.String({ maxLength: 1000 })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncOutboxEntry', additionalProperties: false },
)

export type SyncOutboxEntry = Static<typeof syncOutboxEntrySchema>

export const syncOutboxEntryDataSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    op: StringEnum(Object.values(SyncOp)),
    entityId: Type.String({ format: 'uuid' }),
    payload: Type.Optional(Type.Unknown()),
    occurredAt: Type.String({ format: 'date-time' }),
    syncSource: StringEnum(Object.values(SyncSource)),
  },
  { $id: 'SyncOutboxEntryData', additionalProperties: false },
)

export type SyncOutboxEntryData = Static<typeof syncOutboxEntryDataSchema>

export const syncOutboxEntryPatchSchema = Type.Partial(
  Type.Pick(syncOutboxEntrySchema, [
    'status',
    'attempts',
    'lastAttemptAt',
    'syncedAt',
    'lastError',
  ]),
  { $id: 'SyncOutboxEntryPatch' },
)

export type SyncOutboxEntryPatch = Static<typeof syncOutboxEntryPatchSchema>

export const syncOutboxEntryQueryProperties = Type.Pick(syncOutboxEntrySchema, [
  '_id',
  'service',
  'status',
  'syncSource',
  'entityId',
])

export const syncOutboxEntryQuerySchema = Type.Intersect(
  [
    querySyntax(syncOutboxEntryQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)

export type SyncOutboxEntryQuery = Static<typeof syncOutboxEntryQuerySchema>
