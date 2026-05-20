import { describe, it, expect } from 'vitest'
import { OrderStatus } from '@panary/orders/domain'
import { aggregateCancellations } from './cancellations'
import { makeOrder } from './fixtures/orders.fixtures'

describe('cancellations', () => {
  it('zählt ABORTED-Orders + Bons mit cancellation-Feld', () => {
    const orders = [
      makeOrder({ grossAmount: 10, status: OrderStatus.ABORTED }),
      makeOrder({ grossAmount: 5, cancellation: true }),
      makeOrder({ grossAmount: 7 }),
    ]
    const r = aggregateCancellations(orders)
    expect(r.count).toBe(2)
    expect(r.sumCents).toBe(1500)
  })

  it('leere Order-Liste liefert ZERO', () => {
    const r = aggregateCancellations([])
    expect(r.count).toBe(0)
    expect(r.sumCents).toBe(0)
  })
})
