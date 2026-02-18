import { querySyntax, Static, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared/common'

//#region The main data model (schema)
export const userPreferenceSchema = Type.Object(
  {
    ...baseSchema,

    userId: Type.String({ format: 'uuid' }), // Was ObjectId
    key: Type.String(),
    value: Type.Any(),
  },
  { $id: 'UserPreference', additionalProperties: false },
)
export type UserPreference = Static<typeof userPreferenceSchema>
//#endregion

//#region Schema for creation (POST)
export const userPreferenceDataSchema = Type.Pick(
  userPreferenceSchema,
  ['tenantId', 'locationId', 'key', 'value', 'userId'],
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
