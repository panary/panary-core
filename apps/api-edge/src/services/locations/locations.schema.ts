import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Location,
  locationDataSchema,
  locationPatchSchema,
  LocationQuery,
  locationQuerySchema,
  locationSchema,
  generateDefaultLocationSettings, LocationStatus
} from '@panary-core/locations/domain'
import { LocationService } from './locations.class'

//#region 1. Main Resolver (Output)
export const locationValidator = getValidator(locationSchema, dataValidator)
export const locationResolver = resolve<Location, HookContext<LocationService>>({})
export const locationExternalResolver = resolve<Location, HookContext<LocationService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const locationDataValidator = getValidator(locationDataSchema, dataValidator)
export const locationDataResolver = resolve<Location, HookContext<LocationService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  settings: async () => generateDefaultLocationSettings,
  status: async () => LocationStatus.DRAFT
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const locationPatchValidator = getValidator(locationPatchSchema, dataValidator)
export const locationPatchResolver = resolve<Location, HookContext<LocationService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const locationQueryValidator = getValidator(locationQuerySchema, queryValidator)
export const locationQueryResolver = resolve<LocationQuery, HookContext<LocationService>>({
  // Example: Restriction to own data for normal users
  // _id: async (value, query, context) => {
  //   if (context.params.user?.role !== 'admin') {
  //     return context.params.user?.id
  //   }
  //   return value
  // }
})
//#endregion
