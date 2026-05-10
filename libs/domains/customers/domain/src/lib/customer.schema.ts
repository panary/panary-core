import { querySyntax, Static, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

//#region Enums & Constants (Reusable)
// TODO: Add enums/constants if needed
//#endregion

//#region The main data model (schema)
export const customerSchema = Type.Object(
  {
    ...baseSchema,

    address1: Type.String(),
    address2: Type.String(),
    city: Type.String(),
    country: Type.Optional(Type.String()),
    countryCode: Type.Optional(Type.String()),
    countryName: Type.Optional(Type.String()),
    discountDetails: Type.Optional(
      Type.Object({
        discountType: Type.String(),
        discount: Type.Number(),
      }),
    ),
    email: Type.Union([Type.String({ format: 'email' }), Type.Null()]),
    invoices: Type.Array(Type.Any()),
    image: Type.Optional(Type.String()),
    favicon: Type.Optional(Type.String()),
    name1: Type.String(),
    name2: Type.String(),
    ordersCount: Type.Optional(Type.Number({ default: 0 })),
    phone: Type.String(),
    province: Type.Optional(Type.String()),
    zipCode: Type.String(),
  },
  { $id: 'Customer', additionalProperties: false },
)
export type Customer = Static<typeof customerSchema>
//#endregion

//#region Schema for creation (POST)
// `_id`, `createdAt`, `updatedAt` werden serverseitig gesetzt — fuer Sync-
// Bootstrap (Edge→Cloud) muessen sie aber als Optional erlaubt bleiben, weil
// Edge-Records die Felder mitbringen. Daher Type.Intersect statt Type.Omit.
export const customerDataSchema = Type.Intersect(
  [
    Type.Omit(customerSchema, ['_id', 'createdAt', 'updatedAt']),
    Type.Partial(Type.Pick(customerSchema, ['_id', 'createdAt', 'updatedAt'])),
  ],
  { $id: 'CustomerData', additionalProperties: false },
)
export type CustomerData = Static<typeof customerDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const customerPatchSchema = Type.Partial(customerSchema, {
  $id: 'CustomerPatch',
})
export type CustomerPatch = Static<typeof customerPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const customerQueryProperties = Type.Pick(customerSchema, [
  '_id',
  'city',
  'countryName',
  'discountDetails',
  'email',
  'invoices',
  'image',
  'favicon',
  'name1',
  'name2',
  'phone',
  'address1',
  'address2',
  'zipCode',
  'locationId',
  'tenantId',
  // Pflicht fuer Sync-Pull (Cloud→Edge): Filtern nach `updatedAt > since` und
  // Sortieren nach `updatedAt` — auch fuer Admin-UI sinnvoll als Sortier-Feld.
  'updatedAt',
])
export const customerQuerySchema = Type.Intersect(
  [
    querySyntax(customerQueryProperties, {
      name1: {
        $regex: Type.String(),
      },
    }),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type CustomerQuery = Static<typeof customerQuerySchema>
//#endregion
