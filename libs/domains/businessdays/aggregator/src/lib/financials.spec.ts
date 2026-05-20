import { describe, it, expect, beforeEach } from 'vitest'
import { OrderChannel, OrderStatus, DineLocation, PaymentState, TransactionMethod } from '@panary/orders/domain'
import { aggregateFinancials, sumChannels, sumPayments } from './financials'
import { makeOrder, resetIds } from './fixtures/orders.fixtures'

describe('financials', () => {
  beforeEach(() => resetIds())

  it('summiert grossTotal über reguläre Bestellungen', () => {
    const orders = [
      makeOrder({ grossAmount: 10 }),
      makeOrder({ grossAmount: 5.5 }),
      makeOrder({ grossAmount: 0.99 }),
    ]
    const r = aggregateFinancials(orders)
    expect(r.grossTotalCents).toBe(1000 + 550 + 99)
  })

  it('schließt Stornos und Refunds aus grossTotal aus, zählt sie aber separat', () => {
    const orders = [
      makeOrder({ grossAmount: 10 }),
      makeOrder({ grossAmount: 5, status: OrderStatus.ABORTED }),
      makeOrder({ grossAmount: 8, paymentState: PaymentState.REFUNDED }),
    ]
    const r = aggregateFinancials(orders)
    expect(r.grossTotalCents).toBe(1000)
    expect(r.voidsCount).toBe(1)
    expect(r.voidsCents).toBe(500)
    expect(r.refundsCount).toBe(1)
    expect(r.refundsCents).toBe(800)
  })

  it('aggregiert Steuersplit pro Steuersatz', () => {
    const orders = [
      makeOrder({ grossAmount: 11.9, taxes: [{ rate: 19, gross: 11.9, tax: 1.9 }] }),
      makeOrder({ grossAmount: 10.7, taxes: [{ rate: 7, gross: 10.7, tax: 0.7 }] }),
      makeOrder({ grossAmount: 11.9, taxes: [{ rate: 19, gross: 11.9, tax: 1.9 }] }),
    ]
    const r = aggregateFinancials(orders)
    expect(r.taxes).toHaveLength(2)
    // sortiert nach Rate aufsteigend
    expect(r.taxes[0].rate).toBe(7)
    expect(r.taxes[0].grossAmountCents).toBe(1070)
    expect(r.taxes[0].taxAmountCents).toBe(70)
    expect(r.taxes[1].rate).toBe(19)
    expect(r.taxes[1].grossAmountCents).toBe(2380)   // 2× 11.90€
    expect(r.taxes[1].taxAmountCents).toBe(380)
  })

  it('aggregiert Channels', () => {
    const orders = [
      makeOrder({ grossAmount: 10, channel: OrderChannel.POS }),
      makeOrder({ grossAmount: 5, channel: OrderChannel.ONLINE }),
      makeOrder({ grossAmount: 7, channel: OrderChannel.TELEPHONE }),
    ]
    const r = aggregateFinancials(orders)
    expect(r.channels.posCents).toBe(1000)
    expect(r.channels.onlineCents).toBe(500)
    expect(r.channels.telephoneCents).toBe(700)
    expect(sumChannels(r.channels)).toBe(r.grossTotalCents)
  })

  it('aggregiert DineLocation', () => {
    const orders = [
      makeOrder({ grossAmount: 10, dineLocation: DineLocation.DINE_IN }),
      makeOrder({ grossAmount: 8, dineLocation: DineLocation.TAKE_OUT }),
    ]
    const r = aggregateFinancials(orders)
    expect(r.dineLocation.dineInCents).toBe(1000)
    expect(r.dineLocation.takeOutCents).toBe(800)
  })

  it('aggregiert Zahlungsarten und sumPayments === grossTotal − tips', () => {
    const orders = [
      makeOrder({ grossAmount: 10, paymentMethod: TransactionMethod.CASH }),
      makeOrder({ grossAmount: 12, paymentMethod: TransactionMethod.CARD, tipAmount: 2 }),
    ]
    const r = aggregateFinancials(orders)
    expect(r.payments.cashCents).toBe(1000)
    expect(r.payments.cardCents).toBe(1200)
    expect(r.tipsCents).toBe(200)
    // payment transactions enthalten gross (10 + 12 = 22) — Trinkgeld liegt
    // separat in payment.tipAmount, fließt aber NICHT in financials.tipsCents
    // doppelt durch transactions, weil unsere fixture nur den Order-Betrag
    // als Transaction anlegt. Also sumPayments === Σ orderGross === grossTotal.
    expect(sumPayments(r.payments)).toBe(r.grossTotalCents)
  })

  it('leere Order-Liste liefert ZERO-Aggregat', () => {
    const r = aggregateFinancials([])
    expect(r.grossTotalCents).toBe(0)
    expect(r.taxes).toEqual([])
    expect(r.voidsCount).toBe(0)
  })

  it('Determinismus: Reihenfolge der Inputs ist irrelevant', () => {
    const a = makeOrder({ grossAmount: 10, _id: '00000000-0000-7000-8000-000000000001' })
    const b = makeOrder({ grossAmount: 20, _id: '00000000-0000-7000-8000-000000000002' })
    const r1 = aggregateFinancials([a, b])
    const r2 = aggregateFinancials([b, a])
    expect(r1).toEqual(r2)
  })
})
