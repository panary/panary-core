import { describe, expect, it } from 'vitest'

import {
  DEVICE_REVERIFY_DEFAULT_DAYS,
  DEVICE_REVERIFY_MAX_DAYS,
  DEVICE_REVERIFY_MIN_DAYS,
  isDeviceReverificationDue,
  resolveDeviceOfflineForMs,
  resolveDeviceReverifyThresholdMs,
} from './device-reverification'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-17T08:00:00.000Z')
const ago = (ms: number): string => new Date(NOW - ms).toISOString()

describe('resolveDeviceReverifyThresholdMs', () => {
  it('faellt ohne Einstellung auf den Default zurueck', () => {
    expect(resolveDeviceReverifyThresholdMs(undefined)).toBe(DEVICE_REVERIFY_DEFAULT_DAYS * DAY_MS)
    expect(resolveDeviceReverifyThresholdMs(null)).toBe(DEVICE_REVERIFY_DEFAULT_DAYS * DAY_MS)
    expect(resolveDeviceReverifyThresholdMs({})).toBe(DEVICE_REVERIFY_DEFAULT_DAYS * DAY_MS)
  })

  it('uebernimmt einen konfigurierten Wert', () => {
    expect(resolveDeviceReverifyThresholdMs({ offlineReverifyDays: 14 })).toBe(14 * DAY_MS)
  })

  it('klammert unter die Untergrenze — Wochenenden duerfen nie ausloesen', () => {
    expect(resolveDeviceReverifyThresholdMs({ offlineReverifyDays: 1 })).toBe(DEVICE_REVERIFY_MIN_DAYS * DAY_MS)
    expect(resolveDeviceReverifyThresholdMs({ offlineReverifyDays: 3 })).toBe(DEVICE_REVERIFY_MIN_DAYS * DAY_MS)
  })

  it('klammert ueber die Obergrenze', () => {
    expect(resolveDeviceReverifyThresholdMs({ offlineReverifyDays: 3650 })).toBe(DEVICE_REVERIFY_MAX_DAYS * DAY_MS)
  })

  it('behandelt Muell wie „nicht konfiguriert" statt zu werfen', () => {
    for (const value of ['abc', '', null, -5, 0, Number.NaN, {}, []]) {
      expect(resolveDeviceReverifyThresholdMs({ offlineReverifyDays: value })).toBe(
        DEVICE_REVERIFY_DEFAULT_DAYS * DAY_MS,
      )
    }
  })

  it('liest numerische Strings aus Bestandsdaten', () => {
    expect(resolveDeviceReverifyThresholdMs({ offlineReverifyDays: '10' })).toBe(10 * DAY_MS)
  })
})

describe('resolveDeviceOfflineForMs', () => {
  it('misst die Pause', () => {
    expect(resolveDeviceOfflineForMs(ago(3 * DAY_MS), NOW)).toBe(3 * DAY_MS)
  })

  it('liefert null ohne verwertbaren Stempel', () => {
    expect(resolveDeviceOfflineForMs(undefined, NOW)).toBeNull()
    expect(resolveDeviceOfflineForMs(null, NOW)).toBeNull()
    expect(resolveDeviceOfflineForMs('', NOW)).toBeNull()
    expect(resolveDeviceOfflineForMs('kein-datum', NOW)).toBeNull()
    expect(resolveDeviceOfflineForMs(1758096000000, NOW)).toBeNull()
  })

  it('macht aus Uhr-Drift in die Zukunft keine Fristverlaengerung', () => {
    expect(resolveDeviceOfflineForMs(new Date(NOW + 5 * DAY_MS).toISOString(), NOW)).toBe(0)
  })
})

describe('isDeviceReverificationDue', () => {
  const threshold = DEVICE_REVERIFY_DEFAULT_DAYS * DAY_MS

  it('laesst den Alltagsbetrieb in Ruhe', () => {
    // Nacht, Wochenende, Ruhetag + Wochenende.
    for (const hours of [16, 60, 84]) {
      expect(isDeviceReverificationDue(ago(hours * 60 * 60 * 1000), NOW, threshold)).toBe(false)
    }
  })

  it('loest jenseits der Schwelle aus', () => {
    expect(isDeviceReverificationDue(ago(8 * DAY_MS), NOW, threshold)).toBe(true)
  })

  it('loest exakt auf der Schwelle noch NICHT aus', () => {
    expect(isDeviceReverificationDue(ago(threshold), NOW, threshold)).toBe(false)
    expect(isDeviceReverificationDue(ago(threshold + 1), NOW, threshold)).toBe(true)
  })

  it('ist fail-open ohne Stempel — ein Bestands-Schluessel wird nicht auf Verdacht gesperrt', () => {
    expect(isDeviceReverificationDue(undefined, NOW, threshold)).toBe(false)
    expect(isDeviceReverificationDue(null, NOW, threshold)).toBe(false)
    expect(isDeviceReverificationDue('kaputt', NOW, threshold)).toBe(false)
  })

  it('folgt der konfigurierten Schwelle, nicht dem Default', () => {
    const wide = resolveDeviceReverifyThresholdMs({ offlineReverifyDays: 30 })
    expect(isDeviceReverificationDue(ago(8 * DAY_MS), NOW, wide)).toBe(false)
    expect(isDeviceReverificationDue(ago(31 * DAY_MS), NOW, wide)).toBe(true)
  })
})
