// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { randomUUID } from 'node:crypto'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Apikey,
  apikeyDataSchema,
  apikeyPatchSchema,
  ApikeyQuery,
  apikeyQuerySchema,
  apikeySchema
} from '@panary-core/apikeys/domain'
import { UserSystemRole } from '@panary-core/users/domain'

//#region 1. Main Resolver (Output)
export const apikeyValidator = getValidator(apikeySchema, dataValidator)
export const apikeyResolver = resolve<Apikey, HookContext>({})
export const apikeyExternalResolver = resolve<Apikey, HookContext>({
  // Apikey NIEMALS an den Client zurücksenden!
  apikey: async (value: any, apiKey: any, context: HookContext): Promise<string | undefined> => {
    return context.method === 'create' ? value : undefined
  }
})
//#endregion

//#region 2. Create Resolver (POST)
export const apikeyDataValidator = getValidator(apikeyDataSchema, dataValidator)
export const apikeyDataResolver = resolve<Apikey, HookContext>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },
  apikey: async (): Promise<string> => randomUUID(),
  active: async (): Promise<boolean> => true,
  createdAt: async (): Promise<string> => new Date().toISOString(),
  updatedAt: async (): Promise<string> => new Date().toISOString(),
  createdBy: async (value: any, user: any, context: HookContext) =>
    context.params?.user?.loginname || 'system',
  role: async (value, data, context) => {
    if (value) return value

    if (data.deviceId) {
      try {
        const device = await context.app.service('devices').get(data.deviceId)
        const type = device.type || 'other'
        switch (type) {
          case 'kds':
            return UserSystemRole.DEVICE_KDS
          case 'tablet':
            return UserSystemRole.DEVICE_TABLET
          case 'pos-counter':
            return UserSystemRole.DEVICE_POS
          default:
            return UserSystemRole.DEVICE_POS
        }
      } catch (error) {
        // Device not found or error
      }
    }
    return UserSystemRole.DEVICE_POS
  }
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const apikeyPatchValidator = getValidator(apikeyPatchSchema, dataValidator)
export const apikeyPatchResolver = resolve<Apikey, HookContext>({
  // API-Keys sind nach Erstellung unveränderlich — nur active-Status darf getoggelt werden.
  // Alle anderen Felder werden beim PATCH verworfen (Privilege Escalation verhindern).
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  apikey: async () => undefined,
  name: async () => undefined,
  description: async () => undefined,
  role: async () => undefined,
  validUntil: async () => undefined,
  deviceId: async () => undefined,
  createdBy: async () => undefined,
  lastUsedAt: async () => undefined,
  active: async value => value,
  createdAt: async () => undefined,
  updatedAt: async (): Promise<string> => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const apikeyQueryValidator = getValidator(apikeyQuerySchema, queryValidator)
export const apikeyQueryResolver = resolve<ApikeyQuery, HookContext>({})
//#endregion
