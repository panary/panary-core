import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { dataValidator, queryValidator } from '@panary/shared-backend'
import {
  type SyncConflict,
  syncConflictPatchSchema,
  syncConflictQuerySchema,
  syncConflictSchema,
  SyncConflictStatus,
  type SyncConflictQuery,
} from '@panary/sync/domain'

import type { HookContext } from '../../declarations'

export const syncConflictDataValidator = getValidator(syncConflictSchema, dataValidator)
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

// Patch-Daten kommen schon vom Validator gefiltert (nur `resolution` ist
// erlaubt). Der Resolver setzt zusaetzlich Status, Timestamp und User —
// alle weiteren Felder werden vom Validator abgewiesen, deswegen brauchen
// sie hier keinen expliziten "undefined"-Resolver.
export const syncConflictPatchResolver = resolve<Record<string, unknown>, HookContext>({
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
