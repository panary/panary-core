import { describe, expect, it } from 'vitest'
import {
  groupOpenOrdersBySettlementScope,
  openOrderCircleTotalCents,
  type OpenOrderGroupInput,
} from './open-order-groups'

const order = (id: string, over: Partial<OpenOrderGroupInput> = {}): OpenOrderGroupInput => ({
  _id: id,
  table: '4',
  settlementScope: '4#1',
  recordingDate: '2026-11-01T10:00:00.000Z',
  ...over,
})

describe('groupOpenOrdersBySettlementScope (core#1141)', () => {
  it('fasst zwei Bestellungen eines Tisch-Kreises zu einer Kreis-Karte zusammen', () => {
    const newer = order('b', { recordingDate: '2026-11-01T10:30:00.000Z' })
    const older = order('a')
    const entries = groupOpenOrdersBySettlementScope([newer, older])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      kind: 'circle',
      key: '4#1',
      settlementScope: '4#1',
      table: '4',
      firstRecordingDate: '2026-11-01T10:00:00.000Z',
      orders: [newer, older],
    })
  })

  it('Bestellungen ohne Tisch bleiben einzelne Karten', () => {
    const a = order('a', { table: null, settlementScope: 'auto:x-y-1' })
    const b = order('b', { table: null, settlementScope: 'auto:x-y-2' })
    expect(groupOpenOrdersBySettlementScope([a, b]).map(e => e.kind)).toEqual(['order', 'order'])
  })

  it('gruppiert nie über einen synthetischen Kreis, auch wenn ein Tisch gesetzt ist', () => {
    const a = order('a', { settlementScope: 'auto:same' })
    const b = order('b', { settlementScope: 'auto:same' })
    expect(groupOpenOrdersBySettlementScope([a, b]).map(e => e.kind)).toEqual(['order', 'order'])
  })

  it('ein Kreis mit nur einer offenen Bestellung bleibt die gewohnte Einzelkarte', () => {
    const entries = groupOpenOrdersBySettlementScope([order('a')])
    expect(entries).toEqual([{ kind: 'order', key: 'a', order: order('a') }])
  })

  it('zwei Besuche desselben Tisches sind zwei Kreise', () => {
    const entries = groupOpenOrdersBySettlementScope([
      order('a', { settlementScope: '4#2' }),
      order('b', { settlementScope: '4#2' }),
      order('c', { settlementScope: '4#1' }),
    ])
    expect(entries.map(e => e.kind)).toEqual(['circle', 'order'])
    expect(entries[0].key).toBe('4#2')
  })

  it('die Reihenfolge folgt der ersten Bestellung des Kreises, andere Karten behalten ihren Platz', () => {
    const entries = groupOpenOrdersBySettlementScope([
      order('t4b'),
      order('solo', { table: '7', settlementScope: '7#1' }),
      order('t4a'),
    ])
    expect(entries.map(e => e.key)).toEqual(['4#1', 'solo'])
  })

  it('ein Tisch aus Leerzeichen zählt als ohne Tisch', () => {
    const a = order('a', { table: '  ' })
    const b = order('b', { table: '  ' })
    expect(groupOpenOrdersBySettlementScope([a, b]).map(e => e.kind)).toEqual(['order', 'order'])
  })
})

describe('openOrderCircleTotalCents (core#1141)', () => {
  const totals: Record<string, number> = { a: 10.1, b: 0.2, c: 5 }
  type Circle = { _id: string; staffPaymentInfo?: unknown }
  const totalOf = (o: Circle) => totals[o._id]

  it('addiert die Beträge der Einzelkarten in Cent, ohne Fließkomma-Drift', () => {
    expect(openOrderCircleTotalCents<Circle>([{ _id: 'a' }, { _id: 'b' }], totalOf)).toBe(1030)
  })

  it('verbirgt die Summe, sobald eine Bestellung ein Personalessen ist', () => {
    expect(
      openOrderCircleTotalCents([{ _id: 'a' }, { _id: 'c', staffPaymentInfo: { userName: 'X' } }], totalOf),
    ).toBeNull()
  })
})
