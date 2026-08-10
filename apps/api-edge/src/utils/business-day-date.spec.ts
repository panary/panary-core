import { describe, expect, it } from 'vitest'

import { businessDateForLocation, businessDateForTimezone, DEFAULT_BUSINESS_TIMEZONE } from './business-day-date'

/**
 * Pure-Function-Tests: der Zeitpunkt UND die Zone werden uebergeben, nichts wird
 * aus der Prozess-Umgebung gelesen. `process.env.TZ` waere hier ohnehin wirkungslos
 * — Node bindet die Zone beim Prozessstart, ein Setzen zur Laufzeit aendert sie
 * nicht mehr.
 */
describe('businessDateForTimezone', () => {
  // 30.07.2026 00:30 CEST == 29.07.2026 22:30 UTC — die Stunde, in der der
  // UTC-Tag und der Filial-Tag auseinanderlaufen.
  const cestNightAfterMidnight = new Date('2026-07-30T00:30:00+02:00')

  it('liefert für Europe/Berlin den lokalen Kalendertag, nicht den UTC-Vortag', () => {
    expect(businessDateForTimezone(cestNightAfterMidnight, 'Europe/Berlin')).toBe('2026-07-30')
    // Beleg, dass die frühere Implementierung hier wirklich danebenlag:
    expect(cestNightAfterMidnight.toISOString().slice(0, 10)).toBe('2026-07-29')
  })

  it('liefert für einen UTC-Standort den UTC-Tag', () => {
    expect(businessDateForTimezone(cestNightAfterMidnight, 'UTC')).toBe('2026-07-29')
  })

  it('respektiert Zonen jenseits der Datumsgrenze', () => {
    // 22:30 UTC am 29.07. ist in Auckland (UTC+12) bereits der 30.07.
    expect(businessDateForTimezone(cestNightAfterMidnight, 'Pacific/Auckland')).toBe('2026-07-30')
  })

  it('rechnet in der Winterzeit mit UTC+1 statt UTC+2', () => {
    // 15.01.2026 23:30 UTC ist in CET (UTC+1) bereits der 16.01.
    expect(businessDateForTimezone(new Date('2026-01-15T23:30:00Z'), 'Europe/Berlin')).toBe('2026-01-16')
  })

  it('fällt ohne Zeitzone auf Europe/Berlin zurück', () => {
    expect(businessDateForTimezone(cestNightAfterMidnight, null)).toBe('2026-07-30')
    expect(businessDateForTimezone(cestNightAfterMidnight, '')).toBe('2026-07-30')
    expect(businessDateForTimezone(cestNightAfterMidnight, undefined)).toBe('2026-07-30')
    expect(DEFAULT_BUSINESS_TIMEZONE).toBe('Europe/Berlin')
  })

  it('fällt bei ungültiger Zeitzone auf Europe/Berlin zurück statt zu werfen', () => {
    // Eine per Settings-UI gesetzte Falschangabe darf die Rotation nicht anhalten.
    expect(businessDateForTimezone(cestNightAfterMidnight, 'Nicht/EineZone')).toBe('2026-07-30')
  })

  it('formatiert Monat und Tag zweistellig', () => {
    expect(businessDateForTimezone(new Date('2026-01-05T12:00:00+01:00'), 'Europe/Berlin')).toBe('2026-01-05')
  })

  // Mitternacht ist der Rand, an dem der Kalendertag kippt — beide Seiten prüfen,
  // damit ein Off-by-one nicht nur zufällig in der Mitte des Tages unauffällig ist.
  it('kippt exakt an der lokalen Mitternacht', () => {
    expect(businessDateForTimezone(new Date('2026-07-29T23:59:59.999+02:00'), 'Europe/Berlin')).toBe('2026-07-29')
    expect(businessDateForTimezone(new Date('2026-07-30T00:00:00.000+02:00'), 'Europe/Berlin')).toBe('2026-07-30')
  })
})

describe('businessDateForLocation', () => {
  const night = new Date('2026-07-30T00:30:00+02:00')

  it('liest die Zone aus settings.generalSettings.timezone', () => {
    const location = { settings: { generalSettings: { timezone: 'Pacific/Auckland' } } }

    expect(businessDateForLocation(location, night)).toBe('2026-07-30')
    expect(businessDateForLocation({ settings: { generalSettings: { timezone: 'UTC' } } }, night)).toBe('2026-07-29')
  })

  // Der Sync-Pfad kann eine Location ohne (oder mit halb befülltem) `settings`
  // liefern; der Boot-Pfad liest die Spalte roh und kann `null` bekommen.
  it('fällt bei fehlenden Settings sauber auf Europe/Berlin zurück', () => {
    expect(businessDateForLocation({ settings: null }, night)).toBe('2026-07-30')
    expect(businessDateForLocation({}, night)).toBe('2026-07-30')
    expect(businessDateForLocation({ settings: { generalSettings: {} } }, night)).toBe('2026-07-30')
    expect(businessDateForLocation(null, night)).toBe('2026-07-30')
    expect(businessDateForLocation(undefined, night)).toBe('2026-07-30')
  })
})
