// Runtime values (const objects & TypeBox schemas)
export {
  OrderStatus,
  OrderChannel,
  DineLocation,
  DiscountType,
  TransactionMethod,
  PaymentState,
  orderSchema,
  orderDataSchema,
  orderPatchSchema,
  orderQuerySchema,
  cancellationSchema,
  discountSchema,
  customerPaymentInfoSchema,
  staffPaymentInfoSchema,
  transactionSchema,
  paymentSchema,
  creationContextSchema,
} from '@panary-core/orders/domain'

// Pure TypeScript types (Static<> derivations)
export type {
  Order,
  OrderData,
  OrderPatch,
  OrderQuery,
  Cancellation,
  Discount,
  CreationContext,
  Payment,
  Transaction,
  CustomerPaymentInfo,
  StaffPaymentInfo,
  OrderLineItem,
  TaxInfo,
} from '@panary-core/orders/domain'

// Legacy-Alias (value)
export { DineLocation as DineLocationSchema } from '@panary-core/orders/domain'

// Legacy-Alias (type)
export type { Payment as PaymentStateInfo } from '@panary-core/orders/domain'
