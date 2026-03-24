import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared/common'

//#region Enums & Constants
export const ProductGroupStatus = {
  ACTIVE: 'ACTIVE',
  DRAFT: 'DRAFT',
  ARCHIVED: 'ARCHIVED',
} as const
//#endregion

//#region The main data model (schema)
export const productGroupSchema = Type.Object(
  {
    ...baseSchema,

    externalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),

    status: Type.Optional(StringEnum(Object.values(ProductGroupStatus))),
    name: Type.String(),
    acronym: Type.Optional(Type.String()),
    color: Type.String(),
    excluded: Type.Boolean(),
    index: Type.Number(),
    taxInside: Type.Number({ default: 19 }),
    taxOutside: Type.Number({ default: 7 }),
  },
  { $id: 'ProductGroup', additionalProperties: false },
)
export type ProductGroup = Static<typeof productGroupSchema>
//#endregion

//#region Schema for creation (POST)
// Pflichtfelder beim Create: name, color, index, tenantId, locationId
// Alles andere hat Defaults oder wird serverseitig gesetzt
export const productGroupDataSchema = Type.Intersect(
  [
    Type.Pick(productGroupSchema, ['name', 'color', 'index', 'tenantId', 'locationId']),
    Type.Partial(
      Type.Pick(productGroupSchema, [
        'externalId',
        'acronym',
        'excluded',
        'status',
        'taxInside',
        'taxOutside',
      ]),
    ),
  ],
  {
    $id: 'ProductGroupData',
    additionalProperties: false,
  },
)
export type ProductGroupData = Static<typeof productGroupDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const productGroupPatchSchema = Type.Partial(productGroupSchema, {
  $id: 'ProductGroupPatch',
})
export type ProductGroupPatch = Static<typeof productGroupPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const productGroupQueryProperties = Type.Pick(productGroupSchema, [
  '_id',
  'acronym',
  'excluded',
  'index',
  'name',
  'status',
  'tenantId',
  'locationId',
])
export const productGroupQuerySchema = Type.Intersect(
  [
    querySyntax(productGroupQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type ProductGroupQuery = Static<typeof productGroupQuerySchema>
//#endregion
