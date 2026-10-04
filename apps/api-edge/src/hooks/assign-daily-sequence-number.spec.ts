import { nextDailySequenceNumber } from './assign-daily-sequence-number'

// Reine Rechenregel der Vorgangsnummer (panary/panary-core#537). Die volle
// Hook-Kette deckt `test/services/orders/daily-sequence-number.test.ts` ab.
describe('nextDailySequenceNumber', () => {
  it('beginnt einen leeren Geschaeftstag bei 1', () => {
    expect(nextDailySequenceNumber(undefined, undefined)).toBe(1)
    expect(nextDailySequenceNumber(null, undefined)).toBe(1)
  })

  it('zaehlt ueber dem gespeicherten Maximum weiter (Neustart, leerer Merker)', () => {
    expect(nextDailySequenceNumber(41, undefined)).toBe(42)
  })

  it('zaehlt ueber der zuletzt vergebenen Nummer weiter, solange der Insert aussteht', () => {
    expect(nextDailySequenceNumber(41, 43)).toBe(44)
  })

  it('setzt auf einem Tag mit Altbestand (Uhrzeit-Nummern, Duplikate) ueber dem hoechsten Wert fort', () => {
    expect(nextDailySequenceNumber(9221, undefined)).toBe(9222)
  })
})
