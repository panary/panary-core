import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary-core/shared-backend'
import { uuidv7 } from 'uuidv7'

import {
  OpeningHourException,
  openingHourExceptionDataSchema,
  openingHourExceptionPatchSchema,
  OpeningHourExceptionQuery,
  openingHourExceptionQuerySchema,
  openingHourExceptionSchema,
} from '@panary-core/opening-hour-exceptions/domain'
import { OpeningHourExceptionService } from './opening-hour-exceptions.class'

//#region 1. Main Resolver (Output)
export const openingHourExceptionValidator = getValidator(openingHourExceptionSchema, dataValidator)
export const openingHourExceptionResolver = resolve<OpeningHourException, HookContext<OpeningHourExceptionService>>({})
export const openingHourExceptionExternalResolver = resolve<
  OpeningHourException,
  HookContext<OpeningHourExceptionService>
>({})
//#endregion

//#region 2. Create Resolver (POST)
export const openingHourExceptionDataValidator = getValidator(openingHourExceptionDataSchema, dataValidator)
export const openingHourExceptionDataResolver = resolve<
  OpeningHourException,
  HookContext<OpeningHourExceptionService>
>({
  _id: async value => value || uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const openingHourExceptionPatchValidator = getValidator(openingHourExceptionPatchSchema, dataValidator)
export const openingHourExceptionPatchResolver = resolve<
  OpeningHourException,
  HookContext<OpeningHourExceptionService>
>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const openingHourExceptionQueryValidator = getValidator(openingHourExceptionQuerySchema, queryValidator)
export const openingHourExceptionQueryResolver = resolve<
  OpeningHourExceptionQuery,
  HookContext<OpeningHourExceptionService>
>({})
//#endregion
