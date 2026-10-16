import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

import type { WriteOff, WriteOffData, WriteOffPatch, WriteOffQuery } from '@panary/write-offs/domain'

export type { WriteOff, WriteOffData, WriteOffPatch, WriteOffQuery }

export type WriteOffParams = KnexAdapterParams<WriteOffQuery> & MongoDBAdapterParams & Params

export interface WriteOffService extends ServiceInterface<WriteOff, WriteOffData, WriteOffParams, WriteOffPatch> {}
