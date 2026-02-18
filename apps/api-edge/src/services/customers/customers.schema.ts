import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Customer,
  customerDataSchema,
  customerPatchSchema,
  CustomerQuery,
  customerQuerySchema,
  customerSchema
} from '@panary-core/customers/domain'
import { CustomerService } from './customers.class'

//#region 1. Main Resolver (Output)
export const customerValidator = getValidator(customerSchema, dataValidator)
export const customerResolver = resolve<Customer, HookContext<CustomerService>>({})
export const customerExternalResolver = resolve<Customer, HookContext<CustomerService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const customerDataValidator = getValidator(customerDataSchema, dataValidator)
export const customerDataResolver = resolve<Customer, HookContext<CustomerService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  ordersCount: async () => 0
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const customerPatchValidator = getValidator(customerPatchSchema, dataValidator)
export const customerPatchResolver = resolve<Customer, HookContext<CustomerService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const customerQueryValidator = getValidator(customerQuerySchema, queryValidator)
export const customerQueryResolver = resolve<CustomerQuery, HookContext<CustomerService>>({
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
