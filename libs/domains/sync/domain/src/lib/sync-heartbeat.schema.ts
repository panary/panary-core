import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

import { ClockSkewStatus } from '@panary-core/cloud-edges/domain'

export const CLOCK_SKEW_WARN_MS = 30_000
export const CLOCK_SKEW_ERROR_MS = 5 * 60_000

export const syncHeartbeatRequestSchema = Type.Object(
  {
    edgeTimestamp: Type.String({ format: 'date-time' }),
    edgeClockMonotonicMs: Type.Number({ minimum: 0 }),
    edgeVersion: Type.Optional(Type.String({ maxLength: 50 })),
    outboxBacklog: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { $id: 'SyncHeartbeatRequest', additionalProperties: false },
)

export type SyncHeartbeatRequest = Static<typeof syncHeartbeatRequestSchema>

export const syncHeartbeatResponseSchema = Type.Object(
  {
    serverTimestamp: Type.String({ format: 'date-time' }),
    clockSkewStatus: StringEnum(Object.values(ClockSkewStatus)),
    clockSkewMs: Type.Number(),
    nextToken: Type.Optional(Type.String()),
    nextTokenExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
    pullSince: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'SyncHeartbeatResponse', additionalProperties: false },
)

export type SyncHeartbeatResponse = Static<typeof syncHeartbeatResponseSchema>
