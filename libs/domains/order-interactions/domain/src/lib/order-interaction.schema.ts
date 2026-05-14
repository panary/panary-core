import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

//#region Enums & Constants (Reusable)
export const OrderInteractionType = {
  ITEM_DELETE: 'item-delete',
  ORDER_CANCEL: 'order-cancel',
  // Phase 4 — Wide-Events-Erweiterung. Capture-Hooks im pos-client folgen
  // in den Phasen 5–7. Schema akzeptiert die neuen Typen schon jetzt,
  // damit der Sync-Pfad ohne weitere Migration mitwaechst.
  DISCOUNT_APPLIED: 'discount-applied',
  PRICE_OVERRIDE: 'price-override',
  REFUND: 'refund',
  VOID_AFTER_PAYMENT: 'void-after-payment',
  NO_SALE_DRAWER_OPEN: 'no-sale-drawer-open',
  RECEIPT_REPRINT: 'receipt-reprint',
} as const

export const PaymentStatusAtEvent = {
  OPEN: 'OPEN',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
} as const

export const OrderChannel = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
} as const

export const DiscountAppliesTo = {
  LINE_ITEM: 'LINE_ITEM',
  ORDER_TOTAL: 'ORDER_TOTAL',
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

    // Time reference. orderOpenedAt + eventOffsetMs sind ab Phase 4 optional,
    // weil order-lose Events (NO_SALE_DRAWER_OPEN, RECEIPT_REPRINT) keinen
    // Bezug zu einer offenen Order haben. Klassische Item-/Order-Stornos
    // schreiben sie weiterhin pflichtmaessig — nur die Schema-Constraint
    // ist gelockert.
    orderOpenedAt: Type.Optional(Type.String({ format: 'date-time' })),
    eventAt: Type.String({ format: 'date-time' }),
    eventOffsetMs: Type.Optional(Type.Number()),

    // Data for position deletion
    productId: Type.Optional(Type.String({ format: 'uuid' })),
    lineItemId: Type.Optional(Type.Number()),
    deletedQuantity: Type.Optional(Type.Number()),

    // Data for complete cancellation
    hadLineItems: Type.Optional(Type.Boolean()),
    lineItemCountAtCancel: Type.Optional(Type.Number()),
    totalQuantityAtCancel: Type.Optional(Type.Number()),

    //#region Phase 4 — Wide-Event-Kontext (alle optional, additiv)
    /** Cross-Service-Korrelation Edge↔Cloud. uuidv7 vom Capture-Hook. */
    requestId: Type.Optional(Type.String()),
    /** Schicht-Ableitung, wenn am Edge bekannt; sonst von der Aggregation erschlossen. */
    shiftId: Type.Optional(Type.String({ format: 'uuid' })),
    /** Order-Total in Cents vor/nach dem Event. */
    orderTotalCentsBeforeEvent: Type.Optional(Type.Integer({ minimum: 0 })),
    orderTotalCentsAfterEvent: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Payment-Status zum Event-Zeitpunkt — kritisch fuer void-after-payment-Detektion. */
    paymentStatusAtEvent: Type.Optional(StringEnum(['OPEN', 'PARTIALLY_PAID', 'PAID'])),
    customerIdentified: Type.Optional(Type.Boolean()),
    customerLoyaltyTier: Type.Optional(Type.String({ maxLength: 50 })),
    orderChannel: Type.Optional(StringEnum(['DINE_IN', 'TAKEAWAY', 'DELIVERY'])),
    edgeAppVersion: Type.Optional(Type.String({ maxLength: 50 })),
    posClientVersion: Type.Optional(Type.String({ maxLength: 50 })),
    deviceId: Type.Optional(Type.String({ format: 'uuid' })),
    posStationName: Type.Optional(Type.String({ maxLength: 120 })),

    // DISCOUNT_APPLIED
    discountAmountCents: Type.Optional(Type.Integer({ minimum: 0 })),
    discountPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    discountReasonCode: Type.Optional(Type.String({ maxLength: 50 })),
    discountAppliesTo: Type.Optional(StringEnum(['LINE_ITEM', 'ORDER_TOTAL'])),

    // PRICE_OVERRIDE
    priceBeforeCents: Type.Optional(Type.Integer({ minimum: 0 })),
    priceAfterCents: Type.Optional(Type.Integer({ minimum: 0 })),
    priceOverrideReason: Type.Optional(Type.String({ maxLength: 200 })),

    // REFUND / VOID_AFTER_PAYMENT
    paymentId: Type.Optional(Type.String({ format: 'uuid' })),
    refundAmountCents: Type.Optional(Type.Integer({ minimum: 0 })),
    refundReasonCode: Type.Optional(Type.String({ maxLength: 50 })),

    // NO_SALE_DRAWER_OPEN
    drawerOpenedReason: Type.Optional(Type.String({ maxLength: 200 })),

    // RECEIPT_REPRINT
    originalReceiptId: Type.Optional(Type.String({ format: 'uuid' })),
    reprintCount: Type.Optional(Type.Integer({ minimum: 1 })),
    //#endregion
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
    // Phase 4 — Wide-Event-Kontext
    'requestId',
    'shiftId',
    'orderTotalCentsBeforeEvent',
    'orderTotalCentsAfterEvent',
    'paymentStatusAtEvent',
    'customerIdentified',
    'customerLoyaltyTier',
    'orderChannel',
    'edgeAppVersion',
    'posClientVersion',
    'deviceId',
    'posStationName',
    'discountAmountCents',
    'discountPercent',
    'discountReasonCode',
    'discountAppliesTo',
    'priceBeforeCents',
    'priceAfterCents',
    'priceOverrideReason',
    'paymentId',
    'refundAmountCents',
    'refundReasonCode',
    'drawerOpenedReason',
    'originalReceiptId',
    'reprintCount',
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
