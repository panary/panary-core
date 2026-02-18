import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseCustomerSchema } from '@panary-core/shared/common'

//#region Enums & Constants (Reusable)
export const DiscountType = {
  PERCENT: 'percent',
  AMOUNT: 'amount',
} as const
//#endregion

//#region The main data model (schema)
export const corporateCustomerSchema = Type.Object(
  {
    ...baseCustomerSchema,

    name1: Type.String(),
    name2: Type.Optional(Type.String()),
    eInvoiceRequired: Type.Optional(Type.Boolean()),
    vatId: Type.Optional(Type.String()),
    taxNumber: Type.Optional(Type.String()),
    invoices: Type.Array(Type.Any(), { default: [] }),
    discountDetails: Type.Optional(
      Type.Object({
        discountType: StringEnum(Object.values(DiscountType)),
        discount: Type.Number(),
      }),
    ),
    favicon: Type.Optional(Type.String()),
    image: Type.Optional(Type.String()),
    ordersCount: Type.Optional(Type.Number()),
  },
  { $id: 'CorporateCustomer', additionalProperties: false },
)
export type CorporateCustomer = Static<typeof corporateCustomerSchema>
//#endregion

//#region Schema for creation (POST)
export const corporateCustomerDataSchema = Type.Omit(corporateCustomerSchema, ['_id', 'createdAt', 'updatedAt'], {
  $id: 'CorporateCustomerData',
  additionalProperties: false,
})
export type CorporateCustomerData = Static<typeof corporateCustomerDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const corporateCustomerPatchSchema = Type.Partial(corporateCustomerSchema, {
  $id: 'CorporateCustomerPatch',
})
export type CorporateCustomerPatch = Static<typeof corporateCustomerPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const corporateCustomerQueryProperties = Type.Pick(corporateCustomerSchema, [
  '_id',
  'name1',
  'name2',
  'status',
  'taxNumber',
  'vatId',
  'locationId',
  'tenantId',
])
export const corporateCustomerQuerySchema = Type.Intersect(
  [
    querySyntax(corporateCustomerQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type CorporateCustomerQuery = Static<typeof corporateCustomerQuerySchema>
//#endregion
