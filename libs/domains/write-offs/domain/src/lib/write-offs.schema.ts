import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

//#region Enums & Constants
export const WriteOffReason = {
  WASTE: 'waste',
  PROMO: 'promo',
  EMPLOYEE_MEAL: 'employee_meal',
  TRANSFER: 'transfer',
  THEFT: 'theft',
  QUALITY_CHECK: 'quality_check',
  MISTAKE: 'mistake',
  SAMPLE: 'sample',
} as const
export type WriteOffReason = (typeof WriteOffReason)[keyof typeof WriteOffReason]

export const WasteType = {
  RAW: 'raw',
  FINISHED: 'finished',
} as const
export type WasteType = (typeof WasteType)[keyof typeof WasteType]

export const WriteOffItemType = {
  INGREDIENT: 'ingredient',
  PRODUCT: 'product',
  RECIPE: 'recipe',
} as const
export type WriteOffItemType = (typeof WriteOffItemType)[keyof typeof WriteOffItemType]
//#endregion

//#region The main data model (schema)
export const writeOffSchema = Type.Object(
  {
    ...baseSchema,
    _id: Type.String({ format: 'uuid' }),

    businessDayId: Type.String({ format: 'uuid' }),

    // Polymorphic Item Reference
    itemType: StringEnum(Object.values(WriteOffItemType)),
    itemId: Type.String({ format: 'uuid' }),
    itemName: Type.String(),
    itemVersion: Type.Number(),

    // Quantities & Value
    quantity: Type.Number(),
    unit: Type.String(),
    costPerUnit: Type.Number(),
    totalCost: Type.Number(),

    // Classification
    reason: StringEnum(Object.values(WriteOffReason)),
    wasteType: Type.Optional(StringEnum(Object.values(WasteType))),

    // Meta
    userId: Type.String({ format: 'uuid' }),
    comment: Type.Optional(Type.String()),
  },
  { $id: 'WriteOff', additionalProperties: false },
)
export type WriteOff = Static<typeof writeOffSchema>
//#endregion

//#region Schema for creation (POST)
export const writeOffDataSchema = Type.Intersect(
  [
    Type.Object({ _id: Type.Optional(Type.String()) }),
    Type.Pick(writeOffSchema, [
      'locationId',
      'tenantId',
      'createdAt',
      'updatedAt',
      'businessDayId',
      'itemType',
      'itemId',
      'itemName',
      'itemVersion',
      'quantity',
      'unit',
      'costPerUnit',
      'totalCost',
      'reason',
      'wasteType',
      'userId',
      'comment',
    ]),
  ],
  { $id: 'WriteOffData', additionalProperties: false },
)
export type WriteOffData = Static<typeof writeOffDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const writeOffPatchSchema = Type.Partial(writeOffSchema, {
  $id: 'WriteOffPatch',
})
export type WriteOffPatch = Static<typeof writeOffPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const writeOffQueryProperties = Type.Pick(writeOffSchema, [
  '_id',
  'tenantId',
  'locationId',
  'businessDayId',
  'itemType',
  'itemId',
  'reason',
  'wasteType',
  'userId',
  'createdAt',
  'updatedAt',
])
export const writeOffQuerySchema = Type.Intersect(
  [
    querySyntax(writeOffQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: true },
)
export type WriteOffQuery = Static<typeof writeOffQuerySchema>
//#endregion
