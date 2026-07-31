import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { logger } from '@panary/shared-backend'

import { rotateBusinessDay, type LocationRecord } from './business-day.utils'

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
