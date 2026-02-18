import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  CorporateCustomer,
  corporateCustomerDataSchema,
  corporateCustomerPatchSchema,
  CorporateCustomerQuery,
  corporateCustomerQuerySchema,
  corporateCustomerSchema
} from '@panary-core/corporate-customers/domain'
import { CorporateCustomerService } from './corporate-customers.class'

//#region 1. Main Resolver (Output)
export const corporateCustomerValidator = getValidator(corporateCustomerSchema, dataValidator)
export const corporateCustomerResolver = resolve<CorporateCustomer, HookContext<CorporateCustomerService>>({})
export const corporateCustomerExternalResolver = resolve<
  CorporateCustomer,
  HookContext<CorporateCustomerService>
>({})
//#endregion

//#region 2. Create Resolver (POST)
export const corporateCustomerDataValidator = getValidator(corporateCustomerDataSchema, dataValidator)
export const corporateCustomerDataResolver = resolve<
  CorporateCustomer,
  HookContext<CorporateCustomerService>
>({
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
    return value || 'DRAFT'
  },
  ordersCount: async () => 0
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const corporateCustomerPatchValidator = getValidator(corporateCustomerPatchSchema, dataValidator)
export const corporateCustomerPatchResolver = resolve<
  CorporateCustomer,
  HookContext<CorporateCustomerService>
>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()

  // TODO: Add additional resolver logic here
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const corporateCustomerQueryValidator = getValidator(corporateCustomerQuerySchema, queryValidator)
export const corporateCustomerQueryResolver = resolve<
  CorporateCustomerQuery,
  HookContext<CorporateCustomerService>
>({
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
