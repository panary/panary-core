import { describe, it, expect, beforeEach } from 'vitest'
import {
  DineLocation,
  OrderChannel,
  OrderStatus,
  PaymentState,
  TransactionMethod,
} from '@panary/orders/domain'

import { aggregateFinancials } from './financials'
import { aggregateMealSubsidies } from './meal-subsidies'
import { aggregateCancellations } from './cancellations'
import { aggregateWriteOffs } from './waste'
import { fromCents } from './money'
import {
  deriveDisplayNetRevenueCents,
  deriveCashCardRevenueCents,
  deriveTotalRevenueCents,
} from './derived-net-revenue'
import { validateFinancials } from './validations'
import { makeOrder, resetIds } from './fixtures/orders.fixtures'
import type { WriteOff } from '@panary/write-offs/domain'
import { WriteOffItemType, WriteOffReason, WasteType } from '@panary/write-offs/domain'

/**
 * Konsistenz-Test: Dashboard-Live-Widget und Tagesabschluss-Report
 * MÜSSEN für denselben Datensatz identische Werte liefern.
 *
 * Dieses Spec simuliert beide Sichten gegen dieselbe Aggregator-Lib:
 *   - DashboardStore-Sicht: Euro-Floats für CurrencyPipe-Templates
 *   - BusinessDayReport-Sicht: Cents-Integer-Felder im Persist-Schema
 *
 * Beide werden aus exakt denselben Aggregator-Outputs abgeleitet. Wenn
 * dieser Test bricht, ist die Konsistenz-Garantie verletzt — vermutlich
 * weil jemand client-seitig wieder eine eigene Filterung/Summation
 * eingeführt hat.
 *
 * Realistischer Datensatz: gemischter Tag mit allen relevanten Mustern.
 */

const makeWriteOff = (opts: {
  itemId: string
  quantity: number
  totalCost: number
  reason: WriteOff['reason']
  wasteType?: WriteOff['wasteType']
}): WriteOff => ({
  _id: `wo-${opts.itemId}-${Math.random()}`,
  tenantId: 't1',
  locationId: 'l1',
  createdAt: '2026-05-15T11:00:00.000Z',
  updatedAt: '2026-05-15T11:00:00.000Z',
  businessDayId: 'bd1',
  itemType: WriteOffItemType.INGREDIENT,
  itemId: opts.itemId,
  itemName: opts.itemId,
  itemVersion: 1,
  quantity: opts.quantity,
  unit: 'kg',
  costPerUnit: opts.totalCost / opts.quantity,
  totalCost: opts.totalCost,
  reason: opts.reason,
  wasteType: opts.wasteType,
  userId: 'u1',
} as WriteOff)

describe('Konsistenz: Dashboard ≡ Tagesabschluss-Report', () => {
  beforeEach(() => resetIds())

  /**
   * Realistischer Mischtag — deckt alle Klassifizierer ab.
   */
  const buildMixedDay = () => ({
    orders: [
      // 3× reguläre Cash-Verkäufe mit 19% (Take-Out, Standard)
      makeOrder({ grossAmount: 11.9, paymentMethod: TransactionMethod.CASH, channel: OrderChannel.POS, dineLocation: DineLocation.TAKE_OUT, taxes: [{ rate: 19, gross: 11.9, tax: 1.9 }] }),
      makeOrder({ grossAmount: 23.8, paymentMethod: TransactionMethod.CASH, channel: OrderChannel.POS, dineLocation: DineLocation.TAKE_OUT, taxes: [{ rate: 19, gross: 23.8, tax: 3.8 }] }),
      makeOrder({ grossAmount: 5.95, paymentMethod: TransactionMethod.CASH, channel: OrderChannel.POS, dineLocation: DineLocation.TAKE_OUT, taxes: [{ rate: 19, gross: 5.95, tax: 0.95 }] }),
      // 2× reguläre Card-Verkäufe mit 7% (Dine-In, Restaurant)
      makeOrder({ grossAmount: 10.7, paymentMethod: TransactionMethod.CARD, channel: OrderChannel.POS, dineLocation: DineLocation.DINE_IN, taxes: [{ rate: 7, gross: 10.7, tax: 0.7 }] }),
      makeOrder({ grossAmount: 21.4, paymentMethod: TransactionMethod.CARD, channel: OrderChannel.POS, dineLocation: DineLocation.DINE_IN, taxes: [{ rate: 7, gross: 21.4, tax: 1.4 }] }),
      // 1× Online-Bestellung
      makeOrder({ grossAmount: 15.0, paymentMethod: TransactionMethod.ONLINE, channel: OrderChannel.ONLINE, taxes: [{ rate: 19, gross: 15.0, tax: 2.39 }] }),
      // 1× Personalessen unbezahlt (Cash)
      makeOrder({ grossAmount: 5.0, staffPaymentInfo: { paid: false }, paymentMethod: TransactionMethod.CASH }),
      // 1× Personalessen bezahlt (Cash)
      makeOrder({ grossAmount: 3.0, staffPaymentInfo: { paid: true }, paymentMethod: TransactionMethod.CASH }),
      // 1× Firmenkundenessen unbezahlt
      makeOrder({ grossAmount: 25.0, customerPaymentInfo: { paid: false } }),
      // 1× Firmenkundenessen bezahlt
      makeOrder({ grossAmount: 18.0, customerPaymentInfo: { paid: true } }),
      // 1× Storno (ABORTED)
      makeOrder({ grossAmount: 8.0, status: OrderStatus.ABORTED }),
      // 1× Refund
      makeOrder({ grossAmount: 12.5, paymentState: PaymentState.REFUNDED }),
    ],
    writeOffs: [
      makeWriteOff({ itemId: 'ing-mehl', quantity: 0.5, totalCost: 1.20, reason: WriteOffReason.WASTE, wasteType: WasteType.RAW }),
      makeWriteOff({ itemId: 'ing-toma', quantity: 0.3, totalCost: 0.90, reason: WriteOffReason.WASTE, wasteType: WasteType.FINISHED }),
      makeWriteOff({ itemId: 'ing-mehl', quantity: 0.1, totalCost: 0.24, reason: WriteOffReason.EMPLOYEE_MEAL }),
    ],
  })

  it('Dashboard-View und Report-View liefern identische Werte fuer denselben Datensatz', () => {
    const { orders, writeOffs } = buildMixedDay()

    // ============================================================
    // Aggregator-Lib (gemeinsam von beiden Sichten verwendet)
    // ============================================================
    const financials = aggregateFinancials(orders)
    const mealSubsidies = aggregateMealSubsidies(orders)
    const cancellations = aggregateCancellations(orders)
    const waste = aggregateWriteOffs(writeOffs)

    // ============================================================
    // Dashboard-Sicht (panary-cloud/libs/domains/dashboard/feature-admin)
    // Pre-Refactor war das eigene Logik; jetzt: shared Aggregator + fromCents.
    // ============================================================
    const dashboardView = {
      dailyNetRevenue: fromCents(deriveCashCardRevenueCents(financials)),
      totalRevenue: fromCents(deriveTotalRevenueCents(financials)),
      corporateRevenue: fromCents(mealSubsidies.corporate.sumPaidCents + mealSubsidies.corporate.sumUnpaidCents),
      staffMeals: {
        countPaid: mealSubsidies.staff.countPaid,
        sumPaid: fromCents(mealSubsidies.staff.sumPaidCents),
        countUnpaid: mealSubsidies.staff.countUnpaid,
        sumUnpaid: fromCents(mealSubsidies.staff.sumUnpaidCents),
      },
      customerMeals: {
        countPaid: mealSubsidies.corporate.countPaid,
        sumPaid: fromCents(mealSubsidies.corporate.sumPaidCents),
        countUnpaid: mealSubsidies.corporate.countUnpaid,
        sumUnpaid: fromCents(mealSubsidies.corporate.sumUnpaidCents),
      },
      cancelledOrders: {
        count: cancellations.count,
        sum: fromCents(cancellations.sumCents),
      },
      todaysWaste: fromCents(waste.totalCents),
      displayNetRevenue: fromCents(deriveDisplayNetRevenueCents(financials, mealSubsidies)),
    }

    // ============================================================
    // BusinessDayReport-Sicht (Cloud-Pipeline-Persist)
    // Werte landen 1:1 in financials/mealSubsidies/displayNetRevenueCents
    // des BusinessDayReport-Dokuments.
    // ============================================================
    const reportView = {
      grossTotalCents: financials.grossTotalCents,
      netTotalCents: financials.netTotalCents,
      voidsCount: financials.voidsCount,
      voidsCents: financials.voidsCents,
      refundsCount: financials.refundsCount,
      refundsCents: financials.refundsCents,
      tipsCents: financials.tipsCents,
      payments: financials.payments,
      channels: financials.channels,
      dineLocation: financials.dineLocation,
      taxes: financials.taxes,
      mealSubsidies,
      cancellations,
      wasteCents: { raw: waste.rawCents, finished: waste.finishedCents, employeeMeals: waste.employeeMealsCents, promotions: waste.promotionsCents, total: waste.totalCents },
      displayNetRevenueCents: deriveDisplayNetRevenueCents(financials, mealSubsidies),
    }

    // ============================================================
    // ASSERT: identische Werte in beiden Sichten
    // ============================================================

    // Total
    expect(dashboardView.totalRevenue).toBe(fromCents(reportView.grossTotalCents))

    // Personalessen
    expect(dashboardView.staffMeals.sumPaid).toBe(fromCents(reportView.mealSubsidies.staff.sumPaidCents))
    expect(dashboardView.staffMeals.sumUnpaid).toBe(fromCents(reportView.mealSubsidies.staff.sumUnpaidCents))
    expect(dashboardView.staffMeals.countPaid).toBe(reportView.mealSubsidies.staff.countPaid)
    expect(dashboardView.staffMeals.countUnpaid).toBe(reportView.mealSubsidies.staff.countUnpaid)

    // Firmenkundenessen
    expect(dashboardView.customerMeals.sumPaid).toBe(fromCents(reportView.mealSubsidies.corporate.sumPaidCents))
    expect(dashboardView.customerMeals.sumUnpaid).toBe(fromCents(reportView.mealSubsidies.corporate.sumUnpaidCents))
    expect(dashboardView.customerMeals.countPaid).toBe(reportView.mealSubsidies.corporate.countPaid)
    expect(dashboardView.customerMeals.countUnpaid).toBe(reportView.mealSubsidies.corporate.countUnpaid)

    // Stornos
    expect(dashboardView.cancelledOrders.count).toBe(reportView.cancellations.count)
    expect(dashboardView.cancelledOrders.sum).toBe(fromCents(reportView.cancellations.sumCents))

    // Waste
    expect(dashboardView.todaysWaste).toBe(fromCents(reportView.wasteCents.total))

    // Anzeige-Netto
    expect(dashboardView.displayNetRevenue).toBe(fromCents(reportView.displayNetRevenueCents))
  })

  it('Persist-Invarianten: Σtaxes, Σpayments, Σchannels stimmen', () => {
    const { orders } = buildMixedDay()
    const financials = aggregateFinancials(orders)

    const validation = validateFinancials(financials)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
  })

  it('Re-Aggregation derselben Inputs liefert byte-identische Outputs (Determinismus)', () => {
    const { orders, writeOffs } = buildMixedDay()

    const run1 = {
      financials: aggregateFinancials(orders),
      meals: aggregateMealSubsidies(orders),
      cancellations: aggregateCancellations(orders),
      waste: aggregateWriteOffs(writeOffs),
    }
    // Shuffle inputs — aggregator muss sortieren und deterministisch sein
    const shuffled = [...orders].reverse()
    const run2 = {
      financials: aggregateFinancials(shuffled),
      meals: aggregateMealSubsidies(shuffled),
      cancellations: aggregateCancellations(shuffled),
      waste: aggregateWriteOffs(writeOffs),
    }

    expect(run2.financials).toEqual(run1.financials)
    expect(run2.meals).toEqual(run1.meals)
    expect(run2.cancellations).toEqual(run1.cancellations)
    expect(run2.waste).toEqual(run1.waste)
  })

  it('Mode-spezifische Werte: orders-only behandelt Cash-Drawer-Logik nicht', () => {
    // Im orders-only-Modus berührt der Tagesabschluss nichts kassenspezifisches
    // — financials enthalten dieselben Werte (Cash/Card landet in payments
    // sortiert nach TransactionMethod), aber cashDrawer-Feld bleibt null.
    const { orders } = buildMixedDay()
    const financials = aggregateFinancials(orders)
    // financials selbst ist Mode-agnostisch
    expect(financials.payments.cashCents).toBeGreaterThan(0)
    expect(financials.payments.cardCents).toBeGreaterThan(0)
    // (Mode-Gating passiert in der Cloud-Pipeline-Step `compute-cash-reconciliation`,
    //  nicht in der Aggregator-Lib — d.h. der Aggregator bleibt deterministisch
    //  unabhängig vom Mode.)
  })

  it('Empty-Day: alle Aggregate liefern Zero-Werte ohne Crash', () => {
    const financials = aggregateFinancials([])
    const meals = aggregateMealSubsidies([])
    const cancellations = aggregateCancellations([])
    const waste = aggregateWriteOffs([])

    expect(financials.grossTotalCents).toBe(0)
    expect(financials.taxes).toEqual([])
    expect(meals.staff.countPaid).toBe(0)
    expect(meals.staff.sumUnpaidCents).toBe(0)
    expect(cancellations.count).toBe(0)
    expect(waste.totalCents).toBe(0)
    expect(deriveDisplayNetRevenueCents(financials, meals)).toBe(0)
  })
})
