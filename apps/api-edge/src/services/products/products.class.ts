import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { Product, ProductData, ProductPatch, ProductQuery } from '@panary-core/products/domain'

export type { Product, ProductData, ProductPatch, ProductQuery }

// Kombinierter Parameter-Typ für SQL & NoSQL
export type ProductsParams = KnexAdapterParams<ProductQuery> & MongoDBAdapterParams & Params

// Service Interface - kann sowohl KnexService als auch MongoDBService sein
export interface ProductService
  extends ServiceInterface<Product, ProductData, ProductsParams, ProductPatch> {}
