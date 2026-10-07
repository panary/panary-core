import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  WorkingTime,
  workingTimeDataSchema,
  workingTimePatchSchema,
  WorkingTimeQuery,
  workingTimeQuerySchema,
} from '@panary/working-times/domain'
import { WorkingTimeService } from './working-times.class'
import { attributedOperatorId } from '../../utils/pos-operator-attribution'

//#region 1. Main Resolver (Output)
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
  originCheckoutDate: async () => null,
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
  // Geraet (#631, ADR 0053): der per Token belegte Bediener statt `device:<uuid>`.
  updatedBy: async (_value, _data, context) =>
    attributedOperatorId(context.params, (context.params as any).user?._id, {
      service: 'working-times',
      field: 'updatedBy',
      entityId: context.id,
    }),
})
//#endregion

//#region 4. Query Resolver (GET)
export const workingTimeQueryValidator = getValidator(workingTimeQuerySchema, queryValidator)
export const workingTimeQueryResolver = resolve<WorkingTimeQuery, HookContext<WorkingTimeService>>({})
//#endregion
