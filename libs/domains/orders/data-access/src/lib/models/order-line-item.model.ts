import type { Static } from '@feathersjs/typebox'
import type { genericLineItemSchema } from '@panary-core/orders/domain'

// Runtime values (TypeBox schemas)
export { orderLineItemSchema, genericLineItemSchema } from '@panary-core/orders/domain'

// Pure TypeScript types
export type { OrderLineItem } from '@panary-core/orders/domain'
export type { OrderLineItem as OrderLineItemSchema } from '@panary-core/orders/domain'

// GenericOrderLineItemSchema: Typ für Sub-Items (Modifiers, Menu-Items)
export type GenericOrderLineItemSchema = Static<typeof genericLineItemSchema>
