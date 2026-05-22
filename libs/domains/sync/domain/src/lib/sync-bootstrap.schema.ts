import type { Static } from '@feathersjs/typebox'
import { Type } from '@feathersjs/typebox'

import { syncOpSchema, syncRejectionSchema } from './sync-op.schema'

export const SYNC_BOOTSTRAP_MAX_BATCH = 1000

export const syncBootstrapRequestSchema = Type.Object(
  {
    service: Type.String({ minLength: 1, maxLength: 80 }),
    ops: Type.Array(syncOpSchema, { maxItems: SYNC_BOOTSTRAP_MAX_BATCH }),
    finalChunk: Type.Boolean(),
    resumeToken: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { $id: 'SyncBootstrapRequest', additionalProperties: false },
)

export type SyncBootstrapRequest = Static<typeof syncBootstrapRequestSchema>

export const syncBootstrapResponseSchema = Type.Object(
  {
    accepted: Type.Array(Type.String({ format: 'uuid' })),
    rejected: Type.Array(syncRejectionSchema),
    nextResumeToken: Type.Optional(Type.String({ maxLength: 512 })),
    completed: Type.Boolean(),
    serverTimestamp: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncBootstrapResponse', additionalProperties: false },
)

export type SyncBootstrapResponse = Static<typeof syncBootstrapResponseSchema>
