import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { Customer, CustomerData, CustomerPatch, CustomerQuery } from '@panary/customers/domain'

export type { Customer, CustomerData, CustomerPatch, CustomerQuery }

// Combined parameter type for SQL & NoSQL
export type CustomerParams = KnexAdapterParams<CustomerQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface CustomerService
  extends ServiceInterface<Customer, CustomerData, CustomerParams, CustomerPatch> {}
