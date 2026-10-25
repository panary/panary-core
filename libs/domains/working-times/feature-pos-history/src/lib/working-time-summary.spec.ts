import { describe, expect, it } from 'vitest'
import { type DayRow, formatHoursMinutes, formatTotal, monthTotals, newestFirst } from './working-time-summary'

const H = 3_600_000
const day = (d: number, status: DayRow['status'], netH = 0, breakMin = 0): DayRow => ({
  date: new Date(2026, 9, d),
  status,
  netDuration: netH * H,
  breakDuration: breakMin * 60_000,
})

describe('Arbeitszeiten-Summen (core#978)', () => {
  it('newestFirst sortiert absteigend und hält mehrere Einträge eines Tages mit dem späteren zuerst', () => {
    const a = { date: new Date(2026, 9, 3), id: 'früh' }
    const b = { date: new Date(2026, 9, 3), id: 'spät' }
    const c = { date: new Date(2026, 9, 5), id: 'neu' }
    expect(newestFirst([a, b, c]).map(r => r.id)).toEqual(['neu', 'spät', 'früh'])
  })

  it('monthTotals lässt den laufenden Tag aus Zeit und Pausen heraus, zählt ihn aber als Arbeitstag', () => {
    const rows = [day(25, 'active', 8, 20), day(24, 'worked', 5, 15), day(23, 'worked', 7, 45), day(22, 'off')]
    const totals = monthTotals(rows, new Date(2026, 9, 25, 14))
    expect(totals.netMs).toBe(12 * H)
    expect(totals.breakMs).toBe(60 * 60_000)
    expect(totals.workedDays).toBe(3)
  })

  it('monthTotals zählt einen Tag mit zwei Einträgen nur einmal als Arbeitstag', () => {
    const rows = [day(10, 'worked', 3), day(10, 'worked', 2)]
    expect(monthTotals(rows, new Date(2026, 9, 25)).workedDays).toBe(1)
  })

  it('formatiert Dauern ohne Umbruchfallen', () => {
    expect(formatHoursMinutes(7 * H + 19 * 60_000)).toBe('7:19')
    expect(formatHoursMinutes(-90_000)).toBe('0:00')
    expect(formatTotal(47 * H + 31 * 60_000)).toBe('47 h 31 min')
    expect(formatTotal(4 * H)).toBe('4 h 00 min')
  })
})
