import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary-core/shared-backend'
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
import { encryptCloudToken } from '../../utils/cloud-token-cipher'
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

// Resolver setzt automatisch _id, createdAt, updatedAt, pairingStatus-Default und
// verschluesselt cloudToken. Wizard-Inputs gehoeren NICHT mehr ins Data-Schema —
// sie werden in den Custom-Methods (preflight/startBootstrap) direkt verarbeitet.
export const cloudConnectionDataResolver = resolve<CloudConnection, HookContext<CloudConnectionService>>({
  _id: async value => value || uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  pairingStatus: async value => value || PairingStatus.DISCONNECTED,
  syncEnabled: async value => value ?? false,
  cloudToken: async value => (typeof value === 'string' ? encryptCloudToken(value) : value),
})
//#endregion

//#region 3. Patch Resolver (PATCH)
// Server-managed Felder duerfen NUR von internen Aufrufen (provider:undefined,
// z.B. vom Bootstrap-Worker oder Token-Rotation) gesetzt werden. Externe Clients
// (mit provider:rest/socketio) sehen diese Felder im Patch-Body als undefined.
// _id/createdAt/updatedAt sind generell nicht patchbar; updatedAt setzt der
// Server immer. cloudToken wird zusaetzlich im internen Pfad verschluesselt.
export const cloudConnectionPatchValidator = getValidator(cloudConnectionPatchSchema, dataValidator)

const filterFromExternal = async <T>(value: T, _row: unknown, context: HookContext<CloudConnectionService>): Promise<T | undefined> =>
  context.params.provider ? undefined : value

export const cloudConnectionPatchResolver = resolve<CloudConnection, HookContext<CloudConnectionService>>({
  _id: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
  // Identitaet immer immutable
  tenantId: filterFromExternal,
  locationId: filterFromExternal,
  // Cloud-Token: extern undefined, intern wird der Klartext-Wert vom internen
  // Code uebergeben und hier verschluesselt.
  cloudToken: async (value, _row, context) => {
    if (context.params.provider) return undefined
    return typeof value === 'string' ? encryptCloudToken(value) : value
  },
  cloudEdgeId: filterFromExternal,
  pairingStatus: filterFromExternal,
  connectedAt: filterFromExternal,
  lastSyncAt: filterFromExternal,
  errorMessage: filterFromExternal,
  initialDirection: filterFromExternal,
  bootstrapStatus: filterFromExternal,
  bootstrapStartedAt: filterFromExternal,
  bootstrapCompletedAt: filterFromExternal,
  bootstrapResumeToken: filterFromExternal,
  bootstrapError: filterFromExternal,
  preflightSnapshot: filterFromExternal,
  tenantIdRestampedAt: filterFromExternal,
  preTenantIdRestampBackupPath: filterFromExternal,
  lastManualSyncAt: filterFromExternal,
  lastScheduledSyncAt: filterFromExternal,
  lastClockSkewMs: filterFromExternal,
  outboxBacklog: filterFromExternal,
})
//#endregion

//#region 4. Query Resolver (GET)
export const cloudConnectionQueryValidator = getValidator(cloudConnectionQuerySchema, queryValidator)
export const cloudConnectionQueryResolver = resolve<CloudConnectionQuery, HookContext<CloudConnectionService>>({})
//#endregion
