import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { Location, LocationData, LocationPatch, LocationQuery } from '@panary-core/locations/domain'

export type { Location, LocationData, LocationPatch, LocationQuery }

// Combined parameter type for SQL & NoSQL
export type LocationParams = KnexAdapterParams<LocationQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface LocationService
  extends ServiceInterface<Location, LocationData, LocationParams, LocationPatch> {}
