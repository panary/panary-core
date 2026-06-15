import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'
import { DineLocation, orderLineItemSchema } from '@panary/orders/domain'

//#region Enums & Constants
export const PreOrderStatus = {
  PENDING: 'pending',
  CONVERTED: 'converted',
  CANCELLED: 'cancelled',
} as const

export type PreOrderStatusType = (typeof PreOrderStatus)[keyof typeof PreOrderStatus]
//#endregion

//#region The main data model (schema)
export const preOrderSchema = Type.Object(
  {
    ...baseSchema,

    scheduledFor: Type.String({ format: 'date-time' }),
    status: StringEnum(Object.values(PreOrderStatus)),
    dineLocation: Type.Optional(StringEnum(Object.values(DineLocation))),

    customerContact: Type.Object({
      name: Type.String({ maxLength: 200 }),
      phone: Type.String({ maxLength: 40 }),
    }),

    // Re-using the exact line item structure from orders for compatibility.
    // Stored as JSON text in SQLite.
    lineItems: Type.Array(orderLineItemSchema, { maxItems: 500 }),

    note: Type.Optional(Type.String({ maxLength: 500 })),
    metadata: Type.Optional(Type.Any()),
    convertedOrderId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { $id: 'PreOrder', additionalProperties: false },
)

export type PreOrder = Static<typeof preOrderSchema>
//#endregion

//#region Schema for creation (POST)
// `_id` optional erlaubt — für offline angelegte Pre-Orders mit client-`_id` (uuidv7),
// damit der Replay idempotent ist (Resolver: `_id = value || uuidv7()`). Ohne diese
// Öffnung lehnt der Validator die client-`_id` mit 400 ab (additionalProperties:false).
export const preOrderDataSchema = Type.Intersect(
  [Type.Object({ _id: Type.Optional(Type.String()) }), Type.Omit(preOrderSchema, ['_id', 'createdAt', 'updatedAt'])],
  { $id: 'PreOrderData', additionalProperties: false },
)
export type PreOrderData = Static<typeof preOrderDataSchema>
//#endregion

//#region Schema for updates (PATCH)
export const preOrderPatchSchema = Type.Partial(preOrderSchema, {
  $id: 'PreOrderPatch',
})
export type PreOrderPatch = Static<typeof preOrderPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const preOrderQueryProperties = Type.Pick(preOrderSchema, [
  '_id',
  'tenantId',
  'locationId',
  'scheduledFor',
  'status',
  'convertedOrderId',
  // Pflicht für den Offline-Cache-Delta-Sync (`updatedAt > cursor`).
  'updatedAt',
])
export const preOrderQuerySchema = Type.Intersect(
  [
    querySyntax(preOrderQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type PreOrderQuery = Static<typeof preOrderQuerySchema>
//#endregion
