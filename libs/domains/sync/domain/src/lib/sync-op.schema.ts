import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

export const SyncOp = {
  CREATE: 'create',
  PATCH: 'patch',
  REMOVE: 'remove',
} as const

export type SyncOp = (typeof SyncOp)[keyof typeof SyncOp]

export const SyncSource = {
  LIVE: 'live',
  BACKFILL: 'backfill',
} as const

export type SyncSource = (typeof SyncSource)[keyof typeof SyncSource]

export const syncOpSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    op: StringEnum(Object.values(SyncOp)),
    entityId: Type.String({ format: 'uuid' }),
    payload: Type.Optional(Type.Unknown()),
    occurredAt: Type.String({ format: 'date-time' }),
    syncSource: StringEnum(Object.values(SyncSource)),
  },
  { $id: 'SyncOp', additionalProperties: false },
)

export type SyncOpEntry = Static<typeof syncOpSchema>

export const syncRejectionSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    reason: Type.String(),
    code: Type.Optional(Type.String()),
  },
  { $id: 'SyncRejection', additionalProperties: false },
)

export type SyncRejection = Static<typeof syncRejectionSchema>
