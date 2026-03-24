import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { User, UserData, UserPatch, UserQuery } from '@panary-core/users/domain'

export type { User, UserData, UserPatch, UserQuery }

// Combined parameter type for SQL & NoSQL
export type UserParams = KnexAdapterParams<UserQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface UserService extends ServiceInterface<User, UserData, UserParams, UserPatch> {
  checkin(data: { userId: string }, params?: UserParams): Promise<User>
  checkout(data: { userId: string }, params?: UserParams): Promise<User>
  startBreak(data: { userId: string }, params?: UserParams): Promise<User>
  endBreak(data: { userId: string }, params?: UserParams): Promise<User>
}
