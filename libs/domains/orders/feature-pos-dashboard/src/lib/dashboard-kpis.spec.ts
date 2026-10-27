import { describe, expect, it } from 'vitest'
import type { Order } from '@panary/orders/domain'
import {
  averageWaitingMinutes,
  chartWindow,
  hourlyOrderCounts,
  ordersPerHour,
  preOrderSummary,
  todaysOpening,
  type TodaysOpening,
} from './dashboard-kpis'

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

  const open = (o: string, c: string): TodaysOpening => ({ kind: 'open', open: o, close: c })

  it('chartWindow nimmt die Öffnungszeit, mit :30 als angebrochener Stunde', () => {
    expect(chartWindow(open('06:00', '19:00'), new Array(24).fill(0))).toEqual({
      startHour: 6,
      endHour: 19,
      kind: 'open',
      openingLabel: '06–19',
      extended: false,
      hasOrders: false,
    })
    expect(chartWindow(open('06:30', '18:30'), new Array(24).fill(0))).toMatchObject({
      startHour: 6,
      endHour: 19,
      openingLabel: '06–19',
    })
  })

  it('chartWindow weitet auf Stunden mit Bestellungen, die Beschriftung bleibt die Öffnungszeit (core#1132)', () => {
    const counts = new Array(24).fill(0)
    counts[5] = 1
    counts[21] = 2
    expect(chartWindow(open('06:00', '19:00'), counts)).toEqual({
      startHour: 5,
      endHour: 22,
      kind: 'open',
      openingLabel: '06–19',
      extended: true,
      hasOrders: true,
    })
  })

  it('chartWindow: geschlossen nutzt die Rückfall-Achse ohne Uhrzeit, Bestellungen weiten sie (core#1132)', () => {
    const counts = new Array(24).fill(0)
    expect(chartWindow({ kind: 'closed' }, counts)).toEqual({
      startHour: 8,
      endHour: 20,
      kind: 'closed',
      openingLabel: null,
      extended: false,
      hasOrders: false,
    })
    counts[23] = 1
    expect(chartWindow({ kind: 'closed' }, counts)).toMatchObject({
      endHour: 24,
      kind: 'closed',
      openingLabel: null,
      hasOrders: true,
    })
  })

  it('chartWindow: nicht gepflegt nutzt den Rückfall 8–20 ohne Uhrzeit (core#1132)', () => {
    expect(chartWindow({ kind: 'unset' }, new Array(24).fill(0))).toEqual({
      startHour: 8,
      endHour: 20,
      kind: 'unset',
      openingLabel: null,
      extended: false,
      hasOrders: false,
    })
  })

  it('chartWindow: Öffnungszeit über Mitternacht ist nicht darstellbar und gilt als nicht gepflegt', () => {
    expect(chartWindow(open('18:00', '02:00'), new Array(24).fill(0))).toMatchObject({
      startHour: 8,
      endHour: 20,
      kind: 'unset',
      openingLabel: null,
    })
  })

  it('preOrderSummary nennt den ersten Artikel und zählt den Rest', () => {
    expect(preOrderSummary([{ name: 'Brötchen', amount: 12 }])).toBe('12× Brötchen')
    expect(
      preOrderSummary([
        { name: 'Torte', amount: 1 },
        { name: 'Kuchen', amount: 2 },
      ]),
    ).toBe('Torte +1')
    expect(preOrderSummary([])).toBe('')
  })

  it('hourlyOrderCounts ordnet nach Ortsstunde und überspringt Bestellungen ohne Zeit', () => {
    const counts = hourlyOrderCounts(
      [
        order('open', at(9, 5).toISOString()),
        order('open', at(9, 55).toISOString()),
        order('open', at(13).toISOString()),
        { status: 'open' } as unknown as Order,
      ],
      at(14),
    )
    expect(counts).toHaveLength(24)
    expect(counts[9]).toBe(2)
    expect(counts[13]).toBe(1)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('hourlyOrderCounts zählt Bestellungen vom Vortag nicht in die Stunden von heute (core#1132)', () => {
    const yesterday = new Date(2026, 9, 21, 23, 15)
    const counts = hourlyOrderCounts(
      [order('completed', yesterday.toISOString()), order('open', at(9).toISOString())],
      at(10),
    )
    expect(counts[23]).toBe(0)
    expect(counts[9]).toBe(1)
    expect(chartWindow({ kind: 'closed' }, counts)).toMatchObject({ endHour: 20 })
  })
})

describe('todaysOpening (core#1132)', () => {
  // Donnerstag, 22.10.2026, 12:00 Ortszeit; Filiale in Berlin wie die Testgeräte.
  const now = new Date(2026, 9, 22, 12)
  const location = (enabled: boolean, thursday?: { closed: boolean; open?: string; close?: string }) => ({
    _id: 'loc-1',
    settings: {
      generalSettings: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      openingHoursSettings: { enabled, regular: thursday ? [{ day: 4, ...thursday }] : [] },
    },
  })

  it('geschlossener Wochentag → closed', () => {
    expect(todaysOpening(location(true, { closed: true }), [], now)).toEqual({ kind: 'closed' })
  })

  it('offener Wochentag → open mit Zeiten', () => {
    expect(todaysOpening(location(true, { closed: false, open: '09:00', close: '18:00' }), [], now)).toEqual({
      kind: 'open',
      open: '09:00',
      close: '18:00',
    })
  })

  it('Öffnungszeiten deaktiviert oder Wochentag fehlt → unset', () => {
    expect(todaysOpening(location(false, { closed: true }), [], now)).toEqual({ kind: 'unset' })
    expect(todaysOpening(location(true), [], now)).toEqual({ kind: 'unset' })
    expect(todaysOpening(null, [], now)).toEqual({ kind: 'unset' })
  })

  it('filialgenaue Ausnahme „geschlossen" schlägt den offenen Wochentag', () => {
    const loc = location(true, { closed: false, open: '09:00', close: '18:00' })
    expect(todaysOpening(loc, [{ date: '2026-10-22', closed: true, locationId: 'loc-1' }], now)).toEqual({
      kind: 'closed',
    })
  })

  it('Ausnahme mit eigenen Zeiten gilt; Ausnahme einer fremden Filiale nicht', () => {
    const loc = location(true, { closed: false, open: '09:00', close: '18:00' })
    expect(
      todaysOpening(loc, [{ date: '2026-10-22', closed: false, open: '10:00', close: '14:00', locationId: 'loc-1' }], now),
    ).toEqual({ kind: 'open', open: '10:00', close: '14:00' })
    expect(todaysOpening(loc, [{ date: '2026-10-22', closed: true, locationId: 'loc-2' }], now)).toEqual({
      kind: 'open',
      open: '09:00',
      close: '18:00',
    })
  })

  it('offene Ausnahme ohne Zeiten → unset statt erfundener Zeit', () => {
    const loc = location(true, { closed: true })
    expect(todaysOpening(loc, [{ date: '2026-10-22', closed: false, locationId: 'loc-1' }], now)).toEqual({
      kind: 'unset',
    })
  })
})
