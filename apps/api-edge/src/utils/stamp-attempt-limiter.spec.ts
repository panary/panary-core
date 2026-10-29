import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStampAttemptLimiter, DEVICE_STAMP_LIMIT, EDGE_STAMP_LIMIT } from './stamp-attempt-limiter'

describe('stamp-attempt-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-29T08:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const fail = (l: ReturnType<typeof createStampAttemptLimiter>, key: string, n: number) => {
    for (let i = 0; i < n; i++) l.recordFailure(key)
  }

  it('sperrt das Geraet beim fuenften Fehlversuch fuer 60 s und entsperrt von selbst', () => {
    const l = createStampAttemptLimiter(DEVICE_STAMP_LIMIT)
    fail(l, 'd1', 4)
    expect(l.lockoutSeconds('d1')).toBeNull()
    l.recordFailure('d1')
    expect(l.lockoutSeconds('d1')).toBe(60)
    vi.advanceTimersByTime(61_000)
    expect(l.lockoutSeconds('d1')).toBeNull()
  })

  it('verdoppelt die Sperre bei jedem weiteren Erreichen bis 15 min', () => {
    const l = createStampAttemptLimiter(DEVICE_STAMP_LIMIT)
    const seen: number[] = []
    for (let round = 0; round < 7; round++) {
      fail(l, 'd1', 5)
      const s = l.lockoutSeconds('d1') as number
      seen.push(s)
      vi.advanceTimersByTime(s * 1000 + 1)
    }
    expect(seen).toEqual([60, 120, 240, 480, 900, 900, 900])
  })

  it('trennt die Schluessel: ein gesperrtes Geraet sperrt kein anderes', () => {
    const l = createStampAttemptLimiter(DEVICE_STAMP_LIMIT)
    fail(l, 'd1', 5)
    expect(l.lockoutSeconds('d1')).not.toBeNull()
    expect(l.lockoutSeconds('d2')).toBeNull()
  })

  it('zaehlt nur im Fenster: alte Fehlversuche verfallen', () => {
    const l = createStampAttemptLimiter(DEVICE_STAMP_LIMIT)
    fail(l, 'd1', 4)
    vi.advanceTimersByTime(5 * 60_000 + 1)
    l.recordFailure('d1')
    expect(l.lockoutSeconds('d1')).toBeNull()
  })

  it('clear setzt Zaehler und Eskalationsstufe zurueck', () => {
    const l = createStampAttemptLimiter(DEVICE_STAMP_LIMIT)
    fail(l, 'd1', 5)
    vi.advanceTimersByTime(61_000)
    l.clear('d1')
    fail(l, 'd1', 5)
    expect(l.lockoutSeconds('d1')).toBe(60)
  })

  it('die Edge-Grobsperre greift erst bei 50 und eskaliert nicht', () => {
    const l = createStampAttemptLimiter(EDGE_STAMP_LIMIT)
    fail(l, 'edge', 49)
    expect(l.lockoutSeconds('edge')).toBeNull()
    l.recordFailure('edge')
    expect(l.lockoutSeconds('edge')).toBe(60)
    vi.advanceTimersByTime(61_000)
    fail(l, 'edge', 50)
    expect(l.lockoutSeconds('edge')).toBe(60)
  })
})
