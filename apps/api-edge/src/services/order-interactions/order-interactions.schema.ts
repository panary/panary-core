import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  OrderInteraction,
  orderInteractionDataSchema,
  orderInteractionPatchSchema,
  OrderInteractionQuery,
  orderInteractionQuerySchema,
  orderInteractionSchema
} from '@panary-core/order-interactions/domain'
import { OrderInteractionService } from './order-interactions.class'

//#region 1. Main Resolver (Output)
export const orderInteractionValidator = getValidator(orderInteractionSchema, dataValidator)
export const orderInteractionResolver = resolve<OrderInteraction, HookContext<OrderInteractionService>>({
  // TODO: Add resolver logic for output here
  // Example: hide fields, resolve relations, etc.
})
export const orderInteractionExternalResolver = resolve<
  OrderInteraction,
  HookContext<OrderInteractionService>
>({
  // TODO: Add resolver logic for external output here
  // Example: Filtering sensitive data
})
//#endregion

//#region 2. Create Resolver (POST)
export const orderInteractionDataValidator = getValidator(orderInteractionDataSchema, dataValidator)
export const orderInteractionDataResolver = resolve<OrderInteraction, HookContext<OrderInteractionService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const orderInteractionPatchValidator = getValidator(orderInteractionPatchSchema, dataValidator)
export const orderInteractionPatchResolver = resolve<OrderInteraction, HookContext<OrderInteractionService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const orderInteractionQueryValidator = getValidator(orderInteractionQuerySchema, queryValidator)
export const orderInteractionQueryResolver = resolve<
  OrderInteractionQuery,
  HookContext<OrderInteractionService>
>({
  // Example: Restriction to own data for normal users
  // _id: async (value, query, context) => {
  //   if (context.params.user?.role !== 'admin') {
  //     return context.params.user?.id
  //   }
  //   return value
  // }
})
//#endregion
