import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'

import type {
  BusinessDay,
  BusinessDayData,
  BusinessDayPatch,
  BusinessDayQuery,
} from '@panary/businessdays/domain'

export type { BusinessDay, BusinessDayData, BusinessDayPatch, BusinessDayQuery }

export type BusinessDayParams = KnexAdapterParams<BusinessDayQuery> & Params

// Custom-Method-Payloads (Edge-Trigger)
export interface OpenDayData {
  locationId?: string | null
  date?: string                  // YYYY-MM-DD (default heute)
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

export interface BusinessDayService
  extends ServiceInterface<BusinessDay, BusinessDayData, BusinessDayParams, BusinessDayPatch> {
  openDay(data: OpenDayData, params?: BusinessDayParams): Promise<BusinessDay>
  closeDay(data: CloseDayData, params?: BusinessDayParams): Promise<BusinessDay>
  refreshClosingStatus(data: RefreshClosingStatusData, params?: BusinessDayParams): Promise<BusinessDay>
}
