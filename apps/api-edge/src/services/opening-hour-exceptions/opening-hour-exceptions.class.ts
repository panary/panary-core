import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

import type {
  OpeningHourException,
  OpeningHourExceptionData,
  OpeningHourExceptionPatch,
  OpeningHourExceptionQuery,
} from '@panary/opening-hour-exceptions/domain'

export type { OpeningHourException, OpeningHourExceptionData, OpeningHourExceptionPatch, OpeningHourExceptionQuery }

export type OpeningHourExceptionParams = KnexAdapterParams<OpeningHourExceptionQuery> & MongoDBAdapterParams & Params

export interface OpeningHourExceptionService
  extends ServiceInterface<
    OpeningHourException,
    OpeningHourExceptionData,
    OpeningHourExceptionParams,
    OpeningHourExceptionPatch
  > {}
