import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary-core/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  WorkingTime,
  workingTimeDataSchema,
  workingTimePatchSchema,
  WorkingTimeQuery,
  workingTimeQuerySchema,
  workingTimeSchema
} from '@panary-core/working-times/domain'
import { WorkingTimeService } from './working-times.class'

//#region 1. Main Resolver (Output)
export const workingTimeValidator = getValidator(workingTimeSchema, dataValidator)
export const workingTimeResolver = resolve<WorkingTime, HookContext<WorkingTimeService>>({})
export const workingTimeExternalResolver = resolve<WorkingTime, HookContext<WorkingTimeService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const workingTimeDataValidator = getValidator(workingTimeDataSchema, dataValidator)
export const workingTimeDataResolver = resolve<WorkingTime, HookContext<WorkingTimeService>>({
  _id: async () => uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  originCheckinDate: async (value, data) => data.checkinDate || new Date().toISOString(),
  checkinDate: async value => value || new Date().toISOString(),
  breaks: async () => [] as WorkingTime['breaks'],
  checkoutDate: async () => null,
  originCheckoutDate: async () => null
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const workingTimePatchValidator = getValidator(workingTimePatchSchema, dataValidator)
export const workingTimePatchResolver = resolve<WorkingTime, HookContext<WorkingTimeService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  originCheckinDate: async () => undefined,
  checkinDate: async () => undefined,
  userId: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
  updatedBy: async (_value, _data, context) => (context.params as any).user?._id
})
//#endregion

//#region 4. Query Resolver (GET)
export const workingTimeQueryValidator = getValidator(workingTimeQuerySchema, queryValidator)
export const workingTimeQueryResolver = resolve<WorkingTimeQuery, HookContext<WorkingTimeService>>({})
//#endregion
