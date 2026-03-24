import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type {
  WorkingTime,
  WorkingTimeData,
  WorkingTimePatch,
  WorkingTimeQuery
} from '@panary-core/working-times/domain'

export type { WorkingTime, WorkingTimeData, WorkingTimePatch, WorkingTimeQuery }

// Combined parameter type for SQL & NoSQL
export type WorkingTimeParams = KnexAdapterParams<WorkingTimeQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface WorkingTimeService
  extends ServiceInterface<
    WorkingTime,
    WorkingTimeData,
    WorkingTimeParams,
    WorkingTimePatch
  > {}
