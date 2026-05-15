import { describe, it, expect } from 'vitest'
import { OrderStatus, PaymentState } from '@panary-core/orders/domain'
import {
  isStaffMeal,
  isStaffMealPaid,
  isCorporateMeal,
  isCorporateMealPaid,
  isCancelled,
  isRefunded,
  isRegularSale,
} from './classifications'
import { makeOrder } from './fixtures/orders.fixtures'

describe('classifications', () => {
  it('isStaffMeal erkennt Personalessen-Marker', () => {
    expect(isStaffMeal(makeOrder())).toBe(false)
    expect(isStaffMeal(makeOrder({ staffPaymentInfo: { paid: false } }))).toBe(true)
    expect(isStaffMeal(makeOrder({ staffPaymentInfo: { paid: true } }))).toBe(true)
  })

  it('isCorporateMeal erkennt Firmenkundenessen-Marker', () => {
    expect(isCorporateMeal(makeOrder())).toBe(false)
    expect(isCorporateMeal(makeOrder({ customerPaymentInfo: { paid: false } }))).toBe(true)
  })

  it('isStaffMealPaid unterscheidet bezahlt/unbezahlt', () => {
    expect(isStaffMealPaid(makeOrder({ staffPaymentInfo: { paid: true } }))).toBe(true)
    expect(isStaffMealPaid(makeOrder({ staffPaymentInfo: { paid: false } }))).toBe(false)
    expect(isStaffMealPaid(makeOrder())).toBe(false)
  })

  it('isCorporateMealPaid unterscheidet bezahlt/unbezahlt', () => {
    expect(isCorporateMealPaid(makeOrder({ customerPaymentInfo: { paid: true } }))).toBe(true)
    expect(isCorporateMealPaid(makeOrder({ customerPaymentInfo: { paid: false } }))).toBe(false)
  })

  it('isCancelled erkennt ABORTED-Status', () => {
    expect(isCancelled(makeOrder({ status: OrderStatus.ABORTED }))).toBe(true)
    expect(isCancelled(makeOrder({ status: OrderStatus.COMPLETED }))).toBe(false)
  })

  it('isCancelled erkennt cancellation-Feld', () => {
    expect(isCancelled(makeOrder({ cancellation: true }))).toBe(true)
  })

  it('isRefunded liest payment.state', () => {
    expect(isRefunded(makeOrder({ paymentState: PaymentState.REFUNDED }))).toBe(true)
    expect(isRefunded(makeOrder({ paymentState: PaymentState.PAID }))).toBe(false)
  })

  it('isRegularSale ist konjunktion der Ausschlüsse', () => {
    expect(isRegularSale(makeOrder())).toBe(true)
    expect(isRegularSale(makeOrder({ staffPaymentInfo: { paid: false } }))).toBe(false)
    expect(isRegularSale(makeOrder({ customerPaymentInfo: { paid: false } }))).toBe(false)
    expect(isRegularSale(makeOrder({ status: OrderStatus.ABORTED }))).toBe(false)
    expect(isRegularSale(makeOrder({ paymentState: PaymentState.REFUNDED }))).toBe(false)
  })
})
