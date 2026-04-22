import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary-core/shared-backend'
import { uuidv7 } from 'uuidv7'

import {
  PreOrder,
  preOrderDataSchema,
  preOrderPatchSchema,
  PreOrderQuery,
  preOrderQuerySchema,
  preOrderSchema,
  PreOrderStatus,
} from '@panary-core/pre-orders/domain'
import type { PreOrderService } from './pre-orders.class'

//#region 1. Main Resolver (Output)
export const preOrderValidator = getValidator(preOrderSchema, dataValidator)
export const preOrderResolver = resolve<PreOrder, HookContext<PreOrderService>>({})
export const preOrderExternalResolver = resolve<PreOrder, HookContext<PreOrderService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const preOrderDataValidator = getValidator(preOrderDataSchema, dataValidator)
export const preOrderDataResolver = resolve<PreOrder, HookContext<PreOrderService>>({
  _id: async value => value || uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  status: async value => value || PreOrderStatus.PENDING,
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const preOrderPatchValidator = getValidator(preOrderPatchSchema, dataValidator)
export const preOrderPatchResolver = resolve<PreOrder, HookContext<PreOrderService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const preOrderQueryValidator = getValidator(preOrderQuerySchema, queryValidator)
export const preOrderQueryResolver = resolve<PreOrderQuery, HookContext<PreOrderService>>({})
//#endregion
