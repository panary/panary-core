import { describe, expect, it } from 'vitest'

import {
  formatPrintDate,
  formatPrintDateTime,
  formatPrintTime,
  printTimeZoneForLocation,
  resolvePrintTimeZone,
} from './print-date-format'

// Feste Zeitpunkte statt `new Date()`: die Erwartungswerte muessen unabhaengig von
// der Zeitzone des Testlaeufers gelten (lokal macOS = Europe/Berlin, CI-Container
// = UTC). Genau diese Abhaengigkeit war der Fehler (#274) — eine Spec, die sie
// mitbringt, wuerde ihn nicht finden.
const SOMMER = new Date('2026-07-15T12:03:05.000Z') // Europe/Berlin = UTC+2 (CEST)
const WINTER = new Date('2026-01-15T12:03:05.000Z') // Europe/Berlin = UTC+1 (CET)

describe('print-date-format — Filialzeit statt Prozesszeit', () => {
  it('formatiert die Uhrzeit in Sommer- und Winterzeit korrekt', () => {
    // Offset ungleich 0 ist Absicht: ein stiller ICU-Fallback auf UTC (Node ohne
    // volle ICU-Daten) wuerde hier rot, nicht gruen.
    expect(formatPrintTime(SOMMER, 'Europe/Berlin')).toBe('14:03')
    expect(formatPrintTime(WINTER, 'Europe/Berlin')).toBe('13:03')
  })

  it('folgt der uebergebenen Zone, nicht der des Prozesses', () => {
    expect(formatPrintTime(SOMMER, 'UTC')).toBe('12:03')
    expect(formatPrintTime(SOMMER, 'America/New_York')).toBe('08:03')
  })

  it('rechnet das Datum ueber die Tagesgrenze in der Filialzone', () => {
    const spaetabends = new Date('2026-07-15T23:30:00.000Z')
    expect(formatPrintDate(spaetabends, 'Europe/Berlin')).toBe('16.7.2026')
    expect(formatPrintDate(spaetabends, 'UTC')).toBe('15.7.2026')
    expect(formatPrintDate(spaetabends, 'America/New_York')).toBe('15.7.2026')
  })

  it('haelt die bisherigen Ausgabeformate ein', () => {
    // Gleiche Darstellung wie `toLocale*('de-DE')` vorher — geaendert hat sich nur,
    // wessen Uhr gilt. Sonst faende der Kunde den Bon neu formatiert vor.
    expect(formatPrintDate(SOMMER, 'Europe/Berlin')).toBe('15.7.2026')
    expect(formatPrintDateTime(SOMMER, 'Europe/Berlin')).toBe('15.7.2026, 14:03:05')
  })

  it('faellt bei fehlender oder unbrauchbarer Zone auf den Geschaeftstag-Default zurueck', () => {
    const berlin = formatPrintDateTime(SOMMER, 'Europe/Berlin')
    expect(formatPrintDateTime(SOMMER, undefined)).toBe(berlin)
    expect(formatPrintDateTime(SOMMER, null)).toBe(berlin)
    expect(formatPrintDateTime(SOMMER, '')).toBe(berlin)
    // Tippfehler in den Filial-Settings darf keinen Bon kosten.
    expect(formatPrintDateTime(SOMMER, 'Europe/Bielefeld')).toBe(berlin)
    expect(resolvePrintTimeZone('Europe/Bielefeld')).toBe('Europe/Berlin')
  })

  it('liest die Zone aus den Location-Settings', () => {
    expect(printTimeZoneForLocation({ settings: { generalSettings: { timezone: 'America/New_York' } } })).toBe(
      'America/New_York',
    )
    expect(printTimeZoneForLocation({ settings: { generalSettings: {} } })).toBe('Europe/Berlin')
    expect(printTimeZoneForLocation({})).toBe('Europe/Berlin')
    expect(printTimeZoneForLocation(null)).toBe('Europe/Berlin')
  })
})
