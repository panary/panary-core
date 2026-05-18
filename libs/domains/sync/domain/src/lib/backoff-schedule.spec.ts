import { describe, it, expect } from 'vitest'

import {
  backoffMs,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_SCHEDULE_MS,
  shouldEscalateAfterRetry,
} from './backoff-schedule'

describe('backoffMs', () => {
  it('Versuch 1 → 30 Sekunden', () => {
    expect(backoffMs(1)).toBe(30_000)
  })

  it('Versuch 2 → 1 Minute', () => {
    expect(backoffMs(2)).toBe(60_000)
  })

  it('Versuch 3 → 5 Minuten', () => {
    expect(backoffMs(3)).toBe(5 * 60_000)
  })

  it('Versuch 4 → 30 Minuten', () => {
    expect(backoffMs(4)).toBe(30 * 60_000)
  })

  it('Versuch 5 → 2 Stunden', () => {
    expect(backoffMs(5)).toBe(2 * 3600_000)
  })

  it('Versuch 6 → 6 Stunden', () => {
    expect(backoffMs(6)).toBe(6 * 3600_000)
  })

  it('Versuch 7+ → bleibt bei 6h-Cap', () => {
    expect(backoffMs(7)).toBe(6 * 3600_000)
    expect(backoffMs(10)).toBe(6 * 3600_000)
    expect(backoffMs(100)).toBe(6 * 3600_000)
  })

  it('Versuch 0 / negative → defensiv auf erstem Slot (30s)', () => {
    expect(backoffMs(0)).toBe(30_000)
    expect(backoffMs(-5)).toBe(30_000)
  })

  it('Schedule deckt alle 6 definierten Stufen ab', () => {
    expect(RETRY_BACKOFF_SCHEDULE_MS.length).toBe(6)
  })

  it('Schedule ist monoton steigend', () => {
    for (let i = 1; i < RETRY_BACKOFF_SCHEDULE_MS.length; i++) {
      expect(RETRY_BACKOFF_SCHEDULE_MS[i]).toBeGreaterThan(RETRY_BACKOFF_SCHEDULE_MS[i - 1])
    }
  })
})

describe('shouldEscalateAfterRetry', () => {
  it('Vor MAX_RETRY_ATTEMPTS → false', () => {
    expect(shouldEscalateAfterRetry(0)).toBe(false)
    expect(shouldEscalateAfterRetry(5)).toBe(false)
    expect(shouldEscalateAfterRetry(MAX_RETRY_ATTEMPTS - 2)).toBe(false)
  })

  it('Bei (attempts + 1) >= MAX_RETRY_ATTEMPTS → true', () => {
    expect(shouldEscalateAfterRetry(MAX_RETRY_ATTEMPTS - 1)).toBe(true)
    expect(shouldEscalateAfterRetry(MAX_RETRY_ATTEMPTS)).toBe(true)
    expect(shouldEscalateAfterRetry(MAX_RETRY_ATTEMPTS + 5)).toBe(true)
  })

  it('Default MAX_RETRY_ATTEMPTS=10 (Plan-Vereinbarung)', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(10)
  })

  it('Schedule + MAX = max 1 Eskalation/Tag (6h × 10 = 60h, davon nur die letzten in 6h-Cap)', () => {
    // Versuche 1-6: 30s + 1min + 5min + 30min + 2h + 6h = ~8.6h
    // Versuche 7-10: jeweils 6h = 24h
    // Total: ~32h, abzueglich der ersten kurzen Stufen → max 1 Eskalation pro Tag
    let totalMs = 0
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      totalMs += backoffMs(attempt)
    }
    // Sanity-Check: zwischen 24h und 48h
    expect(totalMs).toBeGreaterThanOrEqual(24 * 3600_000)
    expect(totalMs).toBeLessThanOrEqual(48 * 3600_000)
  })
})
