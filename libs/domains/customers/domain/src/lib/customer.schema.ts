import { querySyntax, Static, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region Enums & Constants (Reusable)
// TODO: Add enums/constants if needed
//#endregion

//#region The main data model (schema)
export const customerSchema = Type.Object(
  {
    ...baseSchema,

    address1: Type.String({ maxLength: 200 }),
    address2: Type.String({ maxLength: 200 }),
    city: Type.String({ maxLength: 200 }),
    country: Type.Optional(Type.String({ maxLength: 100 })),
    countryCode: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$' })),
    countryName: Type.Optional(Type.String({ maxLength: 100 })),
    discountDetails: Type.Optional(
      Type.Object({
        discountType: Type.String(),
        discount: Type.Number({ minimum: 0 }),
      }),
    ),
    email: Type.Union([Type.String({ format: 'email', maxLength: 254 }), Type.Null()]),
    invoices: Type.Array(Type.Any(), { maxItems: 1000 }),
    image: Type.Optional(Type.String({ maxLength: 2048 })),
    favicon: Type.Optional(Type.String({ maxLength: 2048 })),
    name1: Type.String({ maxLength: 200 }),
    name2: Type.String({ maxLength: 200 }),
    ordersCount: Type.Optional(Type.Number({ default: 0, minimum: 0 })),
    phone: Type.String({ maxLength: 40 }),
    province: Type.Optional(Type.String({ maxLength: 100 })),
    zipCode: Type.String({ maxLength: 20 }),
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
    // $regex-Opt-in fuer die globale Such-Leiste (Name/E-Mail/Telefon) —
    // gilt auch innerhalb von `$or`.
    querySyntax(customerQueryProperties, {
      name1: { $regex: Type.String() },
      name2: { $regex: Type.String() },
      email: { $regex: Type.String() },
      phone: { $regex: Type.String() },
    }),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type CustomerQuery = Static<typeof customerQuerySchema>
//#endregion
