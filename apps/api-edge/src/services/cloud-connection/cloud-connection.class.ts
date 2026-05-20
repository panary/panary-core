import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type {
  CloudConnection,
  CloudConnectionData,
  CloudConnectionPatch,
  CloudConnectionQuery
} from '@panary/cloud-connection/domain'

export type { CloudConnection, CloudConnectionData, CloudConnectionPatch, CloudConnectionQuery }

// Combined parameter type for SQL & NoSQL
export type CloudConnectionParams = KnexAdapterParams<CloudConnectionQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface CloudConnectionService
  extends ServiceInterface<
    CloudConnection,
    CloudConnectionData,
    CloudConnectionParams,
    CloudConnectionPatch
  > {}
