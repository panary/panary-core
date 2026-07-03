import { describe, expect, it } from 'vitest'
import { Order, OrderStatus } from '@panary/orders/domain'
import { applyOrderCreated, applyOrderRemoved, applyOrderUpdated } from './order-realtime-merge'

// Locken das Merge-Verhalten der Realtime-Events (created/updated-patched/removed):
// Payload-Merge statt Voll-Reload. Die Count-Deltas spiegeln die Server-Counts aus
// `loadDocuments` (total = alle Orders des Geschäftstags, completed = status COMPLETED),
// die NICHT aus der (auf QUERY_LIMIT gedeckelten) Liste ableitbar sind.

const BUSINESS_DAY = 'bd-1'
const OTHER_DAY = 'bd-2'

function makeOrder(id: string, partial: Partial<Order> = {}): Order {
  return {
    _id: id,
    status: OrderStatus.ACTIVE,
    businessDayId: BUSINESS_DAY,
    recordingDate: '2026-07-03T10:00:00.000Z',
    lineItems: [],
    ...partial,
  } as unknown as Order
}

describe('applyOrderCreated', () => {
  it('hängt eine neue Order an und zählt total +1', () => {
    const current = [makeOrder('a')]
    const result = applyOrderCreated(current, makeOrder('b'), BUSINESS_DAY)

    expect(result.changed).toBe(true)
    expect(result.orders.map(o => o._id)).toEqual(['a', 'b'])
    expect(result.totalDelta).toBe(1)
    expect(result.completedDelta).toBe(0)
  })

  it('zählt eine direkt abgeschlossene neue Order auch als completed +1', () => {
    const result = applyOrderCreated([], makeOrder('a', { status: OrderStatus.COMPLETED }), BUSINESS_DAY)

    expect(result.totalDelta).toBe(1)
    expect(result.completedDelta).toBe(1)
  })

  it('dedupliziert ein Event-Echo (Order bereits in der Liste) ohne Doppel-Zählung', () => {
    const current = [makeOrder('a', { table: '1' })]
    const result = applyOrderCreated(current, makeOrder('a', { table: '2' }), BUSINESS_DAY)

    expect(result.orders).toHaveLength(1)
    expect(result.orders[0].table).toBe('2')
    expect(result.totalDelta).toBe(0)
    expect(result.completedDelta).toBe(0)
  })

  it('ignoriert Orders eines fremden Geschäftstags (Scope-Parität zur Reload-Query)', () => {
    const current = [makeOrder('a')]
    const result = applyOrderCreated(current, makeOrder('b', { businessDayId: OTHER_DAY }), BUSINESS_DAY)

    expect(result.changed).toBe(false)
    expect(result.orders.map(o => o._id)).toEqual(['a'])
    expect(result.totalDelta).toBe(0)
  })

  it('verarbeitet Array-Payloads (Multi-Create)', () => {
    const result = applyOrderCreated([], [makeOrder('a'), makeOrder('b')], BUSINESS_DAY)

    expect(result.orders).toHaveLength(2)
    expect(result.totalDelta).toBe(2)
  })

  it('ignoriert Dokumente ohne _id', () => {
    const result = applyOrderCreated([], { status: OrderStatus.ACTIVE } as unknown as Order, BUSINESS_DAY)

    expect(result.changed).toBe(false)
    expect(result.orders).toHaveLength(0)
    expect(result.totalDelta).toBe(0)
  })

  it('mutiert das Eingabe-Array nicht', () => {
    const current = [makeOrder('a')]
    applyOrderCreated(current, makeOrder('b'), BUSINESS_DAY)

    expect(current).toHaveLength(1)
  })
})

describe('applyOrderUpdated', () => {
  it('ersetzt eine bestehende Order in place', () => {
    const current = [makeOrder('a'), makeOrder('b', { table: '1' })]
    const result = applyOrderUpdated(current, makeOrder('b', { table: '7' }), BUSINESS_DAY)

    expect(result.orders.map(o => o._id)).toEqual(['a', 'b'])
    expect(result.orders[1].table).toBe('7')
    expect(result.totalDelta).toBe(0)
  })

  it('zählt den Status-Flip ACTIVE→COMPLETED als completed +1', () => {
    const current = [makeOrder('a')]
    const result = applyOrderUpdated(current, makeOrder('a', { status: OrderStatus.COMPLETED }), BUSINESS_DAY)

    expect(result.completedDelta).toBe(1)
    expect(result.totalDelta).toBe(0)
  })

  it('zählt den Status-Flip COMPLETED→ACTIVE als completed -1', () => {
    const current = [makeOrder('a', { status: OrderStatus.COMPLETED })]
    const result = applyOrderUpdated(current, makeOrder('a', { status: OrderStatus.ACTIVE }), BUSINESS_DAY)

    expect(result.completedDelta).toBe(-1)
  })

  it('lässt completed unverändert bei Status-Flip ohne COMPLETED-Beteiligung', () => {
    const current = [makeOrder('a', { status: OrderStatus.PRODUCTION })]
    const result = applyOrderUpdated(current, makeOrder('a', { status: OrderStatus.PRODUCED }), BUSINESS_DAY)

    expect(result.completedDelta).toBe(0)
  })

  it('fügt eine unbekannte Order ein, ohne total zu erhöhen (war im Server-Count enthalten)', () => {
    const result = applyOrderUpdated([], makeOrder('a', { status: OrderStatus.COMPLETED }), BUSINESS_DAY)

    expect(result.orders).toHaveLength(1)
    expect(result.totalDelta).toBe(0)
    expect(result.completedDelta).toBe(0)
  })

  it('entfernt eine Order, die den Geschäftstag verlassen hat, aus Liste und Counts', () => {
    const current = [makeOrder('a', { status: OrderStatus.COMPLETED })]
    const result = applyOrderUpdated(
      current,
      makeOrder('a', { status: OrderStatus.COMPLETED, businessDayId: OTHER_DAY }),
      BUSINESS_DAY,
    )

    expect(result.orders).toHaveLength(0)
    expect(result.totalDelta).toBe(-1)
    expect(result.completedDelta).toBe(-1)
  })
})

describe('applyOrderRemoved', () => {
  it('entfernt eine Order aus der Liste und zählt total -1', () => {
    const current = [makeOrder('a'), makeOrder('b')]
    const result = applyOrderRemoved(current, makeOrder('a'), BUSINESS_DAY)

    expect(result.orders.map(o => o._id)).toEqual(['b'])
    expect(result.totalDelta).toBe(-1)
    expect(result.completedDelta).toBe(0)
  })

  it('zählt eine entfernte COMPLETED-Order auch als completed -1', () => {
    const current = [makeOrder('a', { status: OrderStatus.COMPLETED })]
    const result = applyOrderRemoved(current, makeOrder('a'), BUSINESS_DAY)

    expect(result.completedDelta).toBe(-1)
  })

  it('dekrementiert Counts auch ohne Listentreffer, wenn der Geschäftstag passt (Liste gedeckelt)', () => {
    const result = applyOrderRemoved([], makeOrder('a', { status: OrderStatus.COMPLETED }), BUSINESS_DAY)

    expect(result.changed).toBe(false)
    expect(result.totalDelta).toBe(-1)
    expect(result.completedDelta).toBe(-1)
  })

  it('ignoriert Removes fremder Geschäftstage', () => {
    const result = applyOrderRemoved([], makeOrder('a', { businessDayId: OTHER_DAY }), BUSINESS_DAY)

    expect(result.changed).toBe(false)
    expect(result.totalDelta).toBe(0)
    expect(result.completedDelta).toBe(0)
  })

  it('mutiert das Eingabe-Array nicht', () => {
    const current = [makeOrder('a')]
    applyOrderRemoved(current, makeOrder('a'), BUSINESS_DAY)

    expect(current).toHaveLength(1)
  })
})
