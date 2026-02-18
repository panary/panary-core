import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Device,
  deviceDataSchema,
  devicePatchSchema,
  DeviceQuery,
  deviceQuerySchema,
  deviceSchema
} from '@panary-core/devices/domain'
import { DeviceService } from './devices.class'

//#region 1. Main Resolver (Output)
export const deviceValidator = getValidator(deviceSchema, dataValidator)
export const deviceResolver = resolve<Device, HookContext<DeviceService>>({
  // TODO: Add resolver logic for output here
  // Example: hide fields, resolve relations, etc.
})
export const deviceExternalResolver = resolve<Device, HookContext<DeviceService>>({
  // TODO: Add resolver logic for external output here
  // Example: Filtering sensitive data
})
//#endregion

//#region 2. Create Resolver (POST)
export const deviceDataValidator = getValidator(deviceDataSchema, dataValidator)
export const deviceDataResolver = resolve<Device, HookContext<DeviceService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },
  deviceId: async () => uuidv7(),
  active: async () => true,

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  createdBy: async (value, data, context) => {
    return (context.params as any)?.user?.loginname || 'system'
  }
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const devicePatchValidator = getValidator(devicePatchSchema, dataValidator)
export const devicePatchResolver = resolve<Device, HookContext<DeviceService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  deviceId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const deviceQueryValidator = getValidator(deviceQuerySchema, queryValidator)
export const deviceQueryResolver = resolve<DeviceQuery, HookContext<DeviceService>>({
  // Example: Restriction to own data for normal users
  // _id: async (value, query, context) => {
  //   if (context.params.user?.role !== 'admin') {
  //     return context.params.user?.id
  //   }
  //   return value
  // }
})
//#endregion
