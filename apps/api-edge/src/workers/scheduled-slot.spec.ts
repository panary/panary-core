import { describe, expect, it } from 'vitest'

import { computeScheduledSlot } from './scheduled-slot'

const BERLIN = 'Europe/Berlin'
const at = (iso: string) => new Date(iso)

describe('computeScheduledSlot', () => {
  describe('Faelligkeit', () => {
    it('feuert den ersten Slot auch ohne lastRunAt', () => {
      // REGRESSION: Die Vorgaenger-Fassung signalisierte „jetzt feuern" nur ueber
      // einen Catch-up-Zweig, der `lastScheduledSyncAt` voraussetzte — geschrieben
      // wurde das Feld aber ausschliesslich in genau diesem Zweig. Ohne
      // Vorbelegung war er unerreichbar und der Modus feuerte nie.
      const decision = computeScheduledSlot(
        { times: ['14:00'], timezone: BERLIN },
        at('2026-07-15T12:05:00Z'), // 14:05 CEST — Slot vor 5 Minuten
      )

      expect(decision?.due).toBe(true)
      expect(decision?.dueSlotAt).toBe('2026-07-15T12:00:00.000Z')
    })

    it('erkennt einen um Sekunden ueberschossenen Slot noch als faellig', () => {
      // REGRESSION: Der Aufrufer hat einen 60-s-Timer-Floor. Lag ein Slot naeher
      // als 60 s, wachte der Tick garantiert nach dem Slot auf — die alte
      // strikte Pruefung `slot > jetzt` verwarf ihn dann und verschob auf morgen.
      const decision = computeScheduledSlot({ times: ['14:00'], timezone: BERLIN }, at('2026-07-15T12:00:30Z'))

      expect(decision?.due).toBe(true)
    })

    it('feuert einen Slot, der exakt jetzt liegt', () => {
      const decision = computeScheduledSlot({ times: ['14:00'], timezone: BERLIN }, at('2026-07-15T12:00:00Z'))

      expect(decision?.due).toBe(true)
    })

    it('feuert einen Slot, der nur Millisekunden in der Zukunft liegt', () => {
      // Timer-Jitter: ein knapp zu frueh aufgewachter Tick darf den Slot nicht
      // verwerfen, sonst laeuft er in eine Warterunde, die ihn ueberschiesst.
      const decision = computeScheduledSlot({ times: ['14:00'], timezone: BERLIN }, at('2026-07-15T11:59:59.500Z'))

      expect(decision?.due).toBe(true)
    })

    it('feuert nicht, solange der Slot noch aussteht', () => {
      const decision = computeScheduledSlot({ times: ['14:00'], timezone: BERLIN }, at('2026-07-15T10:00:00Z'))

      expect(decision?.due).toBe(false)
      expect(decision?.waitMs).toBe(2 * 60 * 60 * 1000)
    })
  })

  describe('Doppelfeuer-Sperre', () => {
    it('feuert einen bereits gelaufenen Slot nicht erneut', () => {
      const decision = computeScheduledSlot(
        { times: ['14:00'], timezone: BERLIN },
        at('2026-07-15T12:05:00Z'),
        '2026-07-15T12:00:00.000Z', // genau dieser Slot lief schon
      )

      expect(decision?.due).toBe(false)
      // Naechster Slot ist der von morgen: 24 h minus die vergangenen 5 Minuten.
      expect(decision?.waitMs).toBe(24 * 60 * 60 * 1000 - 5 * 60 * 1000)
    })

    it('feuert, wenn der letzte Lauf vor dem Slot lag', () => {
      const decision = computeScheduledSlot(
        { times: ['14:00'], timezone: BERLIN },
        at('2026-07-15T12:05:00Z'),
        '2026-07-14T12:00:00.000Z', // gestriger Lauf
      )

      expect(decision?.due).toBe(true)
    })

    it('meldet den Slot-Zeitpunkt, nicht die aktuelle Uhrzeit', () => {
      // `lastScheduledSyncAt` muss den Slot tragen, nicht Date.now() — sonst
      // wandert die Sperre mit jeder Laufzeit-Verzoegerung nach hinten und der
      // Folgetag-Slot koennte faelschlich als „schon gelaufen" gelten.
      const decision = computeScheduledSlot({ times: ['14:00'], timezone: BERLIN }, at('2026-07-15T12:47:11Z'))

      expect(decision?.dueSlotAt).toBe('2026-07-15T12:00:00.000Z')
    })
  })

  describe('Nachhol-Fenster', () => {
    it('holt einen Slot von vor 11 Stunden nach', () => {
      // Ueber Nacht ausgeschaltete Kasse: Slot 02:00, Geraet laeuft ab 13:00.
      const decision = computeScheduledSlot(
        { times: ['02:00'], timezone: BERLIN },
        at('2026-07-15T11:00:00Z'), // 13:00 CEST, Slot war 00:00Z
      )

      expect(decision?.due).toBe(true)
      expect(decision?.dueSlotAt).toBe('2026-07-15T00:00:00.000Z')
    })

    it('holt einen Slot ausserhalb des Fensters nicht mehr nach', () => {
      const decision = computeScheduledSlot(
        { times: ['22:00'], timezone: BERLIN },
        at('2026-07-15T12:05:00Z'), // gestriger 22:00-Slot liegt 16 h zurueck
      )

      expect(decision?.due).toBe(false)
    })

    it('holt nach langem Stillstand nur einen Lauf nach, nicht einen pro Slot', () => {
      // Mehrere Slots am Tag, Geraet war tagelang aus: es soll der juengste
      // faellige Slot laufen — nicht drei Cycles hintereinander.
      const decision = computeScheduledSlot(
        { times: ['02:00', '08:00', '14:00'], timezone: BERLIN },
        at('2026-07-15T12:05:00Z'), // 14:05 CEST
      )

      expect(decision?.due).toBe(true)
      expect(decision?.dueSlotAt).toBe('2026-07-15T12:00:00.000Z')
    })
  })

  describe('Tagesgrenze', () => {
    it('holt einen Slot von kurz vor Mitternacht nach dem Datumswechsel nach', () => {
      const decision = computeScheduledSlot(
        { times: ['23:50'], timezone: BERLIN },
        at('2026-07-15T22:05:00Z'), // 00:05 CEST am 16.07.
      )

      expect(decision?.due).toBe(true)
      expect(decision?.dueSlotAt).toBe('2026-07-15T21:50:00.000Z')
    })

    it('findet den ersten Slot des Folgetags', () => {
      const decision = computeScheduledSlot(
        { times: ['02:00'], timezone: BERLIN },
        at('2026-07-15T21:55:00Z'), // 23:55 CEST
      )

      expect(decision?.due).toBe(false)
      expect(decision?.waitMs).toBe(2 * 60 * 60 * 1000 + 5 * 60 * 1000)
    })
  })

  describe('Zeitzonen', () => {
    it('rechnet Winterzeit korrekt (CET, UTC+1)', () => {
      const decision = computeScheduledSlot({ times: ['04:00'], timezone: BERLIN }, at('2026-01-15T00:00:00Z'))

      // 04:00 CET = 03:00 UTC → in 3 Stunden.
      expect(decision?.waitMs).toBe(3 * 60 * 60 * 1000)
    })

    it('rechnet Sommerzeit korrekt (CEST, UTC+2)', () => {
      const decision = computeScheduledSlot({ times: ['04:00'], timezone: BERLIN }, at('2026-07-15T00:00:00Z'))

      // 04:00 CEST = 02:00 UTC → in 2 Stunden.
      expect(decision?.waitMs).toBe(2 * 60 * 60 * 1000)
    })

    it('trifft den Slot am Tag der Zeitumstellung', () => {
      // REGRESSION: Der alte `toLocaleString`-Roundtrip bildete DST nicht ab.
      // 2026-03-29 springt Europe/Berlin um 02:00 CET auf 03:00 CEST.
      const decision = computeScheduledSlot(
        { times: ['04:00'], timezone: BERLIN },
        at('2026-03-29T00:00:00Z'), // 01:00 CET
      )

      // 04:00 CEST = 02:00 UTC → in 2 Stunden, nicht 3.
      expect(decision?.waitMs).toBe(2 * 60 * 60 * 1000)
    })

    it('rechnet in einer Zone weit ausserhalb der Server-Zeitzone', () => {
      const decision = computeScheduledSlot(
        { times: ['09:00'], timezone: 'Pacific/Auckland' },
        at('2026-07-15T00:00:00Z'), // 12:00 NZST (UTC+12)
      )

      // 09:00 NZST war um 21:00Z am Vortag → 3 h her, also faellig.
      expect(decision?.due).toBe(true)
      expect(decision?.dueSlotAt).toBe('2026-07-14T21:00:00.000Z')
    })
  })

  describe('unbrauchbare Zeitplaene', () => {
    it('liefert null bei leerer Uhrzeiten-Liste', () => {
      // Der Aufrufer faellt dann auf AUTO-Verhalten zurueck. Die alte Fassung
      // lief hier in NaN und blieb stumm stehen.
      expect(computeScheduledSlot({ times: [], timezone: BERLIN }, at('2026-07-15T12:00:00Z'))).toBeNull()
    })

    it('liefert null ohne Zeitplan', () => {
      expect(computeScheduledSlot(undefined, at('2026-07-15T12:00:00Z'))).toBeNull()
      expect(computeScheduledSlot(null, at('2026-07-15T12:00:00Z'))).toBeNull()
    })

    it('liefert null ohne Zeitzone', () => {
      expect(computeScheduledSlot({ times: ['14:00'] }, at('2026-07-15T12:00:00Z'))).toBeNull()
    })

    it('liefert null bei unbekannter Zeitzone', () => {
      expect(
        computeScheduledSlot({ times: ['14:00'], timezone: 'Mars/Olympus' }, at('2026-07-15T12:00:00Z')),
      ).toBeNull()
    })

    it('verwirft ungueltige Uhrzeiten und rechnet mit dem Rest weiter', () => {
      const decision = computeScheduledSlot(
        { times: ['25:00', 'abc', '', '14:00'], timezone: BERLIN },
        at('2026-07-15T10:00:00Z'),
      )

      expect(decision?.waitMs).toBe(2 * 60 * 60 * 1000)
    })

    it('liefert null, wenn alle Uhrzeiten ungueltig sind', () => {
      expect(computeScheduledSlot({ times: ['99:99', 'x'], timezone: BERLIN }, at('2026-07-15T12:00:00Z'))).toBeNull()
    })
  })
})
