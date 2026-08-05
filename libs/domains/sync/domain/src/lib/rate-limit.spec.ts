import { describe, it, expect } from 'vitest'

import {
  parseRetryAfterMs,
  rateLimitDelayMs,
  RATE_LIMIT_FALLBACK_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_MIN_DELAY_MS,
} from './rate-limit'

// Fixer Bezugspunkt statt Date.now() — die Datums-Faelle muessen deterministisch
// gegen dieselbe „Jetzt"-Zeit rechnen.
const NOW = Date.parse('2026-08-05T12:00:00.000Z')

describe('parseRetryAfterMs — Delta-Sekunden', () => {
  it('ganze Sekunden werden zu Millisekunden', () => {
    expect(parseRetryAfterMs('120', NOW)).toBe(120_000)
  })

  it('Whitespace um den Wert stoert nicht', () => {
    expect(parseRetryAfterMs('  30 ', NOW)).toBe(30_000)
  })

  it('0 faellt auf die Untergrenze — sonst Hot-Loop am Fensterende', () => {
    expect(parseRetryAfterMs('0', NOW)).toBe(RATE_LIMIT_MIN_DELAY_MS)
  })

  it('absurd grosser Wert wird gedeckelt', () => {
    expect(parseRetryAfterMs('86400', NOW)).toBe(RATE_LIMIT_MAX_DELAY_MS)
  })
})

describe('parseRetryAfterMs — HTTP-Datum', () => {
  it('Datum in der Zukunft ergibt die Differenz', () => {
    expect(parseRetryAfterMs('Wed, 05 Aug 2026 12:02:00 GMT', NOW)).toBe(120_000)
  })

  it('Datum in der Vergangenheit ergibt die Untergrenze, nicht null', () => {
    expect(parseRetryAfterMs('Wed, 05 Aug 2026 11:00:00 GMT', NOW)).toBe(RATE_LIMIT_MIN_DELAY_MS)
  })

  it('weit entferntes Datum wird gedeckelt', () => {
    expect(parseRetryAfterMs('Thu, 06 Aug 2026 12:00:00 GMT', NOW)).toBe(RATE_LIMIT_MAX_DELAY_MS)
  })
})

describe('parseRetryAfterMs — kein verwertbarer Header', () => {
  it('fehlender Header → null', () => {
    expect(parseRetryAfterMs(null, NOW)).toBeNull()
    expect(parseRetryAfterMs(undefined, NOW)).toBeNull()
  })

  it('leerer String → null', () => {
    expect(parseRetryAfterMs('   ', NOW)).toBeNull()
  })

  it('Muell → null', () => {
    expect(parseRetryAfterMs('bald', NOW)).toBeNull()
  })

  it('negative Sekunden sind keine gueltige Delta-Form und kein Datum → null', () => {
    expect(parseRetryAfterMs('-30', NOW)).toBeNull()
  })

  it('Zahlformate ausserhalb der Spec werden nicht als Sekunden gelesen', () => {
    // '1e3' und '0x10' wuerde Number() akzeptieren — die Spec kennt an dieser
    // Stelle nur nicht-negative Ganzzahlen.
    expect(parseRetryAfterMs('1e3', NOW)).toBeNull()
    expect(parseRetryAfterMs('0x10', NOW)).toBeNull()
  })
})

describe('rateLimitDelayMs', () => {
  it('verwertbarer Header gewinnt gegen den Fallback', () => {
    expect(rateLimitDelayMs('90', NOW, 600_000)).toBe(90_000)
  })

  it('ohne Header greift der Default-Fallback (Fensterlaenge der Cloud)', () => {
    expect(rateLimitDelayMs(null, NOW)).toBe(RATE_LIMIT_FALLBACK_DELAY_MS)
  })

  it('eigener Fallback wird uebernommen', () => {
    expect(rateLimitDelayMs(undefined, NOW, 30_000)).toBe(30_000)
  })

  it('eigener Fallback wird ebenfalls gedeckelt', () => {
    // backoffMs() liefert im Push-Pfad bis zu 6 h — der Deckel muss auch dann
    // greifen, wenn die Wartezeit gar nicht aus dem Header stammt.
    expect(rateLimitDelayMs(undefined, NOW, 6 * 3600_000)).toBe(RATE_LIMIT_MAX_DELAY_MS)
  })

  it('eigener Fallback unterhalb der Untergrenze wird angehoben', () => {
    expect(rateLimitDelayMs(undefined, NOW, 100)).toBe(RATE_LIMIT_MIN_DELAY_MS)
  })
})
