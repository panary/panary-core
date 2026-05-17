import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'
import { UserSystemRole } from '@panary-core/users/domain'

//#region Enums & Konstanten (Wiederverwendbar)
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const apikeySchema = Type.Object(
  {
    ...baseSchema,

    apikey: Type.String(), // SHA-256-Hash des Keys (Klartext nur bei Erstellung sichtbar)
    apikeyPrefix: Type.Optional(Type.String()), // Erste 8 Zeichen des Klartext-Keys fuer Lookup
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
// `name`/`active`/`validUntil`/`createdAt`/`updatedAt` für die Cloud-Admin-Liste:
// Sortierung nach Name, Filter nach Aktivitäts-Status, Sync-Pull über `updatedAt`.
export const apikeyQueryProperties = Type.Pick(apikeySchema, [
  '_id',
  'apikey',
  'apikeyPrefix',
  'deviceId',
  'locationId',
  'tenantId',
  'name',
  'active',
  'validUntil',
  'lastUsedAt',
  'createdAt',
  'updatedAt',
])
// `$or` wird über Property-Spread an die `querySyntax`-Ausgabe gehängt —
// `Type.Intersect([..., Type.Object({ $or })])` produzierte unter TS 6.x ein
// "type instantiation is excessively deep" (TS2589) im `getValidator`-Konsumer.
// Flat-Object ist semantisch identisch und liegt deutlich unter dem Limit.
const _apikeyQueryBase = querySyntax(apikeyQueryProperties)
export const apikeyQuerySchema = Type.Object(
  {
    ..._apikeyQueryBase.properties,
    // `Type.Any()` statt `Type.Record(...)`: AJV validiert `$or`-Items
    // ohnehin lose, die Detail-Struktur kommt aus den `querySyntax`-
    // Operatoren in den restlichen Properties.
    $or: Type.Optional(Type.Array(Type.Any())),
  },
  { additionalProperties: false },
)

export type ApikeyQuery = Static<typeof apikeyQuerySchema>
//#endregion
