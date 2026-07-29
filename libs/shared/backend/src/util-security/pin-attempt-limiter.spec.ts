import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPinFailures,
  getPinLockoutSeconds,
  recordPinFailure,
  resetPinAttemptLimiter,
  PIN_FAILURE_WINDOW_MS,
  PIN_LOCKOUT_MS,
  PIN_MAX_FAILURES,
} from './pin-attempt-limiter'

const USER = 'user-1'

const failNTimes = (key: string, n: number): void => {
  for (let i = 0; i < n; i++) recordPinFailure(key)
}

describe('pin-attempt-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetPinAttemptLimiter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sperrt erst ab PIN_MAX_FAILURES', () => {
    failNTimes(USER, PIN_MAX_FAILURES - 1)
    expect(getPinLockoutSeconds(USER)).toBeNull()

    recordPinFailure(USER)
    expect(getPinLockoutSeconds(USER)).toBeGreaterThan(0)
  })

  it('Sperre löst sich selbst auf — kein dauerhafter Lockout am Terminal', () => {
    failNTimes(USER, PIN_MAX_FAILURES)
    expect(getPinLockoutSeconds(USER)).not.toBeNull()

    vi.advanceTimersByTime(PIN_LOCKOUT_MS + 1)
    expect(getPinLockoutSeconds(USER)).toBeNull()
  })

  it('nach abgelaufener Sperre startet der Zähler neu (kein Sofort-Relock)', () => {
    failNTimes(USER, PIN_MAX_FAILURES)
    vi.advanceTimersByTime(PIN_LOCKOUT_MS + 1)
    expect(getPinLockoutSeconds(USER)).toBeNull()

    recordPinFailure(USER)
    expect(getPinLockoutSeconds(USER)).toBeNull()
  })

  it('Fehlversuche außerhalb des Fensters zählen nicht mit', () => {
    failNTimes(USER, PIN_MAX_FAILURES - 1)
    vi.advanceTimersByTime(PIN_FAILURE_WINDOW_MS + 1)

    recordPinFailure(USER)
    expect(getPinLockoutSeconds(USER)).toBeNull()
  })

  it('Erfolg löscht den Zähler', () => {
    failNTimes(USER, PIN_MAX_FAILURES - 1)
    clearPinFailures(USER)

    failNTimes(USER, PIN_MAX_FAILURES - 1)
    expect(getPinLockoutSeconds(USER)).toBeNull()
  })

  it('Keys sind unabhängig — ein gesperrter Mitarbeiter blockiert die Kollegen nicht', () => {
    failNTimes(USER, PIN_MAX_FAILURES)
    expect(getPinLockoutSeconds(USER)).not.toBeNull()
    expect(getPinLockoutSeconds('user-2')).toBeNull()
  })

  it('Restdauer wird in Sekunden aufgerundet gemeldet', () => {
    failNTimes(USER, PIN_MAX_FAILURES)
    expect(getPinLockoutSeconds(USER)).toBe(PIN_LOCKOUT_MS / 1000)
  })
})
