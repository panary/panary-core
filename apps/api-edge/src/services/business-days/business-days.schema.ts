import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  type BusinessDay,
  businessDayDataSchema,
  businessDayPatchSchema,
  type BusinessDayQuery,
  businessDayQuerySchema,
  businessDaySchema,
  BusinessDayStatus,
  BusinessDayOperationMode,
} from '@panary-core/businessdays/domain'

import { dataValidator, queryValidator } from '@panary-core/shared-backend'
import type { HookContext } from '../../declarations'
import type { BusinessDayService } from './business-days.class'

export const businessDayValidator = getValidator(businessDaySchema, dataValidator)
export const businessDayResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({
  // isOpen wird konsistent zu status gehalten — falls aus alter DB nur status
  // existiert, leite isOpen ab.
  isOpen: async (value, entity) =>
    value !== undefined ? value : entity?.status === BusinessDayStatus.OPEN,
})
export const businessDayExternalResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({})

export const businessDayDataValidator = getValidator(businessDayDataSchema, dataValidator)
export const businessDayDataResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({
  _id: async value => value || uuidv7(),
  status: async () => BusinessDayStatus.OPEN,
  isOpen: async () => true,
  openedAt: async () => new Date().toISOString(),
  closedAt: async () => null,
  reportId: async () => null,
  reportErrorMessage: async () => null,
  operationMode: async (value) => value || BusinessDayOperationMode.POS_CASHIER,
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

export const businessDayPatchValidator = getValidator(businessDayPatchSchema, dataValidator)
export const businessDayPatchResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  openedAt: async () => undefined,
  operationMode: async () => undefined,        // Mode-Snapshot ist unveraenderlich
  updatedAt: async () => new Date().toISOString(),
})

export const businessDayQueryValidator = getValidator(businessDayQuerySchema, queryValidator)
export const businessDayQueryResolver = resolve<BusinessDayQuery, HookContext<BusinessDayService>>({})
