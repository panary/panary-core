import { describe, expect, it } from 'vitest'
import {
  AUTO_LOG_OFF_FALLBACK_SECONDS,
  AUTO_LOG_OFF_MIN_SECONDS,
  resolveAutoLogOffTimeoutMs,
} from './auto-log-off-timeout'

const FALLBACK_MS = AUTO_LOG_OFF_FALLBACK_SECONDS * 1000
const MIN_MS = AUTO_LOG_OFF_MIN_SECONDS * 1000

describe('resolveAutoLogOffTimeoutMs', () => {
  it('rechnet Minuten um', () => {
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 2, autoLogOffTimeUnit: 'min' })).toBe(120_000)
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 10, autoLogOffTimeUnit: 'min' })).toBe(600_000)
  })

  it('rechnet Sekunden 1:1 um', () => {
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 180, autoLogOffTimeUnit: 'sec' })).toBe(180_000)
  })

  it('rechnet Stunden um', () => {
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 1, autoLogOffTimeUnit: 'h' })).toBe(3_600_000)
  })

  it('klammert den Bestands-Default von 30 Sekunden auf die Untergrenze', () => {
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 30, autoLogOffTimeUnit: 'sec' })).toBe(MIN_MS)
  })

  it('faellt auf den Fallback zurueck, wenn nichts Brauchbares konfiguriert ist', () => {
    expect(resolveAutoLogOffTimeoutMs(undefined)).toBe(FALLBACK_MS)
    expect(resolveAutoLogOffTimeoutMs(null)).toBe(FALLBACK_MS)
    expect(resolveAutoLogOffTimeoutMs({})).toBe(FALLBACK_MS)
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 0, autoLogOffTimeUnit: 'sec' })).toBe(FALLBACK_MS)
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: -5, autoLogOffTimeUnit: 'sec' })).toBe(FALLBACK_MS)
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 'abc', autoLogOffTimeUnit: 'sec' })).toBe(FALLBACK_MS)
  })

  it('liest eine unbekannte Einheit als Sekunden (Schema-Default)', () => {
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 200, autoLogOffTimeUnit: 'seconds' })).toBe(200_000)
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: 200 })).toBe(200_000)
  })

  it('liest numerische Strings aus dem Sync-Pfad', () => {
    expect(resolveAutoLogOffTimeoutMs({ autoLogOffTime: '5', autoLogOffTimeUnit: 'min' })).toBe(300_000)
  })
})
