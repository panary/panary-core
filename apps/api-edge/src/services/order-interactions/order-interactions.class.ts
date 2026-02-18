import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type {
  OrderInteraction,
  OrderInteractionData,
  OrderInteractionPatch,
  OrderInteractionQuery
} from '@panary-core/order-interactions/domain'

export type { OrderInteraction, OrderInteractionData, OrderInteractionPatch, OrderInteractionQuery }

// Combined parameter type for SQL & NoSQL
export type OrderInteractionParams = KnexAdapterParams<OrderInteractionQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface OrderInteractionService
  extends ServiceInterface<
    OrderInteraction,
    OrderInteractionData,
    OrderInteractionParams,
    OrderInteractionPatch
  > {}
