import '@angular/compiler'
import { Injector, runInInjectionContext } from '@angular/core'
import { OrderStatus, PaymentState, TransactionMethod } from '@panary/orders/domain'
import { describe, expect, it, vi } from 'vitest'
import { buildCashPayment, isCashSessionRequired, OrderCheckoutService } from './order-checkout.service'
import { OrderService } from './order.service'

const CASH_SESSION_ERROR = { data: { code: 'BD_6004' } }

/** Je Test ein eigener Aufbau (testing.md §10): die Aufrufe landen im Test, nicht im describe-Scope. */
function setup(patchResults: Array<'ok' | unknown>) {
  const calls: Array<{ id: unknown; data: Record<string, any> }> = []
  const results = [...patchResults]
  const patch = vi.fn(async (id: unknown, data: Record<string, any>) => {
    calls.push({ id, data })
    const next = results.shift()
    if (next === 'ok' || next === undefined) return {}
    throw next
  })
  const injector = Injector.create({ providers: [{ provide: OrderService, useValue: { patch } }] })
  const service = runInInjectionContext(injector, () => new OrderCheckoutService())
  return { service, calls, patch }
}

const input = (requestCashSession = vi.fn().mockResolvedValue(true)) => ({
  orderId: 'o-1',
  total: 12.5,
  cashierId: 'u-1',
  requestCashSession,
})

describe('OrderCheckoutService.payCash — Verhalten wie finalizeOrder vorher', () => {
  it('patcht Payment und Status COMPLETED in einem Aufruf', async () => {
    const { service, calls } = setup(['ok'])

    await expect(service.payCash(input())).resolves.toBe('paid')

    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('o-1')
    expect(calls[0].data['status']).toBe(OrderStatus.COMPLETED)
    expect(calls[0].data['payment']).toMatchObject({ state: PaymentState.PAID, totalAmount: 12.5, tipAmount: 0 })
  })

  it('bucht eine Bar-Transaktion über die ganze Summe mit dem Kassierer als performedBy', async () => {
    const { service, calls } = setup(['ok'])
    await service.payCash(input())

    const [transaction, ...rest] = calls[0].data['payment'].transactions
    expect(rest).toEqual([])
    expect(transaction).toMatchObject({
      method: TransactionMethod.CASH,
      amount: 12.5,
      currency: 'EUR',
      performedBy: 'u-1',
    })
    expect(transaction._id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('fragt bei BD_6004 die Kassen-Freigabe an und wiederholt den Abschluss mit derselben Zahlung', async () => {
    const { service, calls } = setup([CASH_SESSION_ERROR, 'ok'])
    const requestCashSession = vi.fn().mockResolvedValue(true)

    await expect(service.payCash(input(requestCashSession))).resolves.toBe('paid')

    expect(requestCashSession).toHaveBeenCalledExactlyOnceWith('u-1')
    expect(calls).toHaveLength(2)
    expect(calls[1].data).toBe(calls[0].data)
  })

  it('wiederholt nicht, wenn die Freigabe ausbleibt', async () => {
    const { service, calls } = setup([CASH_SESSION_ERROR, 'ok'])

    await expect(service.payCash(input(vi.fn().mockResolvedValue(false)))).resolves.toBe('cash-session-declined')

    expect(calls).toHaveLength(1)
  })

  it('fragt bei anderen Fehlern keine Freigabe an', async () => {
    const { service, calls } = setup([new Error('offline')])
    const requestCashSession = vi.fn().mockResolvedValue(true)

    await expect(service.payCash(input(requestCashSession))).resolves.toBe('failed')

    expect(requestCashSession).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  it('meldet failed, wenn auch die Wiederholung nach der Freigabe scheitert, und versucht es nicht ein drittes Mal', async () => {
    const { service, calls } = setup([CASH_SESSION_ERROR, new Error('wieder')])

    await expect(service.payCash(input())).resolves.toBe('failed')

    expect(calls).toHaveLength(2)
  })
})

describe('isCashSessionRequired / buildCashPayment', () => {
  it('erkennt BD_6004 am Fehler selbst und in data', () => {
    expect(isCashSessionRequired({ code: 'BD_6004' })).toBe(true)
    expect(isCashSessionRequired(CASH_SESSION_ERROR)).toBe(true)
    expect(isCashSessionRequired({ code: 'BD_6005' })).toBe(false)
    expect(isCashSessionRequired(undefined)).toBe(false)
  })

  it('stempelt den übergebenen Zeitpunkt', () => {
    const payment = buildCashPayment(3, 'u-9', new Date('2026-10-22T10:00:00.000Z'))
    expect(payment.transactions[0].timestamp).toBe('2026-10-22T10:00:00.000Z')
  })
})
