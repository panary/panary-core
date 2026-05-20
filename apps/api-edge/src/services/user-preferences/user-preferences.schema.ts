import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  UserPreference,
  userPreferenceDataSchema,
  userPreferencePatchSchema,
  UserPreferenceQuery,
  userPreferenceQuerySchema,
  userPreferenceSchema
} from '@panary/user-preferences/domain'
import { UserPreferenceService } from './user-preferences.class'

//#region 1. Main Resolver (Output)
export const userPreferenceValidator = getValidator(userPreferenceSchema, dataValidator)
export const userPreferenceResolver = resolve<UserPreference, HookContext<UserPreferenceService>>({
})
export const userPreferenceExternalResolver = resolve<UserPreference, HookContext<UserPreferenceService>>({
})
//#endregion

//#region 2. Create Resolver (POST)
export const userPreferenceDataValidator = getValidator(userPreferenceDataSchema, dataValidator)
export const userPreferenceDataResolver = resolve<UserPreference, HookContext<UserPreferenceService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const userPreferencePatchValidator = getValidator(userPreferencePatchSchema, dataValidator)
export const userPreferencePatchResolver = resolve<UserPreference, HookContext<UserPreferenceService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const userPreferenceQueryValidator = getValidator(userPreferenceQuerySchema, queryValidator)
export const userPreferenceQueryResolver = resolve<UserPreferenceQuery, HookContext<UserPreferenceService>>({
  userId: async (value, user, context) => {
    const params = context.params as any
    const role = params?.user?.role

    if (params?.user && !['platform:admin', 'platform:owner', 'admin', 'superadmin'].includes(role)) {
      return params.user._id
    }
    return value
  }
})
//#endregion
