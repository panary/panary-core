import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { Order, OrderData, OrderPatch, OrderQuery } from '@panary/orders/domain'

export type { Order, OrderData, OrderPatch, OrderQuery }

// Combined parameter type for SQL & NoSQL
export type OrderParams = KnexAdapterParams<OrderQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface OrderService extends ServiceInterface<Order, OrderData, OrderParams, OrderPatch> {}
