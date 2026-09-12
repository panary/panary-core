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
  /** Ersetzt den Standard-Mock (Seiten-Umschlag `{ data }`) durch eine eigene Antwort. */
  findExceptionsImpl?: () => Promise<unknown>
}

const buildContext = (scheduledFor: string | undefined, opts: ContextOptions = {}) => {
  const {
    enabled = true,
    tz = 'Europe/Berlin',
    regular = BERLIN_10_22,
    exceptions = [],
    locationId = 'loc1',
    userLocationId = null,
    findExceptionsImpl,
  } = opts

  const location = {
    settings: {
      generalSettings: { timezone: tz },
      openingHoursSettings: { enabled, regular },
    },
  }
  const findExceptions = findExceptionsImpl
    ? vi.fn().mockImplementation(findExceptionsImpl)
    : vi.fn().mockResolvedValue({ data: exceptions })
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
      expect.objectContaining({ query: { date: '2026-07-16', tenantId: 't1', locationId: 'loc1' } }),
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
      exceptions: [{ date: '2026-07-16', closed: true, locationId: 'loc1' }],
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
      expect.objectContaining({ query: { date: '2026-06-20', tenantId: 't1', locationId: 'loc1' } }),
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

describe('validatePreOrderOpeningHours — vollständige Ausnahmen-Menge', () => {
  pinServerTimeZone('UTC', { instant: '2026-06-20T09:00:00.000Z', localHour: 9 })

  /**
   * Der Service reicht `paginate` aus `apps/api-edge/config/default.json` an den
   * Adapter durch (`default` 50) — ohne `paginate: false` liefert Feathers still
   * die erste Seite. Die Tests halten das Flag und den Antwort-Typ fest, den es
   * auslöst.
   *
   * Der zu panary/panary-core#282 verworfene Mengen-Test („mehr als 50 Ausnahmen am
   * selben Datum, die passende greift trotzdem") steht seit #286 in der Gruppe
   * „filialgenaue Auswahl" — er ließ sich erst bauen, als die Auswahl überhaupt ein
   * Kriterium hatte: Solange nur nach `date` gefiltert wurde, trugen alle Treffer
   * dieses Datum und `getOpeningHoursForDate` nahm die erste, eine abgeschnittene
   * Seite lieferte also dieselbe Entscheidung wie die vollständige Liste (derselbe
   * Aufbau war mit und ohne Flag rot).
   *
   * ⚠️ Auch der neue Test paginiert nicht selbst — der Mock liefert, was er soll. Was
   * er belegt, ist die Unabhängigkeit der Auswahl von der Position in der Liste; dass
   * die Liste vollständig angefordert wird, belegt die Flag-Assertion hier.
   */
  it('fordert die Ausnahmen ohne Paginierung an', async () => {
    const { ctx, findExceptions } = buildContext('2026-06-20T09:00:00.000Z')

    await validatePreOrderOpeningHours(ctx)

    expect(findExceptions).toHaveBeenCalledWith(expect.objectContaining({ paginate: false }))
  })

  it('verarbeitet die Array-Antwort, die `paginate: false` auslöst', async () => {
    // Mit dem Flag liefert Feathers ein nacktes Array statt `{ data, total, limit,
    // skip }`. Alle übrigen Tests mocken den Umschlag — ohne diesen Fall bliebe der
    // produktive Zweig ungetestet.
    const { ctx } = buildContext('2026-06-20T09:00:00.000Z', {
      findExceptionsImpl: async () => [{ date: '2026-06-20', closed: true, locationId: 'loc1' }],
    })

    await expect(validatePreOrderOpeningHours(ctx)).rejects.toThrow(/an diesem Tag geschlossen/)
  })
})

describe('validatePreOrderOpeningHours — filialgenaue Auswahl', () => {
  pinServerTimeZone('UTC', { instant: '2026-06-20T09:00:00.000Z', localHour: 9 })

  // Der Termin: Samstag, 20.06.2026, 11:00 Berlin. Regulär (BERLIN_10_22) ist
  // geöffnet — jede Ablehnung kommt also aus einer Ausnahme, jede Annahme daraus,
  // dass keine für DIESE Filiale gilt.
  const SA_1100_BERLIN = '2026-06-20T09:00:00.000Z'

  /** Ausnahme einer anderen Filiale desselben Mandanten. */
  const foreign = (over: Record<string, unknown> = {}) => ({
    date: '2026-06-20',
    closed: true,
    locationId: 'loc2',
    ...over,
  })

  /** Ausnahme der Filiale, für die vorbestellt wird. */
  const own = (over: Record<string, unknown> = {}) => ({
    date: '2026-06-20',
    closed: true,
    locationId: 'loc1',
    ...over,
  })

  it('fragt die Ausnahmen der aufgelösten Filiale ab', async () => {
    const { ctx, findExceptions } = buildContext(SA_1100_BERLIN)

    await validatePreOrderOpeningHours(ctx)

    expect(findExceptions).toHaveBeenCalledWith(
      expect.objectContaining({ query: { date: '2026-06-20', tenantId: 't1', locationId: 'loc1' } }),
    )
  })

  it('nimmt die Filiale aus dem User, wenn die Bestellung keine trägt', async () => {
    // `locationId` im Data ist der Normalfall (multiTenancy stempelt), der
    // User-Fallback des Hooks darf aber nicht die alte, filialblinde Query bauen.
    const { ctx, findExceptions } = buildContext(SA_1100_BERLIN, { locationId: null, userLocationId: 'loc9' })

    await validatePreOrderOpeningHours(ctx)

    expect(findExceptions).toHaveBeenCalledWith(
      expect.objectContaining({ query: { date: '2026-06-20', tenantId: 't1', locationId: 'loc9' } }),
    )
  })

  it('lässt die „geschlossen"-Ausnahme einer fremden Filiale nicht greifen', async () => {
    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: [foreign()] })
    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('lässt die eigene „geschlossen"-Ausnahme greifen', async () => {
    // Gegenprobe zum Test davor: Ohne sie wäre er auch mit einer Fassung grün,
    // die Ausnahmen gar nicht mehr auswertet.
    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: [own()] })
    await expect(validatePreOrderOpeningHours(ctx)).rejects.toThrow(/an diesem Tag geschlossen/)
  })

  it('entscheidet über den Inhalt, nicht über die Position in der Liste', async () => {
    // Beide Zeilen tragen dasselbe Datum, die fremde steht zuerst — genau die
    // Reihenfolge, in der `getOpeningHoursForDate` vorher die falsche nahm. Die
    // eigene Zeile öffnet 10:00–22:00, die fremde nur 06:00–07:00.
    const { ctx } = buildContext(SA_1100_BERLIN, {
      exceptions: [
        foreign({ closed: false, open: '06:00', close: '07:00' }),
        own({ closed: false, open: '10:00', close: '22:00' }),
      ],
    })

    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
  })

  it('entscheidet auch bei vertauschten Rollen über den Inhalt', async () => {
    // Spiegelbild: Jetzt öffnet die FREMDE Zeile weit und die eigene nur früh
    // morgens. Ein Test, der bloß „nimm die zweite" belegte, wäre hier grün — die
    // Meldung muss die Zeiten der eigenen Filiale nennen.
    const { ctx } = buildContext(SA_1100_BERLIN, {
      exceptions: [
        foreign({ closed: false, open: '10:00', close: '22:00' }),
        own({ closed: false, open: '06:00', close: '07:00' }),
      ],
    })

    await expect(validatePreOrderOpeningHours(ctx)).rejects.toThrow(/06:00 bis 07:00/)
  })

  it('protokolliert verworfene Fremd-Zeilen — die Query hätte sie nicht liefern dürfen', async () => {
    vi.mocked(logger.warn).mockClear()

    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: [foreign(), own({ closed: false })] })
    await validatePreOrderOpeningHours(ctx)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'pre-orders.opening-hours.foreign-exceptions-skipped',
        locationId: 'loc1',
        loaded: 2,
        kept: 1,
      }),
    )
  })

  it('schweigt, wenn nichts zu verwerfen war', async () => {
    vi.mocked(logger.warn).mockClear()

    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: [own({ closed: false })] })
    await validatePreOrderOpeningHours(ctx)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('verwirft eine Zeile ohne Filiale statt sie tenant-weit gelten zu lassen', async () => {
    // Bewusste Entscheidung (panary/panary-core#286): Tenant-weite Ausnahmen kann
    // es nicht geben — `baseSchema.locationId` ist ein Pflicht-`uuid`, und erzeugt
    // werden die Zeilen ausschließlich pro Filiale. Eine solche Zeile wäre also ein
    // Fund und kein gültiger Feiertag; sie darf nicht still durchgreifen.
    //
    // ⚠️ Wer das ändert, ändert Fachverhalten: Der Termin ist dann geschlossen statt
    // offen. `.claude/rules/data-models.md` §1 beschreibt `locationId: null` als
    // „globale Daten" — für DIESEN Service trifft das nicht zu.
    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: [{ date: '2026-06-20', closed: true }] })

    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pre-orders.opening-hours.foreign-exceptions-skipped' }),
    )
  })

  it('findet die eigene Zeile auch jenseits der Seitengrenze von 50', async () => {
    // Der zu #282 verworfene Mengen-Test, jetzt mit Aussage: 60 fremde Zeilen vor
    // der eigenen. Ohne `paginate: false` käme die eigene nie an, ohne Filial-Filter
    // griffe die erste fremde.
    const many = [...Array.from({ length: 60 }, () => foreign({ closed: false, open: '06:00', close: '07:00' })), own()]
    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: many })

    await expect(validatePreOrderOpeningHours(ctx)).rejects.toThrow(/an diesem Tag geschlossen/)
  })

  it('bleibt bei 60 reinen Fremd-Zeilen auf den regulären Zeiten', async () => {
    // Gegenprobe: Dieselbe Menge ohne eigene Zeile darf den Termin nicht kippen.
    const many = Array.from({ length: 60 }, () => foreign())
    const { ctx } = buildContext(SA_1100_BERLIN, { exceptions: many })

    await expect(validatePreOrderOpeningHours(ctx)).resolves.toBe(ctx)
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
