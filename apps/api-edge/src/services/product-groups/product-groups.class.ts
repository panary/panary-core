import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type {
  ProductGroup,
  ProductGroupData,
  ProductGroupPatch,
  ProductGroupQuery
} from '@panary/product-groups/domain'

export type { ProductGroup, ProductGroupData, ProductGroupPatch, ProductGroupQuery }

// Combined parameter type for SQL & NoSQL
export type ProductGroupParams = KnexAdapterParams<ProductGroupQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface ProductGroupService
  extends ServiceInterface<ProductGroup, ProductGroupData, ProductGroupParams, ProductGroupPatch> {}
