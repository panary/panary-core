import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Order,
  orderDataSchema,
  orderPatchSchema,
  OrderQuery,
  orderQuerySchema,
  orderSchema,
  OrderStatus
} from '@panary-core/orders/domain'
import { OrderService } from './orders.class'

//#region 1. Main Resolver (Output)
export const orderValidator = getValidator(orderSchema, dataValidator)
export const orderResolver = resolve<Order, HookContext<OrderService>>({
  // TODO: Add resolver logic for output here
  // Example: hide fields, resolve relations, etc.
})
export const orderExternalResolver = resolve<Order, HookContext<OrderService>>({
  // TODO: Add resolver logic for external output here
  // Example: Filtering sensitive data
})
//#endregion

//#region 2. Create Resolver (POST)
export const orderDataValidator = getValidator(orderDataSchema, dataValidator)
export const orderDataResolver = resolve<Order, HookContext<OrderService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  status: async (value, data, context) => {
    return value || OrderStatus.ACTIVE
  },
  creationContext: async (value, data, context) => {
    const rawUserId: string | undefined = (context.params as any)?.user?._id || value?.createdBy
    const rawDeviceId: string | undefined = (context.params as any)?.device?._id || value?.createdVia

    if (!rawUserId && !rawDeviceId) {
      return value
    }

    // "device:<uuid>" → nur die UUID extrahieren
    const stripPrefix = (id: string) => id.replace(/^device:/, '')

    return {
      createdBy: rawUserId ? stripPrefix(rawUserId) : value?.createdBy!,
      createdVia: rawDeviceId ? stripPrefix(rawDeviceId) : value?.createdVia,
    }
  }
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const orderPatchValidator = getValidator(orderPatchSchema, dataValidator)
export const orderPatchResolver = resolve<Order, HookContext<OrderService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  recordingDate: async () => undefined,
  dailySequenceNumber: async () => undefined,
  lineItems: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const orderQueryValidator = getValidator(orderQuerySchema, queryValidator)
export const orderQueryResolver = resolve<OrderQuery, HookContext<OrderService>>({
  // TODO: Add query resolver logic here
  // Example: Restriction to own data for normal users
  // _id: async (value, query, context) => {
  //   if (context.params.user?.role !== 'admin') {
  //     return context.params.user?.id
  //   }
  //   return value
  // }
})
//#endregion
