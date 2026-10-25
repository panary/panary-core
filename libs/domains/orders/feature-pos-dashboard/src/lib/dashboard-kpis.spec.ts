import { describe, expect, it } from 'vitest'
import type { Order } from '@panary/orders/domain'
import { averageWaitingMinutes, chartWindow, hourlyOrderCounts, ordersPerHour, preOrderSummary } from './dashboard-kpis'

const order = (status: string, recordingDate: string): Order => ({ status, recordingDate }) as unknown as Order

/** Ortszeit, damit die Stundenzuordnung nicht von der Zeitzone der Maschine abhängt. */
const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute)

describe('Übersicht-Kennzahlen (core#832)', () => {
  it('averageWaitingMinutes zählt nur offene Bestellungen', () => {
    const now = at(12)
    const orders = [
      order('open', at(11, 50).toISOString()),
      order('open', at(11, 30).toISOString()),
      order('completed', at(8).toISOString()),
    ]
    expect(averageWaitingMinutes(orders, now)).toBe(20)
  })

  it('averageWaitingMinutes ist ohne offene Bestellung 0', () => {
    expect(averageWaitingMinutes([order('completed', at(8).toISOString())], at(12))).toBe(0)
  })

  it('ordersPerHour rechnet ab Öffnung (Rückfall 8 Uhr) und mindestens mit einer Stunde', () => {
    expect(ordersPerHour(8, at(12))).toBe(2)
    expect(ordersPerHour(3, at(7))).toBe(3)
    expect(ordersPerHour(12, at(12), 6)).toBe(2)
  })

  it('chartWindow nimmt die Öffnungszeit, mit :30 als angebrochener Stunde', () => {
    expect(chartWindow({ open: '06:00', close: '19:00' }, new Array(24).fill(0))).toEqual({ startHour: 6, endHour: 19 })
    expect(chartWindow({ open: '06:30', close: '18:30' }, new Array(24).fill(0))).toEqual({ startHour: 6, endHour: 19 })
  })

  it('chartWindow fällt ohne Öffnungszeit auf 8–20 zurück und weitet auf Stunden mit Bestellungen', () => {
    const counts = new Array(24).fill(0)
    expect(chartWindow(null, counts)).toEqual({ startHour: 8, endHour: 20 })
    counts[5] = 1
    counts[21] = 2
    expect(chartWindow({ open: '06:00', close: '19:00' }, counts)).toEqual({ startHour: 5, endHour: 22 })
  })

  it('preOrderSummary nennt den ersten Artikel und zählt den Rest', () => {
    expect(preOrderSummary([{ name: 'Brötchen', amount: 12 }])).toBe('12× Brötchen')
    expect(preOrderSummary([{ name: 'Torte', amount: 1 }, { name: 'Kuchen', amount: 2 }])).toBe('Torte +1')
    expect(preOrderSummary([])).toBe('')
  })

  it('hourlyOrderCounts ordnet nach Ortsstunde und überspringt Bestellungen ohne Zeit', () => {
    const counts = hourlyOrderCounts([
      order('open', at(9, 5).toISOString()),
      order('open', at(9, 55).toISOString()),
      order('open', at(13).toISOString()),
      { status: 'open' } as unknown as Order,
    ])
    expect(counts).toHaveLength(24)
    expect(counts[9]).toBe(2)
    expect(counts[13]).toBe(1)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3)
  })
})
