import { querySyntax, Static, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region The main data model (schema)
export const userPreferenceSchema = Type.Object(
  {
    ...baseSchema,

    userId: Type.String({ format: 'uuid' }), // Was ObjectId
    key: Type.String({ maxLength: 120 }),
    value: Type.Any(),
  },
  { $id: 'UserPreference', additionalProperties: false },
)
export type UserPreference = Static<typeof userPreferenceSchema>
//#endregion

//#region Schema for creation (POST)
// `tenantId`/`locationId` optional: serverseitig von `multiTenancy()` gestempelt,
// kein Client sendet sie. Als Pflichtfelder waere die 400-Meldung bei
// fehlgeschlagenem Stempel irrefuehrend (ADR 0031 in panary-cloud).
export const userPreferenceDataSchema = Type.Intersect(
  [
    Type.Pick(userPreferenceSchema, ['key', 'value', 'userId']),
    Type.Partial(Type.Pick(userPreferenceSchema, ['tenantId', 'locationId'])),
  ],
  {
    $id: 'UserPreferenceData',
    additionalProperties: false,
  },
)
export type UserPreferenceData = Static<typeof userPreferenceDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const userPreferencePatchSchema = Type.Partial(userPreferenceSchema, {
  $id: 'UserPreferencePatch',
})
export type UserPreferencePatch = Static<typeof userPreferencePatchSchema>
//#endregion

//#region Schema for search queries (query)
export const userPreferenceQueryProperties = Type.Pick(userPreferenceSchema, [
  '_id',
  'tenantId',
  'locationId',
  'userId',
  'key',
])
export const userPreferenceQuerySchema = Type.Intersect(
  [
    querySyntax(userPreferenceQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type UserPreferenceQuery = Static<typeof userPreferenceQuerySchema>
//#endregion
