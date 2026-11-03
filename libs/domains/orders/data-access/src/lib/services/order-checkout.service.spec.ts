import '@angular/compiler'
import { Injector, runInInjectionContext } from '@angular/core'
import { OrderStatus, PaymentState, TransactionMethod } from '@panary/orders/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCashPayment, isCashSessionRequired, OrderCheckoutService, PAY_TIMEOUT_MS } from './order-checkout.service'
import { OrderService } from './order.service'

const CASH_SESSION_ERROR = { data: { code: 'BD_6004' } }

/** Je Test ein eigener Aufbau (testing.md §10): die Aufrufe landen im Test, nicht im describe-Scope. */
function setup(patchResults: Array<'ok' | unknown>) {
  const calls: Array<{ id: unknown; data: Record<string, any> }> = []
  const results = [...patchResults]
  const patch = vi.fn(async (id: unknown, data: Record<string, any>, _params?: unknown) => {
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

  it('meldet BD_6004 beim ersten Versuch nicht als Fehler — der Freigabe-Dialog erklärt die Lage (core#1091)', async () => {
    const { service, patch } = setup([CASH_SESSION_ERROR, 'ok'])

    await service.payCash(input())

    const params = patch.mock.calls[0][2] as { isExpectedError?: (err: unknown) => boolean } | undefined
    expect(params?.isExpectedError?.(CASH_SESSION_ERROR)).toBe(true)
    expect(params?.isExpectedError?.({ data: { code: 'BD_6005' } })).toBe(false)
    expect(params?.isExpectedError?.(new Error('offline'))).toBe(false)
  })

  it('meldet bei der Wiederholung nach der Freigabe jeden Fehler, auch BD_6004 (core#1091)', async () => {
    const { service, patch } = setup([CASH_SESSION_ERROR, 'ok'])

    await service.payCash(input())

    expect(patch).toHaveBeenCalledTimes(2)
    expect(patch.mock.calls[1][2]).toBeUndefined()
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

describe('OrderCheckoutService.payCash — Ruhetag (#1133)', () => {
  const CLOSED_DAY_ERROR = { data: { code: 'BD_6010', date: '2026-10-26', policy: 'manager-approval' } }

  it('fragt bei BD_6010 die Ruhetag-Freigabe mit dem Fehler an und wiederholt', async () => {
    const { service, calls } = setup([CLOSED_DAY_ERROR, 'ok'])
    const requestClosedDayApproval = vi.fn().mockResolvedValue(true)

    await expect(service.payCash({ ...input(), requestClosedDayApproval })).resolves.toBe('paid')

    expect(requestClosedDayApproval).toHaveBeenCalledExactlyOnceWith(CLOSED_DAY_ERROR)
    expect(calls).toHaveLength(2)
    expect(calls[1].data).toBe(calls[0].data)
  })

  it('erwartet BD_6010 beim ersten Versuch still, danach meldet die Wiederholung wieder alles', async () => {
    const { service, patch } = setup([CLOSED_DAY_ERROR, 'ok'])

    await service.payCash({ ...input(), requestClosedDayApproval: vi.fn().mockResolvedValue(true) })

    const first = patch.mock.calls[0][2] as { isExpectedError: (err: unknown) => boolean }
    expect(first.isExpectedError(CLOSED_DAY_ERROR)).toBe(true)
    const second = patch.mock.calls[1][2] as { isExpectedError: (err: unknown) => boolean }
    expect(second.isExpectedError(CLOSED_DAY_ERROR)).toBe(false)
  })

  it('verlangt nach der Ruhetag-Freigabe noch die Kasse, wenn der Server sie meldet', async () => {
    const { service, calls } = setup([CLOSED_DAY_ERROR, CASH_SESSION_ERROR, 'ok'])
    const requestClosedDayApproval = vi.fn().mockResolvedValue(true)
    const requestCashSession = vi.fn().mockResolvedValue(true)

    await expect(service.payCash({ ...input(requestCashSession), requestClosedDayApproval })).resolves.toBe('paid')

    expect(requestClosedDayApproval).toHaveBeenCalledTimes(1)
    expect(requestCashSession).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(3)
  })

  it('bricht ab, wenn nicht freigegeben wird', async () => {
    const { service, calls } = setup([CLOSED_DAY_ERROR, 'ok'])

    await expect(
      service.payCash({ ...input(), requestClosedDayApproval: vi.fn().mockResolvedValue(false) }),
    ).resolves.toBe('closed-day-declined')
    expect(calls).toHaveLength(1)
  })

  it('behandelt BD_6010 ohne Rückfrage als gewöhnlichen Fehler', async () => {
    const { service, patch } = setup([CLOSED_DAY_ERROR])

    await expect(service.payCash(input())).resolves.toBe('failed')
    const params = patch.mock.calls[0][2] as { isExpectedError: (err: unknown) => boolean }
    expect(params.isExpectedError(CLOSED_DAY_ERROR)).toBe(false)
  })
})

/** Je Test ein eigener Aufbau: Status je Bestellung für `get`, Ergebnisse je `patch` der Reihe nach. */
function setupCircle(statuses: Record<string, string | Error>, patchResults: Array<'ok' | unknown> = []) {
  const patched: Array<{ id: unknown; data: Record<string, any> }> = []
  const read: unknown[] = []
  const results = [...patchResults]
  const patch = vi.fn(async (id: unknown, data: Record<string, any>) => {
    patched.push({ id, data })
    const next = results.shift()
    if (next === 'ok' || next === undefined) return {}
    throw next
  })
  const get = vi.fn(async (id: string) => {
    read.push(id)
    const status = statuses[id]
    if (status instanceof Error) throw status
    return { _id: id, status }
  })
  const injector = Injector.create({ providers: [{ provide: OrderService, useValue: { patch, get } }] })
  const service = runInInjectionContext(injector, () => new OrderCheckoutService())
  return { service, patched, read }
}

const circleInput = (requestCashSession = vi.fn().mockResolvedValue(true)) => ({
  orders: [
    { orderId: 'o-1', total: 12.5 },
    { orderId: 'o-2', total: 3.1 },
  ],
  cashierId: 'u-1',
  requestCashSession,
})

describe('OrderCheckoutService.payCashCircle — Tisch kassieren (core#1142)', () => {
  it('kassiert jede Bestellung des Kreises mit ihrem eigenen Betrag, der Reihe nach', async () => {
    const { service, patched } = setupCircle({ 'o-1': 'active', 'o-2': 'produced' })

    const outcome = await service.payCashCircle(circleInput())

    expect(outcome).toEqual({ result: 'paid', paid: ['o-1', 'o-2'], skipped: [], remaining: [] })
    expect(patched.map(c => [c.id, c.data['status'], c.data['payment'].totalAmount])).toEqual([
      ['o-1', OrderStatus.COMPLETED, 12.5],
      ['o-2', OrderStatus.COMPLETED, 3.1],
    ])
  })

  it('überspringt eine schon abgeschlossene Bestellung, statt ihre Zahlung zu überschreiben', async () => {
    const { service, patched } = setupCircle({ 'o-1': 'completed', 'o-2': 'active' })

    const outcome = await service.payCashCircle(circleInput())

    expect(outcome).toEqual({ result: 'paid', paid: ['o-2'], skipped: ['o-1'], remaining: [] })
    expect(patched.map(c => c.id)).toEqual(['o-2'])
  })

  it('hält bei der ersten nicht kassierten Bestellung an und nennt den Rest', async () => {
    const declined = vi.fn().mockResolvedValue(false)
    const { service, patched } = setupCircle({ 'o-1': 'active', 'o-2': 'active' }, [CASH_SESSION_ERROR])

    const outcome = await service.payCashCircle(circleInput(declined))

    expect(outcome).toEqual({ result: 'cash-session-declined', paid: [], skipped: [], remaining: ['o-1', 'o-2'] })
    expect(patched).toHaveLength(1)
  })

  it('fragt die Kassen-Freigabe nur bei der ersten Bestellung, die übrigen laufen ohne Rückfrage', async () => {
    const approve = vi.fn().mockResolvedValue(true)
    const { service } = setupCircle({ 'o-1': 'active', 'o-2': 'active' }, [CASH_SESSION_ERROR, 'ok', 'ok'])

    const outcome = await service.payCashCircle(circleInput(approve))

    expect(outcome.result).toBe('paid')
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it('bucht nicht blind, wenn sich eine Bestellung nicht lesen lässt', async () => {
    const { service, patched } = setupCircle({ 'o-1': 'active', 'o-2': new Error('offline') })

    const outcome = await service.payCashCircle(circleInput())

    expect(outcome).toEqual({ result: 'failed', paid: ['o-1'], skipped: [], remaining: ['o-2'] })
    expect(patched.map(c => c.id)).toEqual(['o-1'])
  })
})

// core#1309: Ein ausbleibendes Ack ließ den Bezahldialog endlos offen.
describe('OrderCheckoutService — Timeout ohne Antwort der Edge (core#1309)', () => {
  afterEach(() => vi.useRealTimers())

  it('payCash gibt nach dem Timeout `timeout` zurück, statt endlos zu warten', async () => {
    vi.useFakeTimers()
    const patch = vi.fn(() => new Promise<never>(() => undefined))
    const injector = Injector.create({ providers: [{ provide: OrderService, useValue: { patch } }] })
    const service = runInInjectionContext(injector, () => new OrderCheckoutService())

    const result = service.payCash(input())
    await vi.advanceTimersByTimeAsync(PAY_TIMEOUT_MS)

    await expect(result).resolves.toBe('timeout')
  })

  it('payCashCircle hält bei ausbleibender Antwort an und nennt den Rest', async () => {
    vi.useFakeTimers()
    const patch = vi.fn(async () => ({}))
    const get = vi.fn((id: string) =>
      id === 'o-1' ? Promise.resolve({ status: 'active' }) : new Promise<never>(() => undefined),
    )
    const injector = Injector.create({ providers: [{ provide: OrderService, useValue: { patch, get } }] })
    const service = runInInjectionContext(injector, () => new OrderCheckoutService())

    const outcome = service.payCashCircle({
      ...input(),
      orders: [
        { orderId: 'o-1', total: 5 },
        { orderId: 'o-2', total: 7 },
      ],
    } as never)
    await vi.advanceTimersByTimeAsync(PAY_TIMEOUT_MS)

    await expect(outcome).resolves.toEqual({ result: 'timeout', paid: ['o-1'], skipped: [], remaining: ['o-2'] })
  })
})
