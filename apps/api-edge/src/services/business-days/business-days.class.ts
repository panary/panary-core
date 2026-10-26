import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'

import type { BusinessDay, BusinessDayData, BusinessDayPatch, BusinessDayQuery } from '@panary/businessdays/domain'

export type { BusinessDay, BusinessDayData, BusinessDayPatch, BusinessDayQuery }

export type BusinessDayParams = KnexAdapterParams<BusinessDayQuery> & Params

// Custom-Method-Payloads (Edge-Trigger)
export interface OpenDayData {
  locationId?: string | null
  date?: string // YYYY-MM-DD (default heute)
  /** @deprecated Float gehört zur Kasse (cash-sessions), nicht zum Geschäftstag — wird beim Eröffnen ignoriert. */
  openingFloatCents?: number
}

export interface CloseDayData {
  businessDayId: string
  countedClosingFloatCents?: number
  cashDropsCents?: number
  payoutsCents?: number
  physicalCounts?: Record<string, number>
}

export interface RefreshClosingStatusData {
  businessDayId: string
}

export interface DiscardOrphanDayData {
  businessDayId: string
}

/** Freigabe eines Verkaufs am Ruhetag (panary/panary-core#1133, ADR 0062). */
export interface ApproveClosedDayData {
  /** Mitarbeiter, dessen PIN die Freigabe erteilt (Manager/Inhaber je nach Ruhetag-Regel). */
  authorizedByUserId: string
  pin: string
  locationId?: string | null
}

export interface ApproveClosedDayResult {
  /** `false`, wenn heute laut Öffnungszeiten gar kein Ruhetag ist — dann ist nichts freizugeben. */
  approved: boolean
  businessDayId: string | null
  date: string
  policy: 'manager-approval' | 'block'
  role?: string
}

export interface BusinessDayService extends ServiceInterface<
  BusinessDay,
  BusinessDayData,
  BusinessDayParams,
  BusinessDayPatch
> {
  openDay(data: OpenDayData, params?: BusinessDayParams): Promise<BusinessDay>
  closeDay(data: CloseDayData, params?: BusinessDayParams): Promise<BusinessDay>
  refreshClosingStatus(data: RefreshClosingStatusData, params?: BusinessDayParams): Promise<BusinessDay>
  discardOrphanDay(data: DiscardOrphanDayData, params?: BusinessDayParams): Promise<{ discarded: true; _id: string }>
  approveClosedDay(data: ApproveClosedDayData, params?: BusinessDayParams): Promise<ApproveClosedDayResult>
}
