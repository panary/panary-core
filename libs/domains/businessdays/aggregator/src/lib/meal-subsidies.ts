import { Order } from '@panary/orders/domain'
import {
  isStaffMeal,
  isStaffMealPaid,
  isCorporateMeal,
  isCorporateMealPaid,
  isCancelled,
} from './classifications'
import { getOrderGrossCents } from './order-total'

/** Aggregat für Personalessen ODER Firmenkundenessen, je `paid` / `unpaid` geteilt. */
export interface MealSubsidyBreakdown {
  countPaid: number
  sumPaidCents: number
  countUnpaid: number
  sumUnpaidCents: number
}

export interface MealSubsidiesAggregate {
  staff: MealSubsidyBreakdown
  corporate: MealSubsidyBreakdown
}

const ZERO_BREAKDOWN = (): MealSubsidyBreakdown => ({
  countPaid: 0,
  sumPaidCents: 0,
  countUnpaid: 0,
  sumUnpaidCents: 0,
})

/**
 * Personalessen und Firmenkundenessen separat aggregieren — jeweils nach
 * "bereits abgerechnet" und "noch offen".
 *
 * Stornos werden ausgeschlossen (analog Dashboard `cancelledOrders`-Filter).
 * Refunds bleiben drin, weil ein erstattetes Personalessen weiterhin als
 * "offen" gezählt wird (der Refund landet in financials.refundsCents).
 */
export function aggregateMealSubsidies(orders: ReadonlyArray<Order>): MealSubsidiesAggregate {
  const staff = ZERO_BREAKDOWN()
  const corporate = ZERO_BREAKDOWN()

  for (const order of orders) {
    if (isCancelled(order)) continue

    if (isStaffMeal(order)) {
      const gross = getOrderGrossCents(order)
      if (isStaffMealPaid(order)) {
        staff.countPaid++
        staff.sumPaidCents += gross
      } else {
        staff.countUnpaid++
        staff.sumUnpaidCents += gross
      }
    }

    if (isCorporateMeal(order)) {
      const gross = getOrderGrossCents(order)
      if (isCorporateMealPaid(order)) {
        corporate.countPaid++
        corporate.sumPaidCents += gross
      } else {
        corporate.countUnpaid++
        corporate.sumUnpaidCents += gross
      }
    }
  }

  return { staff, corporate }
}
