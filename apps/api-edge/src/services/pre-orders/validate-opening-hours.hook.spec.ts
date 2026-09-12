import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { BadRequest } from '@feathersjs/errors'
import { logger } from '@panary/shared-backend'

import { validatePreOrderOpeningHours } from './validate-opening-hours.hook'
import type { HookContext } from '../../declarations'

/**
 * Öffnungszeiten sind Filial-lokale Wandzeiten, `scheduledFor` ist ein
 * UTC-Instant. Die Tests übergeben feste Instants und feste Zonen — nichts wird
 * aus der Uhr gelesen.
 *
 * Die Zone des **Prozesses** wird hier bewusst gepinnt, obwohl die Implementierung
 * von ihr unabhängig ist: Genau diese Unabhängigkeit ist die Aussage. Die frühere
 * Fassung projizierte über `new Date(instant.toLocaleString('en-US', { timeZone }))`,
 * und dieser Roundtrip liegt daneben, sobald die Wandzeit der Filiale in der
 * Serverzone nicht existiert (Sommerzeit-Lücke). In UTC — so läuft der
 * Edge-Container — fällt das nicht auf; ein Test unter UTC wäre also blind für
 * einen Rückfall.
 */

/** Alle Wochentage mit denselben Zeiten — das Ergebnis hängt dann nur an der Uhrzeit. */
const allDays = (open: string, close: string) => [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open, close, closed: false }))

const BERLIN_10_22 = allDays('10:00', '22:00')

interface ContextOptions {
  enabled?: boolean
  tz?: string
  regular?: unknown[]
  exceptions?: unknown[]
  locationId?: string | null
  userLocationId?: string | null
}

const buildContext = (scheduledFor: string | undefined, opts: ContextOptions = {}) => {
  const {
    enabled = true,
    tz = 'Europe/Berlin',
    regular = BERLIN_10_22,
    exceptions = [],
    locationId = 'loc1',
    userLocationId = null,
  } = opts

  const location = {
    settings: {
      generalSettings: { timezone: tz },
      openingHoursSettings: { enabled, regular },
    },
  }
  const findExceptions = vi.fn().mockResolvedValue({ data: exceptions })
  const app = {
    service: (path: string) => {
      if (path === 'locations') return { get: vi.fn().mockResolvedValue(location) }
      if (path === 'opening-hour-exceptions') return { find: findExceptions }
      throw new Error(`Unerwarteter Service-Lookup: ${path}`)
    },
  }

  const ctx = {
    app,
    data: { scheduledFor, tenantId: 't1', locationId },
    params: { user: { locationId: userLocationId } },
  } as unknown as HookContext

  return { ctx, findExceptions }
}

/**
 * Pinnt die Zeitzone des Testprozesses für eine `describe`-Gruppe.
 *
 * Node wertet eine Laufzeit-Änderung von `process.env.TZ` aus (gemessen mit
 * Node 22.17); `apps/api-edge/vitest.config.mts` fährt `fileParallelism: false`,
 * die Änderung überlappt also mit keiner anderen Suite. Die `probe` ist ein
 * Kanarienvogel: Greift das Pinnen in einer künftigen Node-Version nicht mehr,
 * schlägt sie an — sonst liefe der Regressionstest unter UTC weiter und wäre
 * still grün, ohne den Roundtrip-Fehler noch messen zu können.
 */
const pinServerTimeZone = (timeZone: string, probe: { instant: string; localHour: number }) => {
  let original: string | undefined

  beforeAll(() => {
    original = process.env.TZ
    process.env.TZ = timeZone
    expect(new Date(probe.instant).getHours()).toBe(probe.localHour)
  })

  afterAll(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })
}

describe('validatePreOrderOpeningHours — Serverzone UTC (wie der Edge-Container)', () => {
  pinServerTimeZone('UTC', { instant: '2026-06-20T09:00:00.000Z', localHour: 9 })

  it('akzeptiert 11:00 Berlin (= 09:00 UTC, Sommerzeit) bei Öffnung 10:00–22:00', async () => {
    const { ctx } = buildContext('2026-06-20T09:00:00.000Z')
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('lehnt 09:00 Berlin (= 07:00 UTC) vor der Öffnung ab', async () => {
    const { ctx } = buildContext('2026-06-20T07:00:00.000Z')
    await expect(validatePreOrderOpeningHours(ctx)).rejects.toBeInstanceOf(BadRequest)
  })

  it('akzeptiert 21:30 Berlin (= 19:30 UTC) noch innerhalb 10:00–22:00', async () => {
    const { ctx } = buildContext('2026-06-20T19:30:00.000Z')
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('rechnet im Winter mit UTC+1 statt UTC+2', async () => {
    // 10:00 UTC ist im Januar 11:00 CET — im Juni wären es 12:00 CEST.
    const { ctx } = buildContext('2026-01-15T10:00:00.000Z')
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('nimmt jenseits der Datumsgrenze den Filial-Wochentag, nicht den UTC-Wochentag', async () => {
    // 2026-07-15 21:30 UTC (Mittwoch) ist in Auckland (UTC+12) bereits
    // Donnerstag, 2026-07-16, 09:30. Geöffnet ist nur donnerstags.
    const { ctx, findExceptions } = buildContext('2026-07-15T21:30:00.000Z', {
      tz: 'Pacific/Auckland',
      regular: [{ day: 4, open: '09:00', close: '17:00', closed: false }],
    })

    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
    // Auch die Ausnahmen werden für den Filial-Kalendertag geladen — mit dem
    // UTC-Tag (15.07.) griffe eine Feiertagsausnahme des 16.07. nicht.
    expect(findExceptions).toHaveBeenCalledWith(
      expect.objectContaining({ query: { date: '2026-07-16', tenantId: 't1' } }),
    )
  })

  it('lehnt denselben Termin ab, wenn nur der UTC-Wochentag geöffnet wäre', async () => {
    // Gegenprobe zum Test davor: mittwochs geöffnet, donnerstags nicht.
    const { ctx } = buildContext('2026-07-15T21:30:00.000Z', {
      tz: 'Pacific/Auckland',
      regular: [{ day: 3, open: '09:00', close: '23:59', closed: false }],
    })
    await expect(validatePreOrderOpeningHours(ctx)).rejects.toBeInstanceOf(BadRequest)
  })

  it('wendet eine tagesgenaue Ausnahme auf den Filial-Kalendertag an', async () => {
    const { ctx } = buildContext('2026-07-15T21:30:00.000Z', {
      tz: 'Pacific/Auckland',
      regular: [{ day: 4, open: '09:00', close: '17:00', closed: false }],
      exceptions: [{ date: '2026-07-16', closed: true }],
    })
    await expect(validatePreOrderOpeningHours(ctx)).rejects.toThrow(/an diesem Tag geschlossen/)
  })
})

describe('validatePreOrderOpeningHours — Serverzone mit Sommerzeit (Regression)', () => {
  // Europe/Berlin springt am 29.03.2026 um 02:00 CET auf 03:00 CEST. Die Filiale
  // liegt in Asia/Dubai (UTC+4, keine Sommerzeit) und hat dort um 02:30 offen.
  pinServerTimeZone('Europe/Berlin', { instant: '2026-03-29T01:30:00.000Z', localHour: 3 })

  const DUBAI_0230 = '2026-03-28T22:30:00.000Z'
  const NACHTBETRIEB = allDays('00:00', '03:00')

  it('belegt, dass der frühere Roundtrip hier eine Stunde daneben liegt', async () => {
    const roundtrip = new Date(new Date(DUBAI_0230).toLocaleString('en-US', { timeZone: 'Asia/Dubai' }))

    // Die Wandzeit ist 02:30 — der Roundtrip parst sie in die Lücke der
    // Serverzone und liefert 03:30.
    expect(roundtrip.getHours()).toBe(3)
    expect(roundtrip.getMinutes()).toBe(30)
  })

  it('akzeptiert 02:30 Dubai bei Öffnung 00:00–03:00', async () => {
    const { ctx } = buildContext(DUBAI_0230, { tz: 'Asia/Dubai', regular: NACHTBETRIEB })
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('lehnt 03:30 Dubai nach Betriebsschluss ab', async () => {
    // Gegenprobe: Ohne sie wäre der Test davor auch mit einer Fassung grün, die
    // die Uhrzeit gar nicht prüft.
    const { ctx } = buildContext('2026-03-28T23:30:00.000Z', { tz: 'Asia/Dubai', regular: NACHTBETRIEB })
    await expect(validatePreOrderOpeningHours(ctx)).rejects.toBeInstanceOf(BadRequest)
  })
})

describe('validatePreOrderOpeningHours — Serverzone UTC+14', () => {
  // Zweite Serverzone, damit „unabhängig von der Serverzone" mehr als eine
  // Stichprobe ist: Kiritimati liegt 14 Stunden vor UTC, der Kalendertag des
  // Prozesses ist hier durchweg ein anderer als der UTC-Tag.
  pinServerTimeZone('Pacific/Kiritimati', { instant: '2026-06-20T09:00:00.000Z', localHour: 23 })

  it('akzeptiert 11:00 Berlin unverändert', async () => {
    const { ctx } = buildContext('2026-06-20T09:00:00.000Z')
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('akzeptiert 02:30 Dubai unverändert', async () => {
    const { ctx } = buildContext('2026-03-28T22:30:00.000Z', {
      tz: 'Asia/Dubai',
      regular: allDays('00:00', '03:00'),
    })
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('lädt die Ausnahmen weiterhin für den Filial-Kalendertag', async () => {
    const { ctx, findExceptions } = buildContext('2026-06-20T09:00:00.000Z')
    await validatePreOrderOpeningHours(ctx)
    // Serverzone: bereits der 21.06. Filialzeit: der 20.06.
    expect(findExceptions).toHaveBeenCalledWith(
      expect.objectContaining({ query: { date: '2026-06-20', tenantId: 't1' } }),
    )
  })
})

describe('validatePreOrderOpeningHours — mehrdeutige Wandzeit (Rückstellung)', () => {
  pinServerTimeZone('UTC', { instant: '2026-10-25T00:30:00.000Z', localHour: 0 })

  // Am 25.10.2026 springt Europe/Berlin um 03:00 CEST zurück auf 02:00 CET —
  // 02:30 Ortszeit gibt es zweimal. Beide Ausprägungen müssen als 02:30 gelten.
  const ERSTE_AUSPRAEGUNG = '2026-10-25T00:30:00.000Z' // 02:30 CEST
  const ZWEITE_AUSPRAEGUNG = '2026-10-25T01:30:00.000Z' // 02:30 CET

  it('akzeptiert beide Ausprägungen bei Öffnung 00:00–03:00', async () => {
    for (const instant of [ERSTE_AUSPRAEGUNG, ZWEITE_AUSPRAEGUNG]) {
      const { ctx } = buildContext(instant, { regular: allDays('00:00', '03:00') })
      await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
    }
  })

  it('lehnt beide Ausprägungen bei Öffnung 00:00–02:00 ab', async () => {
    for (const instant of [ERSTE_AUSPRAEGUNG, ZWEITE_AUSPRAEGUNG]) {
      const { ctx } = buildContext(instant, { regular: allDays('00:00', '02:00') })
      await expect(validatePreOrderOpeningHours(ctx)).rejects.toBeInstanceOf(BadRequest)
    }
  })
})

describe('validatePreOrderOpeningHours — No-Ops und Fehlkonfiguration', () => {
  pinServerTimeZone('UTC', { instant: '2026-06-20T09:00:00.000Z', localHour: 9 })

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  it('ist No-Op ohne scheduledFor', async () => {
    const { ctx } = buildContext(undefined)
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('ist No-Op ohne auflösbare Filiale', async () => {
    const { ctx } = buildContext('2026-06-20T02:00:00.000Z', { locationId: null, userLocationId: null })
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('ist No-Op bei deaktivierten Öffnungszeiten — auch nachts', async () => {
    const { ctx } = buildContext('2026-06-20T02:00:00.000Z', { enabled: false })
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('fällt bei unbekannter Zeitzone auf Europe/Berlin zurück statt zu werfen', async () => {
    // Eine über die Settings-UI gesetzte Falschangabe darf nicht jede
    // Vorbestellung der Filiale mit einem 500er quittieren.
    const { ctx } = buildContext('2026-06-20T09:00:00.000Z', { tz: 'Nicht/EineZone' })
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pre-orders.opening-hours.timezone-fallback' }),
    )
  })
})
