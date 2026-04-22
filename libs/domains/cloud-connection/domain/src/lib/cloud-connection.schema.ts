import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

//#region Enums & Konstanten
export const PairingStatus = {
  DISCONNECTED: 'disconnected',
  PAIRING: 'pairing',
  CONNECTED: 'connected',
  ERROR: 'error',
} as const

export type PairingStatus = (typeof PairingStatus)[keyof typeof PairingStatus]

export const DEFAULT_CLOUD_URL = 'https://cloud.panary.io'
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const cloudConnectionSchema = Type.Object(
  {
    ...baseSchema,

    cloudUrl: Type.String({ format: 'uri' }),
    cloudToken: Type.Optional(Type.String()),
    cloudEdgeId: Type.Optional(Type.String()),
    pairingStatus: StringEnum(Object.values(PairingStatus)),
    connectedAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    syncEnabled: Type.Boolean({ default: false }),
    errorMessage: Type.Optional(Type.String()),
    edgeName: Type.Optional(Type.String()),
  },
  { $id: 'CloudConnection', additionalProperties: false },
)

export type CloudConnection = Static<typeof cloudConnectionSchema>
//#endregion

//#region Schema für Pairing-Anfrage (POST)
export const cloudConnectionDataSchema = Type.Object(
  {
    cloudUrl: Type.String({ format: 'uri' }),
    pairingCode: Type.String({ minLength: 6, maxLength: 6 }),
    edgeName: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { $id: 'CloudConnectionData', additionalProperties: false },
)

export type CloudConnectionData = Static<typeof cloudConnectionDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
export const cloudConnectionPatchSchema = Type.Partial(
  Type.Pick(cloudConnectionSchema, ['cloudUrl', 'syncEnabled', 'edgeName']),
  { $id: 'CloudConnectionPatch' },
)

export type CloudConnectionPatch = Static<typeof cloudConnectionPatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const cloudConnectionQueryProperties = Type.Pick(cloudConnectionSchema, ['_id', 'tenantId', 'pairingStatus'])
export const cloudConnectionQuerySchema = Type.Intersect(
  [querySyntax(cloudConnectionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)

export type CloudConnectionQuery = Static<typeof cloudConnectionQuerySchema>
//#endregion
