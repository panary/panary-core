import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

export const SYNC_CURSOR_SINGLETON_ID = 'cloud'

export const syncCursorSchema = Type.Object(
  {
    _id: Type.String({ minLength: 1 }),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    lastPullAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastPushAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastHeartbeatAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastClockSkewMs: Type.Optional(Type.Number()),
    lastError: Type.Optional(Type.String({ maxLength: 1000 })),
    lastBootstrapResumeToken: Type.Optional(Type.String()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncCursor', additionalProperties: false },
)

export type SyncCursor = Static<typeof syncCursorSchema>

export const syncCursorPatchSchema = Type.Partial(
  Type.Pick(syncCursorSchema, [
    'lastPullAt',
    'lastPushAt',
    'lastHeartbeatAt',
    'lastClockSkewMs',
    'lastError',
    'lastBootstrapResumeToken',
  ]),
  { $id: 'SyncCursorPatch' },
)

export type SyncCursorPatch = Static<typeof syncCursorPatchSchema>

export const syncCursorQueryProperties = Type.Pick(syncCursorSchema, ['_id', 'service'])

export const syncCursorQuerySchema = Type.Intersect(
  [querySyntax(syncCursorQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)

export type SyncCursorQuery = Static<typeof syncCursorQuerySchema>
