import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequest } from '@feathersjs/errors'

// `@feathersjs/errors` bleibt echt (wir asserten auf den Fehlertyp). Alle
// `@panary/<domain>/domain`-Module werden gemockt, damit Vitest keine
// Domain-Source kompilieren muss.
vi.mock('@panary/users/domain', () => ({}))
vi.mock('@panary/locations/domain', () => ({}))
vi.mock('@panary/cloud-connection/domain', () => ({
  PairingStatus: { CONNECTED: 'connected' },
}))
vi.mock('@panary/shared-common', () => ({
  AppError: {
    LOCATION_NOT_ASSIGNED: 'LOCATION_NOT_ASSIGNED',
    AUTH_UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED',
    BUSINESS_DAY_NOT_SET: 'BUSINESS_DAY_NOT_SET',
    BUSINESS_DAY_TOO_OLD: 'BUSINESS_DAY_TOO_OLD',
    BUSINESS_DAY_OPEN_TOO_LONG: 'BUSINESS_DAY_OPEN_TOO_LONG',
  },
  AppErrorMessages: {
    LOCATION_NOT_ASSIGNED: 'Keine Filiale zugewiesen',
    AUTH_UNAUTHENTICATED: 'Nicht authentifiziert',
    BUSINESS_DAY_NOT_SET: 'Kein Geschäftstag',
    BUSINESS_DAY_TOO_OLD: 'Geschäftstag zu alt',
    BUSINESS_DAY_OPEN_TOO_LONG: 'Geschäftstag zu lange offen',
  },
}))
vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// Reine Helfer aus den utils werden gemockt — sie sind in business-day.utils.ts
// separat zu testen; hier interessiert nur die Hook-Orchestrierung.
const shouldAutoRotate = vi.fn()
const rotateBusinessDay = vi.fn()
const hasActiveOrders = vi.fn()
const getHoursSince = vi.fn()
const loadBusinessDayRuntime = vi.fn()
vi.mock('../utils/business-day.utils', () => ({
  shouldAutoRotate: (...a: unknown[]) => shouldAutoRotate(...a),
  rotateBusinessDay: (...a: unknown[]) => rotateBusinessDay(...a),
  hasActiveOrders: (...a: unknown[]) => hasActiveOrders(...a),
  loadBusinessDayRuntime: (...a: unknown[]) => loadBusinessDayRuntime(...a),
}))

import { restrictOrderToBusinessDay } from './restrict-order-to-business-day'

// Stub-App: ein User mit activeLocationId, eine Location und optional eine
// cloud-connection. `system.mode` ist nur noch Reporting — der Hook darf ihn
// nicht mehr auswerten; die Spec spiegelt deshalb jeden Fall ueber BEIDE Modi.
function makeContext(opts: {
  systemMode?: string
  location?: any
  cloudConnection?: any
  data?: any
  /** `null` simuliert einen User ohne zugewiesene Filiale. */
  userActiveLocationId?: string | null
  /** Rueckgabe von `locations.find()` fuer den Eindeutigkeits-Fallback. */
  locationList?: Array<{ _id: string }>
  /** Config-Wert der Altersgrenze; `undefined` = Hauskonstante 26. */
  maxBusinessDayOpenHours?: number
  /** Rueckgabe von `businessdays.get()` — steuert Zeitstempel und Betriebsart. */
  businessDay?: { openedAt?: string; operationMode?: string }
}): any {
  const services: Record<string, any> = {
    users: {
      get: vi.fn().mockResolvedValue({
        activeLocationId: opts.userActiveLocationId === undefined ? 'loc-1' : opts.userActiveLocationId,
      }),
    },
    locations: {
      get: vi.fn().mockResolvedValue(opts.location ?? { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null }),
      find: vi.fn().mockImplementation(() => {
        const all = opts.locationList ?? [{ _id: 'loc-1' }]
        // Der Hook liest `total`, um Mehrdeutigkeit zu erkennen, und `$limit: 2`
        // kappt `data` — der Stub bildet beides nach.
        return Promise.resolve({ data: all.slice(0, 2), total: all.length })
      }),
    },
    'cloud-connection': {
      find: vi.fn().mockResolvedValue(opts.cloudConnection ? [opts.cloudConnection] : []),
    },
    businessdays: {
      get: vi.fn().mockResolvedValue(opts.businessDay ?? { openedAt: new Date().toISOString() }),
    },
  }
  return {
    app: {
      get: (key: string) => {
        if (key === 'system') return { mode: opts.systemMode ?? 'standalone' }
        if (key === 'maxBusinessDayOpenHours') return opts.maxBusinessDayOpenHours
        return undefined
      },
      service: (path: string) => services[path],
    },
    params: { user: { _id: 'user-1' } },
    data: opts.data ?? {},
    // Nur fuer Assertions in den Tests — der Hook nutzt das nicht.
    __services: services,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` loescht Aufrufe, NICHT Implementierungen — ohne diesen
  // Default schleppt ein `mockReturnValue(48)` aus einem Test die Altersgrenze
  // in alle folgenden. Seit die Grenze in JEDEM Pfad geprueft wird (ADR 0047,
  // vorher nur im Aktive-Orders-Zweig), waere das ein stiller Fehlschlag.
  getHoursSince.mockReturnValue(1)

  // `loadBusinessDayRuntime` ist der gemeinsame Loader von Rotations-Guard und
  // Altersgrenze; er selbst ist in `business-day.utils.spec.ts` abgedeckt. Hier
  // steht er nur als duenne Attrappe, damit die beiden bestehenden Test-Stellhebel
  // — `businessDay: { openedAt, operationMode }` und `getHoursSince` — weiter das
  // tun, was ihre Namen sagen.
  loadBusinessDayRuntime.mockImplementation(async (app: any, businessDayId: string) => {
    const day = await app.service('businessdays').get(businessDayId, { provider: undefined })
    return {
      openHours: day.openedAt ? getHoursSince(day.openedAt) : null,
      operationMode: day.operationMode,
    }
  })
})

// Jeder Fall laeuft ueber beide System-Modi mit IDENTISCHER Erwartung. Das ist
// die eigentliche Regression-Absicherung: seit der Entkopplung entscheidet
// allein der Pairing-Zustand, `system.mode` darf keinen Einfluss mehr haben.
describe.each(['standalone', 'connected'])('restrictOrderToBusinessDay (systemMode=%s)', systemMode => {
  it('lässt einen offenen Geschäftstag passieren und stempelt die businessDayId', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = makeContext({
      systemMode,
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-1', date: new Date().toISOString().slice(0, 10) },
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-1')
  })

  it('wirft BadRequest, wenn kein Geschäftstag gesetzt ist (keine Rotation nötig)', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = makeContext({
      systemMode,
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
  })

  it('rotiert ohne Pairing automatisch und stempelt die neue businessDayId', async () => {
    shouldAutoRotate.mockReturnValue(true)
    rotateBusinessDay.mockResolvedValue('bd-new')
    const ctx = makeContext({
      systemMode,
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(rotateBusinessDay).toHaveBeenCalledTimes(1)
    expect(ctx.data.businessDayId).toBe('bd-new')
  })

  it('blockiert bei aktivem Pairing ohne Override, wenn gar kein Tag eröffnet ist', async () => {
    shouldAutoRotate.mockReturnValue(true)
    const ctx = makeContext({
      systemMode,
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
      cloudConnection: { pairingStatus: 'connected', offlineOverrideActiveUntil: null },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('nennt im gepairten Betrieb den Cloud-Admin als Handlungsort', async () => {
    shouldAutoRotate.mockReturnValue(true)
    const ctx = makeContext({
      systemMode,
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
      cloudConnection: { pairingStatus: 'connected', offlineOverrideActiveUntil: null },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toThrow(/Cloud-Admin/)
  })

  it('rotiert bei aktivem Pairing MIT gültigem Offline-Override', async () => {
    shouldAutoRotate.mockReturnValue(true)
    rotateBusinessDay.mockResolvedValue('bd-override')
    const ctx = makeContext({
      systemMode,
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
      cloudConnection: {
        pairingStatus: 'connected',
        offlineOverrideActiveUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(rotateBusinessDay).toHaveBeenCalledTimes(1)
    expect(ctx.data.businessDayId).toBe('bd-override')
  })

  it('verweigert die Rotation bei aktiven Bestellungen und zu lange offenem Tag', async () => {
    shouldAutoRotate.mockReturnValue(true)
    hasActiveOrders.mockResolvedValue(true)
    // ensureBusinessDayNotOpenTooLong wirft, weil getHoursSince > maxOpenHours.
    getHoursSince.mockReturnValue(48)
    const ctx = makeContext({
      systemMode,
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-old', date: '2026-05-01' },
      },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
  })

  // Der Eindeutigkeits-Fallback ersetzt den frueheren `system.mode === 'standalone'`-
  // Gate. Ohne diese Tests waere auf einem gepairten Edge jede Bestellung eines
  // Users ohne activeLocationId mit LOCATION_NOT_ASSIGNED gescheitert.
  it('löst die Location auf, wenn der User keine activeLocationId hat und genau EINE Location existiert', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = makeContext({
      systemMode,
      userActiveLocationId: null,
      locationList: [{ _id: 'loc-1' }],
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-1', date: new Date().toISOString().slice(0, 10) },
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-1')
    // Ohne `$sort` liefert SQLite eine formal beliebige Zeile — die Zuordnung
    // waere dann nicht reproduzierbar.
    expect(ctx.__services.locations.find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ $limit: 2, $sort: { _id: 1 } }),
      }),
    )
  })

  // Bewusst KEIN Abbruch: eine stehende Kasse ist operativ schlimmer als eine
  // eindeutige, aber moeglicherweise ungewollte Zuordnung. Vor diesem Fix
  // haetten Bestellungen auf Multi-Location-Edges schlicht aufgehoert zu
  // funktionieren, wo sie vorher liefen.
  it('ordnet bei MEHREREN Locations deterministisch die erste zu, statt abzubrechen', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = makeContext({
      systemMode,
      userActiveLocationId: null,
      locationList: [{ _id: 'loc-1' }, { _id: 'loc-2' }],
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-1', date: new Date().toISOString().slice(0, 10) },
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-1')
    expect(ctx.__services.locations.get).toHaveBeenCalledWith('loc-1', expect.anything())
  })

  it('wirft BadRequest, wenn der User keine activeLocationId hat und KEINE Location existiert', async () => {
    const ctx = makeContext({
      systemMode,
      userActiveLocationId: null,
      locationList: [],
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
  })
})

// Der Kern von panary-cloud ADR 0047. Vorher sperrte der gepairte Betrieb, sobald
// `currentBusinessDay.date !== today` — mit `today` aus `toISOString()`, also UTC,
// waehrend die Cloud in Filial-Lokalzeit stempelt. In CEST sprang die Sperre damit
// um 02:00 Ortszeit, und ein gepairter Edge konnte keinen Geschaeftstag ueber
// Mitternacht betreiben.
describe('Altersgrenze im gepairten Betrieb (Stunden statt Kalendertage)', () => {
  const connected = { pairingStatus: 'connected', offlineOverrideActiveUntil: null }
  /** Gestriges Datum — vor dem Fix allein schon ein Sperrgrund. */
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)

  const pairedContext = (over: Record<string, unknown> = {}) =>
    makeContext({
      systemMode: 'connected',
      cloudConnection: connected,
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-night', date: yesterday },
        ...((over.location as object) ?? {}),
      },
      ...over,
    })

  it('lässt einen Übernacht-Betrieb 18:00 → 04:00 durch (10 h offen, Datum von gestern)', async () => {
    shouldAutoRotate.mockReturnValue(true) // Datum ≠ heute
    getHoursSince.mockReturnValue(10)
    const ctx = pairedContext()

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-night')
    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('lässt auch dicht unter der Schwelle durch (25 h bei Grenze 26)', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(25)
    const ctx = pairedContext()

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-night')
  })

  it('sperrt einen Tag von vorgestern (50 h) mit BUSINESS_DAY_TOO_OLD', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(50)
    const ctx = pairedContext()

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toMatchObject({
      data: { code: 'BUSINESS_DAY_TOO_OLD', openHours: 50, maxAllowedOpenHours: 26 },
    })
  })

  it('sperrt knapp oberhalb der Schwelle (27 h bei Grenze 26)', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(27)

    await expect(restrictOrderToBusinessDay()(pairedContext())).rejects.toBeInstanceOf(BadRequest)
  })

  it('nennt Datum, Laufzeit und Grenze in der Meldung', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(50)

    await expect(restrictOrderToBusinessDay()(pairedContext())).rejects.toThrow(
      new RegExp(`${yesterday}.*50 Stunden.*26 Stunden`),
    )
  })

  it('sagt im Bestellbetrieb „Betriebstag beenden" statt „Tagesabschluss"', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(50)
    const ctx = pairedContext({ businessDay: { openedAt: '2026-08-08T18:00:00.000Z', operationMode: 'orders-only' } })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toThrow(/Betriebstag beenden/)
  })

  it('sagt im Kassenbetrieb „Tagesabschluss"', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(50)
    const ctx = pairedContext({ businessDay: { openedAt: '2026-08-08T18:00:00.000Z', operationMode: 'pos-cashier' } })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toThrow(/Tagesabschluss/)
  })

  it('lässt durch, wenn kein brauchbarer Zeitstempel existiert (fail-open, laut)', async () => {
    shouldAutoRotate.mockReturnValue(true)
    const ctx = pairedContext({ businessDay: {} }) // kein openedAt

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-night')
  })
})

describe('Standort-Override der Altersgrenze', () => {
  const connected = { pairingStatus: 'connected', offlineOverrideActiveUntil: null }
  const withOverride = (maxOpenHours?: number, configValue?: number) =>
    makeContext({
      systemMode: 'connected',
      cloudConnection: connected,
      maxBusinessDayOpenHours: configValue,
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-1', date: '2026-08-08' },
        settings: maxOpenHours === undefined ? {} : { businessDaySettings: { maxOpenHours } },
      },
    })

  it('übersteuert den Default nach OBEN (Grenze 48 statt 26)', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(40)
    const ctx = withOverride(48)

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-1')
  })

  it('übersteuert den Default nach UNTEN (Grenze 12 statt 26)', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(20)

    await expect(restrictOrderToBusinessDay()(withOverride(12))).rejects.toMatchObject({
      data: { maxAllowedOpenHours: 12 },
    })
  })

  it('fällt auf den Config-Wert zurück, wenn der Standort nichts gesetzt hat', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(40)

    await expect(restrictOrderToBusinessDay()(withOverride(undefined, 30))).rejects.toMatchObject({
      data: { maxAllowedOpenHours: 30 },
    })
  })

  it('fällt auf die Hauskonstante 26 zurück, wenn auch die Config nichts liefert', async () => {
    shouldAutoRotate.mockReturnValue(true)
    getHoursSince.mockReturnValue(40)

    await expect(restrictOrderToBusinessDay()(withOverride(undefined, undefined))).rejects.toMatchObject({
      data: { maxAllowedOpenHours: 26 },
    })
  })

  // `settings` steht NICHT in `locationQueryProperties` — ein `$select` darauf
  // scheitert am Query-Validator („validation failed"). Deshalb liest der Hook
  // die Location voll und genau einmal, statt einen zweiten Call fuer die
  // Settings zu machen. Gemockte Service-Stubs sehen den Validator nicht; den
  // Fall haben die Integrationstests unter `test/services/orders/` gefangen.
  it('liest die Location genau einmal und ohne $select', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = withOverride(48)

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.__services.locations.get).toHaveBeenCalledTimes(1)
    const params = ctx.__services.locations.get.mock.calls[0][1]
    expect(params.query?.$select).toBeUndefined()
  })
})

// Der Mindest-Laufzeit-Guard selbst steckt in `shouldAutoRotate` (dort getestet).
// Hier interessiert nur, dass der Hook ihn ueberhaupt fuettert — und zwar aus
// demselben Read, aus dem auch die Altersgrenze rechnet.
describe('Laufzeit-Beschaffung für Rotations-Guard und Altersgrenze', () => {
  it('reicht die Laufzeit an shouldAutoRotate durch', async () => {
    shouldAutoRotate.mockReturnValue(false)
    getHoursSince.mockReturnValue(7)
    const ctx = makeContext({
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-night', date: '2026-07-29' },
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(loadBusinessDayRuntime).toHaveBeenCalledWith(expect.anything(), 'bd-night')
    expect(shouldAutoRotate.mock.calls[0][2]).toBe(7)
  })

  // Zwei getrennte Reads koennten in derselben Anfrage verschiedene Zahlen
  // liefern — und zwischen Guard (10 h) und Sperre (26 h) liegen nur 16 Stunden.
  it('liest den Geschäftstag genau einmal pro Anfrage', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = makeContext({
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-1', date: '2026-07-29' },
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(loadBusinessDayRuntime).toHaveBeenCalledTimes(1)
  })

  it('lädt nichts, wenn gar kein Geschäftstag gesetzt ist', async () => {
    shouldAutoRotate.mockReturnValue(true)
    rotateBusinessDay.mockResolvedValue('bd-neu')
    const ctx = makeContext({ location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null } })

    await restrictOrderToBusinessDay()(ctx)

    expect(loadBusinessDayRuntime).not.toHaveBeenCalled()
    expect(shouldAutoRotate.mock.calls[0][2]).toBeNull()
  })
})
