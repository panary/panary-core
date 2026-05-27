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

/** Payload für die manager-autorisierte Kassen-Eröffnung am POS. */
export interface CashSessionAuthorizedOpenData {
  businessDayId: string
  /** Kassierer, FÜR den die Kasse eröffnet wird (nicht der autorisierende Manager). */
  openedBy: string
  openingFloatCents: number
  label: string
  /** Berechtigter Mitarbeiter (Manager/Inhaber), der per PIN autorisiert. */
  authorizedByUserId: string
  pin: string
}

export type CashSessionService = ServiceInterface<
  CashSession,
  CashSessionData,
  CashSessionParams,
  CashSessionPatch
> & {
  openAuthorized(data: CashSessionAuthorizedOpenData, params?: CashSessionParams): Promise<CashSession>
}
