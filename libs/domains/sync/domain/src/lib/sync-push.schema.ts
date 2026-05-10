import type { Static } from '@feathersjs/typebox'
import { Type } from '@feathersjs/typebox'

import { syncOpSchema, syncRejectionSchema } from './sync-op.schema'

export const SYNC_PUSH_MAX_BATCH = 100

export const syncPushRequestSchema = Type.Object(
  {
    ops: Type.Array(syncOpSchema, { maxItems: SYNC_PUSH_MAX_BATCH }),
  },
  { $id: 'SyncPushRequest', additionalProperties: false },
)

export type SyncPushRequest = Static<typeof syncPushRequestSchema>

export const syncPushResponseSchema = Type.Object(
  {
    accepted: Type.Array(Type.String({ format: 'uuid' })),
    rejected: Type.Array(syncRejectionSchema),
    serverTimestamp: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncPushResponse', additionalProperties: false },
)

export type SyncPushResponse = Static<typeof syncPushResponseSchema>
