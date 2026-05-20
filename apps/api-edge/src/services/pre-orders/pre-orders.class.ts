import type { Id, Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'
import type { Order } from '@panary/orders/domain'

import type { PreOrder, PreOrderData, PreOrderPatch, PreOrderQuery } from '@panary/pre-orders/domain'

export type { PreOrder, PreOrderData, PreOrderPatch, PreOrderQuery }

// Combined parameter type for SQL & NoSQL
export type PreOrderParams = KnexAdapterParams<PreOrderQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface PreOrderService
  extends ServiceInterface<PreOrder, PreOrderData, PreOrderParams, PreOrderPatch> {
  convert(id: Id, params?: PreOrderParams): Promise<Order>
}
