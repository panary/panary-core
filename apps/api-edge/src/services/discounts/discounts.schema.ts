import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

import {
  Discount,
  discountDataSchema,
  discountPatchSchema,
  DiscountQuery,
  discountQuerySchema,
  discountSchema,
} from '@panary/discounts/domain'
import { DiscountService } from './discounts.class'

//#region 1. Main Resolver (Output) — keine sensitiven Felder
export const discountValidator = getValidator(discountSchema, dataValidator)
export const discountResolver = resolve<Discount, HookContext<DiscountService>>({})
export const discountExternalResolver = resolve<Discount, HookContext<DiscountService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const discountDataValidator = getValidator(discountDataSchema, dataValidator)
export const discountDataResolver = resolve<Discount, HookContext<DiscountService>>({
  // Offline-First: bereits clientseitig generierte _id akzeptieren, sonst neue.
  _id: async value => value || uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const discountPatchValidator = getValidator(discountPatchSchema, dataValidator)
export const discountPatchResolver = resolve<Discount, HookContext<DiscountService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const discountQueryValidator = getValidator(discountQuerySchema, queryValidator)
export const discountQueryResolver = resolve<DiscountQuery, HookContext<DiscountService>>({})
//#endregion
