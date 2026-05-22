import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

export const PairingState = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  REVOKED: 'revoked',
} as const

export type PairingState = (typeof PairingState)[keyof typeof PairingState]

export const syncStatusResponseSchema = Type.Object(
  {
    state: StringEnum(Object.values(PairingState)),
    cloudEdgeId: Type.String({ format: 'uuid' }),
    cloudTenantId: Type.String({ format: 'uuid' }),
    serverTimestamp: Type.String({ format: 'date-time' }),
    revokedReason: Type.Optional(Type.String({ maxLength: 500 })),
    requiredEdgeMinVersion: Type.Optional(Type.String({ maxLength: 50 })),
  },
  { $id: 'SyncStatusResponse', additionalProperties: false },
)

export type SyncStatusResponse = Static<typeof syncStatusResponseSchema>
