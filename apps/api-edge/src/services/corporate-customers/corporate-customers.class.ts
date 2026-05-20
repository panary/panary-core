import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type {
  CorporateCustomer,
  CorporateCustomerData,
  CorporateCustomerPatch,
  CorporateCustomerQuery
} from '@panary/corporate-customers/domain'

export type { CorporateCustomer, CorporateCustomerData, CorporateCustomerPatch, CorporateCustomerQuery }

// Combined parameter type for SQL & NoSQL
export type CorporateCustomerParams = KnexAdapterParams<CorporateCustomerQuery> &
  MongoDBAdapterParams &
  Params

// Service Interface - can be either KnexService or MongoDBService
export interface CorporateCustomerService
  extends ServiceInterface<
    CorporateCustomer,
    CorporateCustomerData,
    CorporateCustomerParams,
    CorporateCustomerPatch
  > {}
