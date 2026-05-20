import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

export const CloudEdgeStatus = {
  PENDING_PAIRING: 'pending-pairing',
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

export type CloudEdgeStatus = (typeof CloudEdgeStatus)[keyof typeof CloudEdgeStatus]

export const ClockSkewStatus = {
  OK: 'ok',
  WARN: 'warn',
  ERROR: 'error',
} as const

export type ClockSkewStatus = (typeof ClockSkewStatus)[keyof typeof ClockSkewStatus]

export const cloudEdgeSchema = Type.Object(
  {
    ...baseSchema,
    // Cloud-Edges koennen ohne konkrete Location existieren (globaler Edge fuer
    // den Tenant). Lokale Override des Pflicht-uuid-locationId aus baseSchema —
    // sonst scheitert findExistingActiveEdge mit query.locationId=null an der
    // querySyntax-anyOf-Validierung (uuid ODER Operator-Object, kein null).
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    edgeName: Type.String({ minLength: 1, maxLength: 100 }),
    edgeVersion: Type.Optional(Type.String({ maxLength: 50 })),
    platform: Type.Optional(Type.String({ maxLength: 50 })),
    status: StringEnum(Object.values(CloudEdgeStatus)),
    currentTokenHash: Type.Optional(Type.String()),
    pendingTokenHash: Type.Optional(Type.String()),
    tokenExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
    pairedAt: Type.Optional(Type.String({ format: 'date-time' })),
    pairedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    revokedAt: Type.Optional(Type.String({ format: 'date-time' })),
    revokedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    revocationReason: Type.Optional(Type.String({ maxLength: 500 })),
    lastSeenAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastClockSkewMs: Type.Optional(Type.Number()),
    lastClockSkewStatus: Type.Optional(StringEnum(Object.values(ClockSkewStatus))),
  },
  { $id: 'CloudEdge', additionalProperties: false },
)

export type CloudEdge = Static<typeof cloudEdgeSchema>

// tenantId/locationId stehen im Schema, damit multiTenancy() die Felder beim
// PATCH stempeln darf, ohne dass der Validator sie als additional properties
// ablehnt — werden serverseitig im cloudEdgePatchResolver wieder auf undefined
// gesetzt (immutable nach Pairing).
export const cloudEdgePatchSchema = Type.Partial(
  Type.Pick(cloudEdgeSchema, ['edgeName', 'status', 'revocationReason', 'tenantId', 'locationId']),
  { $id: 'CloudEdgePatch' },
)

export type CloudEdgePatch = Static<typeof cloudEdgePatchSchema>

export const cloudEdgeQueryProperties = Type.Pick(cloudEdgeSchema, [
  '_id',
  'tenantId',
  'locationId',
  'status',
  'edgeName',
  // Sortier- und Filter-Felder fuer das Admin-UI:
  'pairedAt',
  'lastSeenAt',
  'lastSyncAt',
  // Pflicht fuer die EdgeTokenStrategy: findByTokenHash() filtert in der
  // Authentifizierung nach Token-Hash. Externe Clients erreichen die Felder
  // weiterhin nicht, weil cloud-edges nur fuer Platform-User zugreifbar ist
  // (RBAC-Matrix) und die Hashes per resolveExternal ohnehin unterdrueckt werden.
  'currentTokenHash',
  'pendingTokenHash',
])

export const cloudEdgeQuerySchema = Type.Intersect(
  [querySyntax(cloudEdgeQueryProperties), Type.Object({})],
  { additionalProperties: false },
)

export type CloudEdgeQuery = Static<typeof cloudEdgeQuerySchema>
