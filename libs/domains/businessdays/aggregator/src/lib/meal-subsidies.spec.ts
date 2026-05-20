import { describe, it, expect } from 'vitest'
import { OrderStatus } from '@panary/orders/domain'
import { aggregateMealSubsidies } from './meal-subsidies'
import { makeOrder } from './fixtures/orders.fixtures'

describe('meal-subsidies', () => {
  it('aggregiert Personalessen bezahlt/unbezahlt', () => {
    const orders = [
      makeOrder({ grossAmount: 5, staffPaymentInfo: { paid: false } }),
      makeOrder({ grossAmount: 3, staffPaymentInfo: { paid: true } }),
      makeOrder({ grossAmount: 7, staffPaymentInfo: { paid: false } }),
      makeOrder({ grossAmount: 10 }), // regulärer Verkauf
    ]
    const r = aggregateMealSubsidies(orders)
    expect(r.staff.countPaid).toBe(1)
    expect(r.staff.sumPaidCents).toBe(300)
    expect(r.staff.countUnpaid).toBe(2)
    expect(r.staff.sumUnpaidCents).toBe(1200)
  })

  it('aggregiert Firmenkundenessen bezahlt/unbezahlt', () => {
    const orders = [
      makeOrder({ grossAmount: 15, customerPaymentInfo: { paid: false } }),
      makeOrder({ grossAmount: 12, customerPaymentInfo: { paid: true } }),
    ]
    const r = aggregateMealSubsidies(orders)
    expect(r.corporate.countPaid).toBe(1)
    expect(r.corporate.sumPaidCents).toBe(1200)
    expect(r.corporate.countUnpaid).toBe(1)
    expect(r.corporate.sumUnpaidCents).toBe(1500)
  })

  it('schließt Stornos aus', () => {
    const orders = [
      makeOrder({ grossAmount: 5, staffPaymentInfo: { paid: false }, status: OrderStatus.ABORTED }),
    ]
    const r = aggregateMealSubsidies(orders)
    expect(r.staff.countUnpaid).toBe(0)
  })
})
