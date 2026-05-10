import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

export const PairingCodeStatus = {
  PENDING: 'pending',
  USED: 'used',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const

export type PairingCodeStatus = (typeof PairingCodeStatus)[keyof typeof PairingCodeStatus]

export const PAIRING_CODE_LENGTH = 6
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000

export const pairingCodeSchema = Type.Object(
  {
    ...baseSchema,
    code: Type.String({ minLength: PAIRING_CODE_LENGTH, maxLength: PAIRING_CODE_LENGTH }),
    suggestedLocationId: Type.Optional(Type.String({ format: 'uuid' })),
    suggestedEdgeName: Type.Optional(Type.String({ maxLength: 100 })),
    expiresAt: Type.String({ format: 'date-time' }),
    generatedByUserId: Type.String({ format: 'uuid' }),
    status: StringEnum(Object.values(PairingCodeStatus)),
    consumedByCloudEdgeId: Type.Optional(Type.String({ format: 'uuid' })),
    consumedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'PairingCode', additionalProperties: false },
)

export type PairingCode = Static<typeof pairingCodeSchema>

export const pairingCodeDataSchema = Type.Object(
  {
    // tenantId/locationId werden vom multiTenancy-Hook serverseitig gestempelt
    // (überschreiben Client-Werte). Im Schema erlaubt, damit der Validator
    // die gestempelten Felder nicht als "additional properties" ablehnt.
    tenantId: Type.Optional(Type.String()),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    suggestedLocationId: Type.Optional(Type.String()),
    suggestedEdgeName: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { $id: 'PairingCodeData', additionalProperties: false },
)

export type PairingCodeData = Static<typeof pairingCodeDataSchema>

// status = einzige Client-änderbare Property. tenantId/locationId stehen
// im Schema, damit der multiTenancy-Hook sie beim Patch stempeln darf, ohne
// als "additional properties" abgelehnt zu werden — werden serverseitig
// im patchResolver wieder auf undefined gesetzt (immutable nach Create).
//
// consumedByCloudEdgeId/consumedAt: nur fuer den serverseitigen Pairing-Flow
// (consumePairingCode) — externe Clients duerfen sie nicht setzen, das
// erzwingt der patchResolver durch Filterung auf provider=undefined.
export const pairingCodePatchSchema = Type.Partial(
  Type.Pick(pairingCodeSchema, [
    'status',
    'tenantId',
    'locationId',
    'consumedByCloudEdgeId',
    'consumedAt',
  ]),
  { $id: 'PairingCodePatch' },
)

export type PairingCodePatch = Static<typeof pairingCodePatchSchema>

export const pairingCodeQueryProperties = Type.Pick(pairingCodeSchema, [
  '_id',
  'tenantId',
  'status',
  'code',
  'createdAt',
  'expiresAt',
])

export const pairingCodeQuerySchema = Type.Intersect(
  [querySyntax(pairingCodeQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)

export type PairingCodeQuery = Static<typeof pairingCodeQuerySchema>
