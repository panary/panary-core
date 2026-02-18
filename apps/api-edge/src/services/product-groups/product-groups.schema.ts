import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  ProductGroup,
  productGroupDataSchema,
  productGroupPatchSchema,
  ProductGroupQuery,
  productGroupQuerySchema,
  productGroupSchema
} from '@panary-core/product-groups/domain'
import { ProductGroupService } from './product-groups.class'

//#region 1. Main Resolver (Output)
export const productGroupValidator = getValidator(productGroupSchema, dataValidator)
export const productGroupResolver = resolve<ProductGroup, HookContext<ProductGroupService>>({})
export const productGroupExternalResolver = resolve<ProductGroup, HookContext<ProductGroupService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const productGroupDataValidator = getValidator(productGroupDataSchema, dataValidator)
export const productGroupDataResolver = resolve<ProductGroup, HookContext<ProductGroupService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  externalId: async (value, data, context) => {
    return value || uuidv7()
  },
  status: async (value, data, context) => {
    return value || 'DRAFT'
  }
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const productGroupPatchValidator = getValidator(productGroupPatchSchema, dataValidator)
export const productGroupPatchResolver = resolve<ProductGroup, HookContext<ProductGroupService>>({
  _id: async () => undefined,
  externalId: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()

  // TODO: Add additional resolver logic here
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const productGroupQueryValidator = getValidator(productGroupQuerySchema, queryValidator)
export const productGroupQueryResolver = resolve<ProductGroupQuery, HookContext<ProductGroupService>>({
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
