import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { type WriteOff, writeOffDataSchema, type WriteOffQuery, writeOffQuerySchema } from '@panary/write-offs/domain'
import { dataValidator, queryValidator } from '@panary/shared-backend'

import type { HookContext } from '../../declarations'

export const writeOffDataValidator = getValidator(writeOffDataSchema, dataValidator)
export const writeOffQueryValidator = getValidator(writeOffQuerySchema, queryValidator)

export const writeOffResolver = resolve<WriteOff, HookContext>({})
export const writeOffExternalResolver = resolve<WriteOff, HookContext>({})

export const writeOffDataResolver = resolve<WriteOff, HookContext>({
  _id: async value => value || uuidv7(),
  // Erfassungszeitpunkt setzt der Edge; die Cloud datiert die Lagerbewegung darauf
  // (panary/panary-cloud#1205). Ein Client-Wert zählt nicht.
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

export const writeOffQueryResolver = resolve<WriteOffQuery, HookContext>({})
