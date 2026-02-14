import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Import
import type { Apikey, ApikeyData, ApikeyPatch, ApikeyQuery } from '@panary-core/apikeys/domain'

export type { Apikey, ApikeyData, ApikeyPatch, ApikeyQuery }

// Combined parameter type for SQL & NoSQL
export type ApikeyParams = KnexAdapterParams<ApikeyQuery> & MongoDBAdapterParams & Params

// Service Interface - can be KnexService or MongoDBService
export interface ApiKeyService extends ServiceInterface<Apikey, ApikeyData, ApikeyParams, ApikeyPatch> {}
