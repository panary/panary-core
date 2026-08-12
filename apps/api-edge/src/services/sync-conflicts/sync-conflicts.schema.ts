import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { dataValidator, queryValidator } from '@panary/shared-backend'
import {
  type SyncConflict,
  syncConflictDataSchema,
  syncConflictPatchSchema,
  syncConflictQuerySchema,
  SyncConflictStatus,
  type SyncConflictQuery,
} from '@panary/sync/domain'

import type { HookContext } from '../../declarations'

// Create validiert gegen das Data-Schema (ohne createdAt/updatedAt) — die
// Timestamps stempelt der syncConflictDataResolver NACH der Validierung.
export const syncConflictDataValidator = getValidator(syncConflictDataSchema, dataValidator)
export const syncConflictPatchValidator = getValidator(syncConflictPatchSchema, dataValidator)
export const syncConflictQueryValidator = getValidator(syncConflictQuerySchema, queryValidator)

export const syncConflictResolver = resolve<SyncConflict, HookContext>({})
export const syncConflictExternalResolver = resolve<SyncConflict, HookContext>({})

export const syncConflictDataResolver = resolve<SyncConflict, HookContext>({
  _id: async value => value || uuidv7(),
  status: async value => value ?? SyncConflictStatus.OPEN,
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

// Patch-Daten kommen schon vom Validator gefiltert. `tenantId` ist seit #183
// im Patch-Schema erlaubt — nicht als Erlaubnis, sondern weil `multiTenancy()`
// es in `around.all` stempelt, bevor `validateData` laeuft. Der Resolver wirft
// es hier wieder weg (Pflichtmuster aus `.claude/rules/security.md` §8:
// `_id`/`tenantId`/`createdAt` sind nicht veraenderbar) — sonst koennte ein
// mitgesendeter Wert den Konflikt einem fremden Mandanten zuschreiben.
export const syncConflictPatchResolver = resolve<Record<string, unknown>, HookContext>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
  status: async (_value, _row, context) => {
    if ((context.data as any)?.resolution) return SyncConflictStatus.RESOLVED
    return undefined
  },
  resolvedAt: async (_value, _row, context) => {
    if ((context.data as any)?.resolution) return new Date().toISOString()
    return undefined
  },
  resolvedByUserId: async (_value, _row, context) => {
    if ((context.data as any)?.resolution) {
      return (context.params.user as { _id?: string } | undefined)?._id
    }
    return undefined
  },
})

export const syncConflictQueryResolver = resolve<SyncConflictQuery, HookContext>({})
