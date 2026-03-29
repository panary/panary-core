import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema, ingredientReferenceSchema, recipeReferenceSchema } from '@panary-core/shared/common'

//#region Enums & Constants
export const OrderChannel = {
  TELEPHONE: 'telephone',
  ONLINE: 'online',
  POS: 'pos',
  APP: 'app',
} as const

export const OrderStatus = {
  ACTIVE: 'active',
  PRODUCTION: 'production',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
  UNCLAIMED: 'unclaimed',
} as const

export const TransactionMethod = {
  CASH: 'cash',
  CARD: 'card',
  ONLINE: 'online',
  OTHER: 'other',
} as const

export const PaymentState = {
  PENDING: 'pending',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  REFUNDED: 'refunded',
} as const

export const DineLocation = {
  DINE_IN: 'dine-in',
  TAKE_OUT: 'take-out',
} as const

export const DiscountType = {
  PERCENT: 'percent',
  AMOUNT: 'amount',
} as const

export const taxSummerySchema = Type.Object({
  taxes: Type.Array(
    Type.Object({
      taxRate: Type.Number(),
      amount: Type.Number(),
      tax: Type.Number(),
    }),
  ),
  netto: Type.Number(),
  brutto: Type.Number(),
})
//#endregion

//#region Sub-Schemas
export const taxSummarySchema = Type.Object({
  taxes: Type.Array(
    Type.Object({
      taxRate: Type.Number(),
      amount: Type.Number(),
      tax: Type.Number(),
    }),
  ),
  netto: Type.Number(),
  brutto: Type.Number(),
})

export const discountSchema = Type.Object({
  discountType: StringEnum(Object.values(DiscountType)),
  discount: Type.Number(),
})

export const cancellationSchema = Type.Object({
  canceledBy: Type.String(),
  reason: Type.String(),
  canceledAt: Type.String({ format: 'date-time' }),
})

export const customerPaymentInfoSchema = Type.Object({
  customerId: Type.String({ format: 'uuid' }), // Was ObjectId
  customerName: Type.String(),
  isPaid: Type.Boolean(),
  payedAt: Type.Optional(Type.String({ format: 'date-time' })), // legacy typo 'payedAt' kept for now, or should fix to paidAt? Keeping structure.
})

export const staffPaymentInfoSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }), // Was ObjectId
  userName: Type.String(),
  isPaid: Type.Boolean(),
  payedAt: Type.Optional(Type.String({ format: 'date-time' })),
})

export const genericLineItemSchema = Type.Object({
  // _id: ObjectIdSchema(), // subdoc ID? usually string in array
  _id: Type.String({ format: 'uuid' }),
  externalId: Type.String({ format: 'uuid' }),
  amount: Type.Number(),
  name: Type.String(),
  parentId: Type.Optional(Type.String({ format: 'uuid' })),
  price: Type.Number(),

  recipeReferences: Type.Array(recipeReferenceSchema),
  ingredientReferences: Type.Array(ingredientReferenceSchema),

  taxInside: Type.Number(),
  taxOutside: Type.Number(),
  topic: Type.String(),
})

export const orderLineItemSchema = Type.Intersect([
  genericLineItemSchema,
  Type.Object({
    acronym: Type.Optional(Type.String()),
    productGroupExternalId: Type.String({ format: 'uuid' }),
    bundleNumber: Type.Union([Type.Number(), Type.Null()]),
    modifiers: Type.Array(genericLineItemSchema),
    index: Type.Optional(Type.Number()),
    isMenu: Type.Boolean(),
    menuDrink: Type.Union([genericLineItemSchema, Type.Null()]),
    menuSideDish: Type.Union([genericLineItemSchema, Type.Null()]),
  }),
])

export const transactionSchema = Type.Object({
  _id: Type.String({ format: 'uuid' }), // Was ObjectId
  method: StringEnum(Object.values(TransactionMethod)),
  amount: Type.Number(),
  currency: Type.String({ default: 'EUR' }),
  timestamp: Type.String({ format: 'date-time' }),
  referenceId: Type.Optional(Type.String()),
  data: Type.Optional(Type.Any()),
  performedBy: Type.Optional(Type.String({ format: 'uuid' })), // Was ObjectId
})

export const paymentSchema = Type.Object({
  state: StringEnum(Object.values(PaymentState)),
  totalAmount: Type.Number(),
  tipAmount: Type.Number({ default: 0 }),
  transactions: Type.Array(transactionSchema),
})

export const creationContextSchema = Type.Object({
  createdBy: Type.String({ format: 'uuid' }), // Was ObjectId
  createdVia: Type.Optional(Type.String({ format: 'uuid' })), // Was ObjectId
})
//#endregion

//#region The main data model (schema)
export const orderSchema = Type.Object(
  {
    ...baseSchema,
    _id: Type.String({ format: 'uuid' }), // Override baseSchema ObjectId
    externalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),

    status: StringEnum(Object.values(OrderStatus)),
    businessDayId: Type.Optional(Type.String({ format: 'uuid' })), // Was ObjectId, now optional for Standalone mode
    orderChannel: StringEnum(Object.values(OrderChannel)),
    dailySequenceNumber: Type.Number(),
    dineLocation: StringEnum(Object.values(DineLocation)),

    lineItems: Type.Array(orderLineItemSchema),

    cancellation: Type.Optional(cancellationSchema),
    customerPaymentInfo: Type.Optional(customerPaymentInfoSchema),
    discount: Type.Optional(discountSchema),
    staffPaymentInfo: Type.Optional(staffPaymentInfoSchema),
    taxSnapshot: Type.Optional(taxSummarySchema),

    creationContext: Type.Optional(creationContextSchema),
    payment: Type.Optional(paymentSchema),

    isFinished: Type.Boolean(),
    // Wenn gesetzt, wurde diese Order aus einer Vorbestellung konvertiert
    preOrderId: Type.Optional(Type.String({ format: 'uuid' })),
    pager: Type.Optional(Type.Number()),
    estimatedDuration: Type.Number(),
    remainingTime: Type.Number(),
    targetCompletionAt: Type.Optional(Type.String({ format: 'date-time' })),
    table: Type.Optional(Type.String()),
    recordingDate: Type.String({ format: 'date-time' }),
  },
  { $id: 'Order', additionalProperties: false },
)
export type Order = Static<typeof orderSchema>
export type OrderLineItem = Static<typeof orderLineItemSchema>
export type TaxInfo = Static<typeof taxSummerySchema>
export type CustomerPaymentInfo = Static<typeof customerPaymentInfoSchema>
export type StaffPaymentInfo = Static<typeof staffPaymentInfoSchema>
export type Cancellation = Static<typeof cancellationSchema>
export type Discount = Static<typeof discountSchema>
export type CreationContext = Static<typeof creationContextSchema>
export type Payment = Static<typeof paymentSchema>
export type Transaction = Static<typeof transactionSchema>
//#endregion

//#region Schema for creation (POST)
export const orderDataSchema = Type.Pick(
  orderSchema,
  [
    'externalId',
    'locationId',
    'tenantId',
    'createdAt',
    'updatedAt',
    'status',
    'businessDayId',
    'orderChannel',
    'dailySequenceNumber',
    'dineLocation',
    'lineItems',
    'cancellation',
    'customerPaymentInfo',
    'discount',
    'staffPaymentInfo',
    'taxSnapshot',
    'creationContext',
    'payment',
    'isFinished',
    'preOrderId',
    'pager',
    'estimatedDuration',
    'remainingTime',
    'table',
    'recordingDate',
  ],
  {
    $id: 'OrderData',
    additionalProperties: false,
  },
)
export type OrderData = Static<typeof orderDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const orderPatchSchema = Type.Partial(orderSchema, {
  $id: 'OrderPatch',
})
export type OrderPatch = Static<typeof orderPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const orderQueryProperties = Type.Pick(orderSchema, [
  '_id',
  'businessDayId',
  'createdAt',
  'recordingDate',
  'orderChannel',
  'isFinished',
  'dailySequenceNumber',
  'pager',
  'status',
  'table',
  'dineLocation',
  'updatedAt',
  'locationId',
  'tenantId',
  // Flattened or specific properties could be added if needed
])
export const orderQuerySchema = Type.Intersect(
  [
    querySyntax(orderQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: true }, // Old schema had additionalProperties: true in query? check step 234 line 281
)
export type OrderQuery = Static<typeof orderQuerySchema>
//#endregion
