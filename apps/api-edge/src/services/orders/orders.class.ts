import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { Order, OrderData, OrderPatch, OrderQuery } from '@panary/orders/domain'

export type { Order, OrderData, OrderPatch, OrderQuery }

// Combined parameter type for SQL & NoSQL
export type OrderParams = KnexAdapterParams<OrderQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
import type { OrderSplitRequest, OrderSplitResult } from './order-split.method'

export interface OrderService extends ServiceInterface<Order, OrderData, OrderParams, OrderPatch> {
  /** Split („getrennt zahlen", panary/panary-core#349) — siehe `order-split.method.ts`. */
  split(data: OrderSplitRequest, params?: OrderParams): Promise<OrderSplitResult>
}
