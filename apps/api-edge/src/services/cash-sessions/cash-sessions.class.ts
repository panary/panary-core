import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

import type {
  CashSession,
  CashSessionData,
  CashSessionPatch,
  CashSessionQuery,
} from '@panary/businessdays/domain'

export type { CashSession, CashSessionData, CashSessionPatch, CashSessionQuery }

export type CashSessionParams = KnexAdapterParams<CashSessionQuery> & MongoDBAdapterParams & Params

export type CashSessionService = ServiceInterface<CashSession, CashSessionData, CashSessionParams, CashSessionPatch>
