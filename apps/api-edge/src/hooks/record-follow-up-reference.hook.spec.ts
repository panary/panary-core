import { describe, expect, it } from 'vitest'
import { firstOfCircle } from './record-follow-up-reference.hook'

// Die Kette (Kreis lesen, Referenz schreiben, Split und Umordnung auslassen) prueft der
// Integrationstest `test/services/orders/settlement-scope.test.ts` gegen die migrierte SQLite.
describe('firstOfCircle (core#1140)', () => {
  it('nimmt die frueheste Aufnahme, unabhaengig von der Reihenfolge der Abfrage', () => {
    const late = { _id: '0192-b', recordingDate: '2026-11-02T12:30:00.000Z' }
    const early = { _id: '0192-c', recordingDate: '2026-11-02T12:00:00.000Z' }
    expect(firstOfCircle([late, early])?._id).toBe('0192-c')
  })

  it('entscheidet bei gleicher Aufnahmezeit nach der ID (uuidv7 ist zeitlich sortiert)', () => {
    const at = '2026-11-02T12:00:00.000Z'
    expect(
      firstOfCircle([
        { _id: '0192-b', recordingDate: at },
        { _id: '0192-a', recordingDate: at },
      ])?._id,
    ).toBe('0192-a')
  })

  it('faellt ohne Aufnahmezeit auf createdAt zurueck, eine ungueltige Zeit verliert', () => {
    expect(
      firstOfCircle([
        { _id: '0192-a', recordingDate: 'kaputt' },
        { _id: '0192-b', recordingDate: null, createdAt: '2026-11-02T12:00:00.000Z' },
      ])?._id,
    ).toBe('0192-b')
  })

  it('liefert fuer einen leeren Kreis nichts', () => {
    expect(firstOfCircle([])).toBeNull()
  })
})
