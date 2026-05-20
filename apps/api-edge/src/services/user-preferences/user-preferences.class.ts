import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type {
  UserPreference,
  UserPreferenceData,
  UserPreferencePatch,
  UserPreferenceQuery
} from '@panary/user-preferences/domain'

export type { UserPreference, UserPreferenceData, UserPreferencePatch, UserPreferenceQuery }

// Combined parameter type for SQL & NoSQL
export type UserPreferenceParams = KnexAdapterParams<UserPreferenceQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface UserPreferenceService
  extends ServiceInterface<UserPreference, UserPreferenceData, UserPreferenceParams, UserPreferencePatch> {}
