import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { logger } from '@panary/shared-backend'

import { businessDateForLocation } from './business-day-date'
import { rotateBusinessDay, shouldAutoRotate, type LocationRecord } from './business-day.utils'

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

  const rotatesAt = (isoInstant: string, location = berlin, currentBusinessDay = nightShift) =>
    shouldAutoRotate(currentBusinessDay, businessDateForLocation(location, new Date(isoInstant)))

  /** Was dieselbe Stelle vor #154 gerechnet hat. */
  const rotatedBeforeFix = (isoInstant: string, currentBusinessDay = nightShift) =>
    shouldAutoRotate(currentBusinessDay, new Date(isoInstant).toISOString().slice(0, 10))

  // Die Grenze liegt jetzt an der lokalen Mitternacht — vorher an 02:00 Ortszeit,
  // weil dort der UTC-Tag umsprang. Das ist der eigentliche Inhalt von #154:
  // dieselbe Grenze, die die Cloud beim Stempeln von `date` benutzt.
  it('rotiert an der lokalen Mitternacht statt an der von UTC', () => {
    expect(rotatesAt('2026-07-29T23:59:59+02:00')).toBe(false)
    expect(rotatesAt('2026-07-30T00:00:00+02:00')).toBe(true)

    // Vorher sprang die Grenze zwei Stunden spaeter, mitten in der Nacht:
    expect(rotatedBeforeFix('2026-07-30T00:00:00+02:00')).toBe(false)
    expect(rotatedBeforeFix('2026-07-30T01:59:59+02:00')).toBe(false)
    expect(rotatedBeforeFix('2026-07-30T02:00:00+02:00')).toBe(true)
  })

  // ⚠️ Ausdruecklich festgehalten, weil das Issue hier eine andere Erwartung
  // hatte („Nachtbetrieb laeuft damit durch"): Die Zeitzonen-Korrektur allein
  // beendet die Aufspaltung eines Nachtbetriebs NICHT. Sie verschiebt die Grenze
  // in CEST von 02:00 auf 00:00, das Fenster wird also groesser statt kleiner.
  // Was einen 18:00 → 04:00-Betrieb wirklich durchlaufen laesst, ist die
  // Mindest-Laufzeit aus der offenen Frage des Issues — bewusst nicht Teil
  // dieser Aenderung.
  it('beendet die Aufspaltung eines Nachtbetriebs 18:00 → 04:00 NICHT', () => {
    for (const at of ['2026-07-30T00:30:00+02:00', '2026-07-30T02:00:00+02:00', '2026-07-30T04:00:00+02:00']) {
      expect(rotatesAt(at)).toBe(true)
    }
    // Praktisch wirksam wird das nur bei `hasActiveOrders === false` — im
    // laufenden Nachtbetrieb greift davor der Block-Zweig.
  })

  it('rotiert am regulären Tageswechsel weiterhin', () => {
    expect(rotatesAt('2026-07-29T18:00:00+02:00')).toBe(false) // am eigenen Tag
    expect(rotatesAt('2026-07-31T09:00:00+02:00')).toBe(true) // zwei Tage spaeter
  })

  it('rotiert ohne Geschäftstag immer', () => {
    expect(rotatesAt('2026-07-29T18:00:00+02:00', berlin, null)).toBe(true)
  })

  it('fällt ohne gepflegte Zeitzone auf Europe/Berlin zurück statt auf UTC', () => {
    // 22:30 UTC = 00:30 Berlin → Berlin-Fallback rotiert, UTC nicht.
    const at = '2026-07-29T22:30:00Z'
    expect(rotatedBeforeFix(at)).toBe(false)
    expect(rotatesAt(at, {} as typeof berlin)).toBe(true)
    expect(rotatesAt(at, { settings: { generalSettings: {} } } as typeof berlin)).toBe(true)
    expect(rotatesAt(at, { settings: { generalSettings: { timezone: 'Quatsch' } } })).toBe(true)
  })

  // Eine Filiale in einer anderen Zone bekommt ihren eigenen Tageswechsel — der
  // Punkt, an dem ein fest verdrahteter Fallback nicht mehr reichen wuerde.
  it('respektiert eine abweichende Filial-Zeitzone', () => {
    const auckland = { settings: { generalSettings: { timezone: 'Pacific/Auckland' } } }

    expect(rotatesAt('2026-07-29T11:00:00Z', auckland)).toBe(false) // dort noch der 29. um 23:00
    expect(rotatesAt('2026-07-29T12:00:00Z', auckland)).toBe(true) // dort schon der 30. um 00:00
    // Zur selben Sekunde ist es in Berlin noch der 29. — der Fallback haette hier
    // also das falsche Ergebnis geliefert.
    expect(rotatesAt('2026-07-29T12:00:00Z', berlin)).toBe(false)
  })
})
