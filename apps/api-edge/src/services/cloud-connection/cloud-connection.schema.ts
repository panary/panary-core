import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { uuidv7 } from 'uuidv7'

import {
  CloudConnection,
  cloudConnectionDataSchema,
  cloudConnectionPatchSchema,
  CloudConnectionQuery,
  cloudConnectionQuerySchema,
  cloudConnectionSchema,
  PairingStatus,
} from '@panary-core/cloud-connection/domain'
import { CloudConnectionService } from './cloud-connection.class'

//#region 1. Main Resolver (Output)
export const cloudConnectionValidator = getValidator(cloudConnectionSchema, dataValidator)
export const cloudConnectionResolver = resolve<CloudConnection, HookContext<CloudConnectionService>>({})
export const cloudConnectionExternalResolver = resolve<CloudConnection, HookContext<CloudConnectionService>>({
  // cloudToken darf NIEMALS an den Client zurückgegeben werden
  cloudToken: async () => undefined,
})
//#endregion

//#region 2. Create Resolver (POST)
export const cloudConnectionDataValidator = getValidator(cloudConnectionDataSchema, dataValidator)
export const cloudConnectionDataResolver = resolve<CloudConnection, HookContext<CloudConnectionService>>({
  _id: async value => value || uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  pairingStatus: async () => PairingStatus.PAIRING,
  syncEnabled: async () => false,
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const cloudConnectionPatchValidator = getValidator(cloudConnectionPatchSchema, dataValidator)
export const cloudConnectionPatchResolver = resolve<CloudConnection, HookContext<CloudConnectionService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  cloudToken: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const cloudConnectionQueryValidator = getValidator(cloudConnectionQuerySchema, queryValidator)
export const cloudConnectionQueryResolver = resolve<CloudConnectionQuery, HookContext<CloudConnectionService>>({})
//#endregion
