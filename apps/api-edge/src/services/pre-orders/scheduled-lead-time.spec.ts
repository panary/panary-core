import { describe, expect, it } from 'vitest'

import { leadMinutesUntil } from './scheduled-lead-time'

/**
 * Die Rechnung hinter der Abholzeit einer konvertierten Vorbestellung (#344).
 *
 * Gemessen wird nicht „ergibt eine Zahl", sondern die Eigenschaft, auf die es
 * ankommt: **`recordingDate + Ergebnis` trifft wieder die vereinbarte Minute.**
 * Genau das druckt der Bon (`order-receipt.renderer.ts`, #342). Eine Assertion auf
 * die Minutenzahl allein liesse den Rundungsfehler durch, der bei einer
 * Konvertierung mit Sekunden auf dem Papier eine Minute zu frueh stuende.
 */
const at = (iso: string) => new Date(iso)

/** Was der Bon druecken wuerde: `recordingDate + Minuten`, auf HH:mm gekuerzt. */
const gedruckt = (recordingDate: Date, minutes: number): string =>
  new Date(recordingDate.getTime() + minutes * 60_000).toISOString().slice(11, 16)

describe('leadMinutesUntil — Abholzeit ueberlebt die Konvertierung (#344)', () => {
  describe('die Eigenschaft, die zaehlt: der Bon trifft die vereinbarte Minute', () => {
    it.each([
      ['glatte Konvertierung', '2026-09-20T15:45:00.000Z', '2026-09-20T16:00:00.000Z', '16:00'],
      ['Konvertierung mit Sekunden', '2026-09-20T15:45:40.000Z', '2026-09-20T16:00:00.000Z', '16:00'],
      ['Sekunden auf beiden Seiten', '2026-09-20T15:45:40.000Z', '2026-09-20T16:00:50.000Z', '16:00'],
      ['Stunden Vorlauf', '2026-09-20T08:00:13.000Z', '2026-09-20T16:00:00.000Z', '16:00'],
      ['unmittelbar davor', '2026-09-20T15:59:30.000Z', '2026-09-20T16:00:00.000Z', '16:00'],
      ['ueber Mitternacht', '2026-09-20T23:50:20.000Z', '2026-09-21T00:15:00.000Z', '00:15'],
    ])('%s', (_name, converted, scheduled, erwartet) => {
      const convertedAt = at(converted)
      const minutes = leadMinutesUntil(scheduled, convertedAt)

      expect(gedruckt(convertedAt, minutes)).toBe(erwartet)
    })

    it('rechnet die rohe Differenz NICHT einfach auf — sonst steht 15:59 auf dem Bon', () => {
      // 17:45:40 → 18:00:00 sind roh 14,33 Minuten. Gerundet 14, und der Bon druckte
      // eine Minute zu frueh. Ueber die Minutenanfaenge sind es 15.
      const convertedAt = at('2026-09-20T15:45:40.000Z')

      expect(leadMinutesUntil('2026-09-20T16:00:00.000Z', convertedAt)).toBe(15)
      expect(Math.round((at('2026-09-20T16:00:00.000Z').getTime() - convertedAt.getTime()) / 60_000)).toBe(14)
    })
  })

  describe('verstrichene und fehlende Zeiten ergeben SOFORT, nie etwas Negatives', () => {
    it('klemmt eine Abholzeit in der Vergangenheit auf 0', () => {
      expect(leadMinutesUntil('2026-09-20T15:00:00.000Z', at('2026-09-20T16:20:00.000Z'))).toBe(0)
    })

    it('gibt 0 zurueck, wenn die Abholzeit in derselben Minute liegt', () => {
      expect(leadMinutesUntil('2026-09-20T16:00:50.000Z', at('2026-09-20T16:00:10.000Z'))).toBe(0)
    })

    it.each([
      ['fehlend', undefined],
      ['null', null],
      ['leer', ''],
      ['unbrauchbar', 'kein Datum'],
    ])('gibt bei %s 0 zurueck statt NaN', (_name, wert) => {
      const ergebnis = leadMinutesUntil(wert as string | null | undefined, at('2026-09-20T16:00:00.000Z'))

      expect(ergebnis).toBe(0)
      expect(Number.isNaN(ergebnis)).toBe(false)
    })
  })

  describe('Zeitzonen', () => {
    it('rechnet auf Instants, nicht auf Ortszeit', () => {
      // Derselbe Moment, zwei Schreibweisen: Das Ergebnis muss identisch sein.
      // Waere hier irgendwo eine lokale Interpretation im Spiel, liefen die beiden
      // Werte um den Offset auseinander.
      const convertedAt = at('2026-09-20T15:45:00.000Z')

      expect(leadMinutesUntil('2026-09-20T16:00:00.000Z', convertedAt)).toBe(15)
      expect(leadMinutesUntil('2026-09-20T18:00:00+02:00', convertedAt)).toBe(15)
    })
  })
})
