import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/orders/domain', () => ({ OrderStatus: { COMPLETED: 'completed', ACTIVE: 'active' } }))

const loadClosedDayCheck = vi.fn()
const assertClosedDayApproved = vi.fn()
vi.mock('../utils/closed-day-gate', () => ({
  loadClosedDayCheck: (...a: unknown[]) => loadClosedDayCheck(...a),
  assertClosedDayApproved: (...a: unknown[]) => assertClosedDayApproved(...a),
}))

import { restrictOrderCompletionToClosedDay } from './restrict-order-completion-to-closed-day'

const LOCATION = { _id: 'loc-1', currentBusinessDay: { businessDayId: 'bd-heute' } }

function makeContext(opts: { provider?: string; data?: any; original?: any } = {}): any {
  return {
    id: 'order-1',
    data: opts.data ?? { status: 'completed' },
    params: { provider: opts.provider === undefined ? 'rest' : opts.provider },
    service: { get: vi.fn().mockResolvedValue(opts.original ?? { status: 'active', locationId: 'loc-1' }) },
    app: { service: () => ({ get: vi.fn().mockResolvedValue(LOCATION) }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadClosedDayCheck.mockResolvedValue({ status: { state: 'closed', date: '2026-10-26' }, policy: 'manager-approval' })
  assertClosedDayApproved.mockResolvedValue(undefined)
})

describe('restrictOrderCompletionToClosedDay', () => {
  it('prüft den Abschluss gegen den laufenden Geschäftstag der Filiale', async () => {
    const ctx = makeContext()
    await restrictOrderCompletionToClosedDay()(ctx)
    expect(assertClosedDayApproved).toHaveBeenCalledWith(
      ctx.app,
      LOCATION,
      expect.objectContaining({ policy: 'manager-approval' }),
      'bd-heute',
    )
  })

  it('reicht die Ablehnung durch', async () => {
    const err = new Error('Ruhetag')
    assertClosedDayApproved.mockRejectedValue(err)
    await expect(restrictOrderCompletionToClosedDay()(makeContext())).rejects.toBe(err)
  })

  it.each([
    ['intern (Sync-Apply)', { provider: '' }],
    ['kein Abschluss', { data: { status: 'active' } }],
    ['schon abgeschlossen', { original: { status: 'completed', locationId: 'loc-1' } }],
    ['ohne Filiale', { original: { status: 'active', locationId: null } }],
  ])('lässt %s ungeprüft durch', async (_label, opts) => {
    await restrictOrderCompletionToClosedDay()(makeContext(opts as any))
    expect(assertClosedDayApproved).not.toHaveBeenCalled()
  })
})
