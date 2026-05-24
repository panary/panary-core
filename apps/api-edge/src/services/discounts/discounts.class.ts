import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

import type { Discount, DiscountData, DiscountPatch, DiscountQuery } from '@panary/discounts/domain'

export type { Discount, DiscountData, DiscountPatch, DiscountQuery }

export type DiscountParams = KnexAdapterParams<DiscountQuery> & MongoDBAdapterParams & Params

export interface DiscountService
  extends ServiceInterface<Discount, DiscountData, DiscountParams, DiscountPatch> {}
