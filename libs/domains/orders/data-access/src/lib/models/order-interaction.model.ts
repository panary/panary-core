// Runtime values
export {
  OrderInteractionType,
  orderInteractionSchema,
  orderInteractionDataSchema,
  orderInteractionPatchSchema,
  orderInteractionQuerySchema,
} from '@panary-core/order-interactions/domain'

// Pure TypeScript types
export type {
  OrderInteraction,
  OrderInteractionData,
  OrderInteractionPatch,
  OrderInteractionQuery,
} from '@panary-core/order-interactions/domain'

// Legacy-Alias (type)
export type { OrderInteraction as OrderInteractionSchema } from '@panary-core/order-interactions/domain'
