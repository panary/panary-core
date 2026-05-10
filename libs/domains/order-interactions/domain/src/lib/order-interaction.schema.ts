import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

//#region Enums & Constants (Reusable)
export const OrderInteractionType = {
  ITEM_DELETE: 'item-delete',
  ORDER_CANCEL: 'order-cancel',
} as const
//#endregion

//#region The main data model (schema)
export const orderInteractionSchema = Type.Object(
  {
    ...baseSchema,

    type: StringEnum(Object.values(OrderInteractionType)),

    // References (changed from ObjectId to String/UUID)
    orderId: Type.Optional(Type.String({ format: 'uuid' })),
    userId: Type.String({ format: 'uuid' }), // Assumed mandatory as per old schema
    sessionId: Type.Optional(Type.String()), // Session might not be UUID
    businessDayId: Type.Optional(Type.String()), // BusinessDay ID might be UUID or other format
    businessDate: Type.Optional(Type.String({ format: 'date' })),

    // Time reference
    orderOpenedAt: Type.String({ format: 'date-time' }),
    eventAt: Type.String({ format: 'date-time' }),
    eventOffsetMs: Type.Number(),

    // Data for position deletion
    productId: Type.Optional(Type.String({ format: 'uuid' })),
    lineItemId: Type.Optional(Type.Number()),
    deletedQuantity: Type.Optional(Type.Number()),

    // Data for complete cancellation
    hadLineItems: Type.Optional(Type.Boolean()),
    lineItemCountAtCancel: Type.Optional(Type.Number()),
    totalQuantityAtCancel: Type.Optional(Type.Number()),
  },
  { $id: 'OrderInteraction', additionalProperties: false },
)
export type OrderInteraction = Static<typeof orderInteractionSchema>
//#endregion

//#region Schema for creation (POST)
export const orderInteractionDataSchema = Type.Pick(
  orderInteractionSchema,
  [
    'tenantId',
    'locationId',
    'type',
    'orderId',
    'userId',
    'sessionId',
    'businessDayId',
    'businessDate',
    'orderOpenedAt',
    'eventAt',
    'eventOffsetMs',
    'productId',
    'lineItemId',
    'deletedQuantity',
    'hadLineItems',
    'lineItemCountAtCancel',
    'totalQuantityAtCancel',
    'createdAt',
    'updatedAt',
  ],
  {
    $id: 'OrderInteractionData',
    additionalProperties: false,
  },
)
export type OrderInteractionData = Static<typeof orderInteractionDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const orderInteractionPatchSchema = Type.Partial(orderInteractionSchema, {
  $id: 'OrderInteractionPatch',
})
export type OrderInteractionPatch = Static<typeof orderInteractionPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const orderInteractionQueryProperties = Type.Pick(orderInteractionSchema, [
  '_id',
  'type',
  'orderId',
  'userId',
  'sessionId',
  'businessDayId',
  'businessDate',
  // Pflicht fuer multiTenancy()-Hook (filtert query.tenantId/locationId)
  // und Sync-Backfill (`createdAt > since`), Sync-Pull (`updatedAt > since`).
  'tenantId',
  'locationId',
  'createdAt',
  'updatedAt',
])
export const orderInteractionQuerySchema = Type.Intersect(
  [
    querySyntax(orderInteractionQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type OrderInteractionQuery = Static<typeof orderInteractionQuerySchema>
//#endregion
