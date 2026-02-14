import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared/common'

//#region Enums & Konstanten (Wiederverwendbar)
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const apikeySchema = Type.Object(
  {
    ...baseSchema,

    apiKey: Type.String(),
    name: Type.String(),
    deviceId: Type.Optional(Type.String({ format: 'uuid' })), // Associated device ID (optional)
    validUntil: Type.Optional(Type.String({ format: 'date-time' })),
    createdBy: Type.String(),

    /**
     * Scopes (permissions) granted to this API key.
     * Uses resource:action format, e.g., 'orders:read', 'users:read:pos'
     * See src/shared/constants/api-key-scopes.ts for available scopes.
     */
    scopes: Type.Optional(Type.Array(Type.String())),

    /**
     * Optional description of the API key's purpose
     */
    description: Type.Optional(Type.String()),

    /**
     * Whether this API key is active. Inactive keys cannot authenticate.
     */
    active: Type.Boolean({ default: true }),

    /**
     * Last time this API key was used
     */
    lastUsedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'Apikey', additionalProperties: false },
)

// TypeScript Typ für das volle User Objekt
export type Apikey = Static<typeof apikeySchema>
//#endregion

//#region Schema für das Erstellen (POST)
// Wir picken nur die Felder, die der Client senden darf
export const apikeyDataSchema = Type.Intersect(
  [
    Type.Pick(apikeySchema, ['description', 'deviceId', 'locationId', 'name', 'tenantId', 'validUntil']),
    Type.Object({
      scopes: Type.Optional(Type.Array(Type.String())),
    }),
  ],
  {
    $id: 'ApikeyData',
    additionalProperties: false,
  },
)

export type ApikeyData = Static<typeof apikeyDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
export const apikeyPatchSchema = Type.Partial(apikeySchema, {
  $id: 'ApikeyPatch',
})

export type ApikeyPatch = Static<typeof apikeyPatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const apikeyQueryProperties = Type.Pick(apikeySchema, ['_id', 'apiKey', 'deviceId', 'locationId', 'tenantId'])
export const apikeyQuerySchema = Type.Intersect(
  [
    querySyntax(apikeyQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)

export type ApikeyQuery = Static<typeof apikeyQuerySchema>
//#endregion
