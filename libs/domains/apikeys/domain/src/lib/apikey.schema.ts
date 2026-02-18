import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared/common'
import { UserSystemRole } from '@panary-core/users/domain'

//#region Enums & Konstanten (Wiederverwendbar)
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const apikeySchema = Type.Object(
  {
    ...baseSchema,

    apikey: Type.String(),
    name: Type.String(),
    deviceId: Type.Optional(Type.String({ format: 'uuid' })), // Associated device ID (optional)
    validUntil: Type.Optional(Type.String({ format: 'date-time' })),
    createdBy: Type.String(),

    /**
     * Role assigned to this API key.
     * Determines permissions for the device.
     */
    role: StringEnum(Object.values(UserSystemRole)),
    description: Type.Optional(Type.String()), // Optional description of the API key's purpose
    active: Type.Boolean({ default: true }), // Whether this API key is active. Inactive keys cannot authenticate.
    lastUsedAt: Type.Optional(Type.String({ format: 'date-time' })), // Last time this API key was used
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
      role: Type.Optional(StringEnum(Object.values(UserSystemRole))),
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
export const apikeyQueryProperties = Type.Pick(apikeySchema, ['_id', 'apikey', 'deviceId', 'locationId', 'tenantId'])
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
