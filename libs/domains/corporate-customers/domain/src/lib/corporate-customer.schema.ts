import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseCustomerSchema } from '@panary/shared-common'

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

    name1: Type.String({ maxLength: 200 }),
    name2: Type.Optional(Type.String({ maxLength: 200 })),
    eInvoiceRequired: Type.Optional(Type.Boolean()),
    vatId: Type.Optional(Type.String({ maxLength: 20 })),
    taxNumber: Type.Optional(Type.String({ maxLength: 30 })),
    invoices: Type.Array(Type.Any(), { default: [], maxItems: 1000 }),
    discountDetails: Type.Optional(
      Type.Object({
        discountType: StringEnum(Object.values(DiscountType)),
        discount: Type.Number({ minimum: 0 }),
      }),
    ),
    favicon: Type.Optional(Type.String({ maxLength: 2048 })),
    image: Type.Optional(Type.String({ maxLength: 2048 })),
    ordersCount: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'CorporateCustomer', additionalProperties: false },
)
export type CorporateCustomer = Static<typeof corporateCustomerSchema>
//#endregion

//#region Schema for creation (POST)
// `_id`, `createdAt`, `updatedAt` werden serverseitig gesetzt — fuer Sync-
// Bootstrap (Edge→Cloud) muessen sie aber als Optional erlaubt bleiben, weil
// Edge-Records die Felder mitbringen. Daher Type.Intersect statt Type.Omit.
export const corporateCustomerDataSchema = Type.Intersect(
  [
    Type.Omit(corporateCustomerSchema, ['_id', 'createdAt', 'updatedAt']),
    Type.Partial(Type.Pick(corporateCustomerSchema, ['_id', 'createdAt', 'updatedAt'])),
  ],
  { $id: 'CorporateCustomerData', additionalProperties: false },
)
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
  // Pflicht fuer Sync-Pull (Cloud→Edge): Filtern nach `updatedAt > since` und
  // Sortieren nach `updatedAt` — auch fuer Admin-UI sinnvoll als Sortier-Feld.
  'updatedAt',
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
