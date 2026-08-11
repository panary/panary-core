import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { logger } from '@panary/shared-backend'

import { businessDateForLocation } from './business-day-date'
import {
  loadBusinessDayRuntime,
  MIN_OPEN_HOURS_BEFORE_ROTATION,
  rotateBusinessDay,
  shouldAutoRotate,
  type LocationRecord,
} from './business-day.utils'

/**
 * Stub-App mit den drei Services, die `rotateBusinessDay` anfasst.
 * `businessdays.find` liefert die offenen Tage der Location.
 */
function makeApp(openDays: Array<{ _id: string }>) {
  const businessDayPatch = vi.fn().mockResolvedValue({})
  const businessDayCreate = vi.fn().mockResolvedValue({ _id: 'bd-new' })
  const businessDayFind = vi.fn().mockResolvedValue(openDays)
  const locationPatch = vi.fn().mockResolvedValue({})

  const app = {
    service: (path: string) => {
      if (path === 'businessdays') {
        return { find: businessDayFind, patch: businessDayPatch, create: businessDayCreate }
      }
      if (path === 'locations') return { patch: locationPatch }
      throw new Error(`unerwarteter Service: ${path}`)
    },
  }

  return { app, businessDayPatch, businessDayCreate, businessDayFind, locationPatch }
}

const location: LocationRecord = {
  _id: 'loc-1',
  tenantId: 't-1',
  currentBusinessDay: { businessDayId: 'bd-zeiger', date: '2026-07-30' },
}

const closedIds = (patch: ReturnType<typeof vi.fn>) => patch.mock.calls.map(call => call[0]).sort()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rotateBusinessDay', () => {
  it('schliesst alle offenen Tage der Location, nicht nur das Zeiger-Ziel', async () => {
    // Der Kern der Regression: der Zeiger stand auf bd-zeiger, bd-alt blieb
    // frueher fuer immer offen zurueck.
    const { app, businessDayPatch } = makeApp([{ _id: 'bd-zeiger' }, { _id: 'bd-alt' }])

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(closedIds(businessDayPatch)).toEqual(['bd-alt', 'bd-zeiger'])
    for (const call of businessDayPatch.mock.calls) {
      expect(call[1]).toMatchObject({ status: 'closed', isOpen: false })
      expect(call[2]).toMatchObject({ provider: undefined, isEmergencyOverride: true })
    }
  })

  it('schliesst das Zeiger-Ziel auch, wenn die Query es nicht liefert', async () => {
    const { app, businessDayPatch } = makeApp([{ _id: 'bd-alt' }])

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(closedIds(businessDayPatch)).toEqual(['bd-alt', 'bd-zeiger'])
  })

  it('schliesst jeden Tag genau einmal (Zeiger-Ziel ist auch in der Query)', async () => {
    const { app, businessDayPatch } = makeApp([{ _id: 'bd-zeiger' }])

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(businessDayPatch).toHaveBeenCalledTimes(1)
  })

  it('protokolliert mehrere offene Tage als Anomalie', async () => {
    const { app } = makeApp([{ _id: 'bd-zeiger' }, { _id: 'bd-alt' }])

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'business_day.multiple_open_days', openDayCount: 2 }),
    )
  })

  it('protokolliert nichts, wenn genau ein Tag offen ist', async () => {
    const { app } = makeApp([{ _id: 'bd-zeiger' }])

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('filtert die Query auf tenantId + locationId + status:open', async () => {
    const { app, businessDayFind } = makeApp([])

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(businessDayFind).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { tenantId: 't-1', locationId: 'loc-1', status: 'open' },
        provider: undefined,
      }),
    )
  })

  it('legt den neuen Tag an und zieht den Location-Zeiger nach', async () => {
    const { app, businessDayCreate, locationPatch } = makeApp([{ _id: 'bd-zeiger' }])

    const newId = await rotateBusinessDay(app, location, '2026-07-31')

    expect(newId).toBe('bd-new')
    // businessDayDataSchema erlaubt nur die drei Felder — sonst additionalProperties-Reject.
    expect(businessDayCreate).toHaveBeenCalledWith(
      { tenantId: 't-1', locationId: 'loc-1', date: '2026-07-31' },
      expect.objectContaining({ provider: undefined, isEmergencyOverride: true }),
    )
    expect(locationPatch).toHaveBeenCalledWith(
      'loc-1',
      { currentBusinessDay: { businessDayId: 'bd-new', date: '2026-07-31' } },
      expect.objectContaining({ provider: undefined, isEmergencyOverride: true }),
    )
  })

  it('kommt ohne Zeiger aus (erste Rotation nach Setup)', async () => {
    const { app, businessDayPatch, businessDayCreate } = makeApp([])

    await rotateBusinessDay(app, { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null }, '2026-07-31')

    expect(businessDayPatch).not.toHaveBeenCalled()
    expect(businessDayCreate).toHaveBeenCalledTimes(1)
  })

  it('akzeptiert auch ein paginiertes find-Ergebnis', async () => {
    const { app, businessDayFind, businessDayPatch } = makeApp([])
    businessDayFind.mockResolvedValue({ data: [{ _id: 'bd-alt' }] })

    await rotateBusinessDay(app, location, '2026-07-31')

    expect(closedIds(businessDayPatch)).toEqual(['bd-alt', 'bd-zeiger'])
  })
})

/**
 * `shouldAutoRotate` selbst ist unveraendert (Kalendertags-Vergleich), gefuettert
 * wird es seit #154 aber mit dem Kalendertag der FILIALE statt dem von UTC.
 * Getestet wird das Paar aus beidem — die Rotationsgrenze entsteht erst aus dem
 * Zusammenspiel.
 *
 * Bewusst als Pure-Function-Test mit uebergebenem Zeitpunkt: `process.env.TZ`
 * wirkt zur Laufzeit nicht mehr, Node bindet die Prozess-Zone beim Start.
 */
describe('Auto-Rotation am Kalendertag der Filiale', () => {
  const berlin = { settings: { generalSettings: { timezone: 'Europe/Berlin' } } }

  /** Geschaeftstag eines Nachtbetriebs, der am 29.07. um 18:00 CEST eroeffnet wurde. */
  const nightShift = { businessDayId: 'bd-night', date: '2026-07-29' }

  /** Eroeffnung des Nachtbetriebs — 29.07. 18:00 CEST. */
  const openedAt = new Date('2026-07-29T18:00:00+02:00').getTime()
  const hoursOpenAt = (isoInstant: string) => (new Date(isoInstant).getTime() - openedAt) / 3_600_000

  const rotatesAt = (isoInstant: string, location = berlin, currentBusinessDay = nightShift) =>
    shouldAutoRotate(
      currentBusinessDay,
      businessDateForLocation(location, new Date(isoInstant)),
      hoursOpenAt(isoInstant),
    )

  /** Was dieselbe Stelle vor #154 gerechnet hat — UTC-Tag, keine Mindest-Laufzeit. */
  const rotatedBeforeFix = (isoInstant: string, currentBusinessDay = nightShift) =>
    shouldAutoRotate(currentBusinessDay, new Date(isoInstant).toISOString().slice(0, 10))

  // Der Nachtbetrieb ist der Bezugsfall aus #154. Vorher wurde er um 02:00
  // Ortszeit geschnitten (UTC-Tageswechsel), sobald in dem Moment zufaellig keine
  // Bestellung offen war. Die Zeitzonen-Korrektur ALLEIN haette ihn sogar frueher
  // geschnitten — in CEST liegt die lokale Mitternacht VOR dem UTC-Wechsel. Erst
  // die Mindest-Laufzeit haelt ihn zusammen.
  it('schneidet einen Nachtbetrieb 18:00 → 04:00 nicht mehr auf', () => {
    expect(rotatesAt('2026-07-30T00:00:00+02:00')).toBe(false) // 6 h offen
    expect(rotatesAt('2026-07-30T02:00:00+02:00')).toBe(false) // 8 h — frueher der Schnitt
    expect(rotatesAt('2026-07-30T03:59:00+02:00')).toBe(false) // 9,98 h

    // Erst zum Betriebsende, exakt auf der Schwelle:
    expect(hoursOpenAt('2026-07-30T04:00:00+02:00')).toBe(MIN_OPEN_HOURS_BEFORE_ROTATION)
    expect(rotatesAt('2026-07-30T04:00:00+02:00')).toBe(true)

    // Beide frueheren Fassungen haetten mitten im Betrieb rotiert:
    expect(rotatedBeforeFix('2026-07-30T02:00:00+02:00')).toBe(true) // UTC-Tageswechsel
    expect(shouldAutoRotate(nightShift, '2026-07-30')).toBe(true) // nur Zeitzone, ohne Guard
  })

  // Die Zeitzone entscheidet weiterhin, WANN der Kalendertag wechselt — sichtbar
  // an einem Tag, der die Mindest-Laufzeit laengst hinter sich hat.
  it('legt den Tageswechsel auf die lokale Mitternacht, nicht auf die von UTC', () => {
    const morningShift = { businessDayId: 'bd-tag', date: '2026-07-29' }
    // Eroeffnet 29.07. 08:00 CEST — an jedem Pruefpunkt unten > 10 h offen.
    const rotates = (isoInstant: string) =>
      shouldAutoRotate(morningShift, businessDateForLocation(berlin, new Date(isoInstant)), 20)

    expect(rotates('2026-07-29T23:59:59+02:00')).toBe(false)
    expect(rotates('2026-07-30T00:00:00+02:00')).toBe(true)
    // Vorher sprang die Grenze erst zwei Stunden spaeter:
    expect(rotatedBeforeFix('2026-07-30T00:00:00+02:00', morningShift)).toBe(false)
    expect(rotatedBeforeFix('2026-07-30T02:00:00+02:00', morningShift)).toBe(true)
  })

  it('rotiert am regulären Tageswechsel weiterhin', () => {
    expect(rotatesAt('2026-07-29T20:00:00+02:00')).toBe(false) // am eigenen Tag
    expect(rotatesAt('2026-07-31T09:00:00+02:00')).toBe(true) // zwei Tage spaeter
  })

  // Ein mehrere Tage alter Tag ueberschreitet die Mindest-Laufzeit weit — der
  // Guard darf ihn nie festhalten, sonst liefe er in die 26-h-Sperre des
  // Order-Gates und wuerde Bestellungen ablehnen statt zu rotieren.
  it('haelt einen veralteten Geschäftstag nie fest', () => {
    expect(shouldAutoRotate({ businessDayId: 'bd-alt', date: '2026-05-01' }, '2026-07-30', 2000)).toBe(true)
  })

  it('rotiert ohne Geschäftstag immer', () => {
    expect(shouldAutoRotate(null, '2026-07-30', 0)).toBe(true)
    expect(shouldAutoRotate(undefined, '2026-07-30')).toBe(true)
  })

  // Fail-open: fehlt `openedAt`, entscheidet wieder allein der Kalendertag. Die
  // Altersgrenze ueberspringt denselben Datenfehler (`age_check_skipped`) — wuerde
  // der Guard hier blockieren, bliebe der Tag fuer immer offen und niemand haelt ihn auf.
  it('entscheidet ohne brauchbare Laufzeit allein am Kalendertag', () => {
    expect(shouldAutoRotate(nightShift, '2026-07-30', null)).toBe(true)
    expect(shouldAutoRotate(nightShift, '2026-07-30', undefined)).toBe(true)
    expect(shouldAutoRotate(nightShift, '2026-07-29', null)).toBe(false)
  })

  it('fällt ohne gepflegte Zeitzone auf Europe/Berlin zurück statt auf UTC', () => {
    // 22:30 UTC = 00:30 Berlin. Mit einem Tag jenseits der Mindest-Laufzeit
    // (`20`) ist allein die Zone der Unterschied.
    const at = new Date('2026-07-29T22:30:00Z')
    const rotates = (location: typeof berlin) => shouldAutoRotate(nightShift, businessDateForLocation(location, at), 20)

    expect(rotatedBeforeFix('2026-07-29T22:30:00Z')).toBe(false)
    expect(rotates({} as typeof berlin)).toBe(true)
    expect(rotates({ settings: { generalSettings: {} } } as typeof berlin)).toBe(true)
    expect(rotates({ settings: { generalSettings: { timezone: 'Quatsch' } } })).toBe(true)
  })

  // Eine Filiale in einer anderen Zone bekommt ihren eigenen Tageswechsel — der
  // Punkt, an dem ein fest verdrahteter Fallback nicht mehr reichen wuerde.
  it('respektiert eine abweichende Filial-Zeitzone', () => {
    const auckland = { settings: { generalSettings: { timezone: 'Pacific/Auckland' } } }
    const rotates = (isoInstant: string, location: typeof berlin) =>
      shouldAutoRotate(nightShift, businessDateForLocation(location, new Date(isoInstant)), 20)

    expect(rotates('2026-07-29T11:00:00Z', auckland)).toBe(false) // dort noch der 29. um 23:00
    expect(rotates('2026-07-29T12:00:00Z', auckland)).toBe(true) // dort schon der 30. um 00:00
    // Zur selben Sekunde ist es in Berlin noch der 29. — der Fallback haette hier
    // also das falsche Ergebnis geliefert.
    expect(rotates('2026-07-29T12:00:00Z', berlin)).toBe(false)
  })

  // Die offene Frage aus dem Issue: „Ein Tag, der um 23:55 eroeffnet wird,
  // rotiert sonst fuenf Minuten spaeter."
  it('rotiert einen um 23:55 eröffneten Tag nicht fünf Minuten später', () => {
    const lateDay = { businessDayId: 'bd-spaet', date: '2026-07-29' }

    expect(shouldAutoRotate(lateDay, '2026-07-30', 5 / 60)).toBe(false)
    expect(shouldAutoRotate(lateDay, '2026-07-30', MIN_OPEN_HOURS_BEFORE_ROTATION)).toBe(true)
  })
})

describe('loadBusinessDayRuntime', () => {
  const makeApp = (businessDay: Record<string, unknown>) => {
    const get = vi.fn().mockResolvedValue(businessDay)
    return { app: { service: () => ({ get }) }, get }
  }

  it('rechnet die Laufzeit aus openedAt und reicht die Betriebsart durch', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()
    const { app, get } = makeApp({ openedAt: twoHoursAgo, operationMode: 'orders-only' })

    const runtime = await loadBusinessDayRuntime(app, 'bd-1')

    expect(runtime.openHours).toBeCloseTo(2, 2)
    expect(runtime.operationMode).toBe('orders-only')
    expect(get).toHaveBeenCalledWith('bd-1', {
      query: { $select: ['openedAt', 'operationMode'] },
      provider: undefined,
    })
  })

  // Ein unbrauchbarer Zeitstempel darf keine Zahl vortaeuschen — `null` ist das
  // Signal, das Guard und Altersgrenze beide als „nicht messbar" lesen.
  it('liefert null ohne oder mit kaputtem openedAt', async () => {
    expect((await loadBusinessDayRuntime(makeApp({}).app, 'bd-1')).openHours).toBeNull()
    expect((await loadBusinessDayRuntime(makeApp({ openedAt: 'kein-datum' }).app, 'bd-1')).openHours).toBeNull()
  })
})
