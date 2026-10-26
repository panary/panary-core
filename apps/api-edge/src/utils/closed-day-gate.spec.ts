import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()
vi.mock('@panary/shared-backend', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn() } }))

import {
  assertClosedDayApproved,
  closedDayMessage,
  hasClosedDayApproval,
  loadClosedDayCheck,
  type ClosedDayGateLocation,
} from './closed-day-gate'

// Montag geschlossen, sonst 10–22 Uhr. 2026-10-26 ist ein Montag.
const regular = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: day === 1 }))
const MONDAY = new Date('2026-10-26T09:00:00Z')
const TUESDAY = new Date('2026-10-27T09:00:00Z')

const location = (closedDayPolicy?: string, enabled = true): ClosedDayGateLocation => ({
  _id: 'loc-1',
  operationMode: 'pos-cashier',
  settings: {
    generalSettings: { timezone: 'Europe/Berlin' },
    openingHoursSettings: { enabled, regular, closedDayPolicy },
  },
})

function makeApp(
  opts: { exceptions?: unknown[]; exceptionsError?: Error; businessDay?: Record<string, unknown> } = {},
) {
  const exceptionsFind = vi.fn(async () => {
    if (opts.exceptionsError) throw opts.exceptionsError
    return opts.exceptions ?? []
  })
  const businessDayGet = vi.fn(async () => opts.businessDay ?? {})
  const services: Record<string, unknown> = {
    'opening-hour-exceptions': { find: exceptionsFind },
    businessdays: { get: businessDayGet },
  }
  return { app: { service: (path: string) => services[path] }, exceptionsFind, businessDayGet }
}

beforeEach(() => vi.clearAllMocks())

describe('loadClosedDayCheck', () => {
  it('lädt die Ausnahmen filialgenau für den heutigen Filial-Tag, ungekappt', async () => {
    const { app, exceptionsFind } = makeApp()
    const check = await loadClosedDayCheck(app, location(), MONDAY)

    expect(check).toEqual({
      status: { state: 'closed', date: '2026-10-26', reason: 'regular' },
      policy: 'manager-approval',
    })
    expect(exceptionsFind).toHaveBeenCalledWith({
      query: { date: '2026-10-26', locationId: 'loc-1' },
      paginate: false,
      provider: undefined,
    })
  })

  it('lässt eine Ausnahme „heute geöffnet" den Ruhetag aufheben', async () => {
    const { app } = makeApp({ exceptions: [{ date: '2026-10-26', closed: false, locationId: 'loc-1' }] })
    expect((await loadClosedDayCheck(app, location(), MONDAY))?.status.state).toBe('open')
  })

  it('liest ohne aktive Öffnungszeiten gar nichts und urteilt nie „geschlossen"', async () => {
    const { app, exceptionsFind } = makeApp()
    const check = await loadClosedDayCheck(app, location(undefined, false), MONDAY)
    expect(check?.status.state).toBe('unknown')
    expect(exceptionsFind).not.toHaveBeenCalled()
  })

  it('ist fail-open und laut, wenn die Ausnahmen nicht lesbar sind', async () => {
    const { app } = makeApp({ exceptionsError: new Error('SQLITE_BUSY') })
    expect(await loadClosedDayCheck(app, location(), MONDAY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'business_day.closed_day_check_skipped' }))
  })

  it('reicht die Ruhetag-Regel des Standorts durch', async () => {
    const { app } = makeApp()
    expect((await loadClosedDayCheck(app, location('block'), MONDAY))?.policy).toBe('block')
  })
})

describe('hasClosedDayApproval', () => {
  const stamp = { openedOnClosedDayDate: '2026-10-26', openedOnClosedDayRole: 'tenant:manager' }

  it('gilt nur für das gestempelte Datum', () => {
    expect(hasClosedDayApproval(stamp, '2026-10-26', 'manager-approval')).toBe(true)
    expect(hasClosedDayApproval(stamp, '2026-10-27', 'manager-approval')).toBe(false)
    expect(hasClosedDayApproval({}, '2026-10-26', 'manager-approval')).toBe(false)
    expect(hasClosedDayApproval(null, '2026-10-26', 'manager-approval')).toBe(false)
  })

  it('verwirft unter block eine Manager-Freigabe, nimmt die des Inhabers', () => {
    expect(hasClosedDayApproval(stamp, '2026-10-26', 'block')).toBe(false)
    expect(hasClosedDayApproval({ ...stamp, openedOnClosedDayRole: 'tenant:owner' }, '2026-10-26', 'block')).toBe(true)
  })
})

describe('assertClosedDayApproved', () => {
  const closed = {
    status: { state: 'closed' as const, date: '2026-10-26', reason: 'regular' as const },
    policy: 'manager-approval' as const,
  }

  it('lässt durch, wenn kein Ruhetag ist oder nicht geprüft werden konnte', async () => {
    const { app, businessDayGet } = makeApp()
    await expect(assertClosedDayApproved(app, location(), null, 'bd-1')).resolves.toBeUndefined()
    await expect(
      assertClosedDayApproved(app, location(), { ...closed, status: { ...closed.status, state: 'open' } }, 'bd-1'),
    ).resolves.toBeUndefined()
    expect(businessDayGet).not.toHaveBeenCalled()
  })

  it('wirft LOCATION_CLOSED_TODAY ohne Freigabe am Tag', async () => {
    const { app } = makeApp({ businessDay: {} })
    await expect(assertClosedDayApproved(app, location(), closed, 'bd-1')).rejects.toMatchObject({
      code: 400,
      data: { code: 'BD_6010', date: '2026-10-26', policy: 'manager-approval' },
    })
  })

  it('wirft LOCATION_CLOSED_TODAY ohne Geschäftstag', async () => {
    const { app } = makeApp()
    await expect(assertClosedDayApproved(app, location(), closed, null)).rejects.toMatchObject({
      data: { code: 'BD_6010' },
    })
  })

  it('lässt mit heute gültiger Freigabe durch', async () => {
    const { app } = makeApp({
      businessDay: { openedOnClosedDayDate: '2026-10-26', openedOnClosedDayRole: 'tenant:manager' },
    })
    await expect(assertClosedDayApproved(app, location(), closed, 'bd-1')).resolves.toBeUndefined()
  })

  it('verlangt am nächsten Ruhetag eine neue Freigabe', async () => {
    const { app } = makeApp({
      businessDay: { openedOnClosedDayDate: '2026-10-19', openedOnClosedDayRole: 'tenant:owner' },
    })
    await expect(assertClosedDayApproved(app, location(), closed, 'bd-1')).rejects.toMatchObject({
      data: { code: 'BD_6010' },
    })
  })

  it('ist an einem Öffnungstag ohne Wirkung (Ende-zu-Ende mit dem Loader)', async () => {
    const { app } = makeApp()
    const check = await loadClosedDayCheck(app, location(), TUESDAY)
    await expect(assertClosedDayApproved(app, location(), check, null)).resolves.toBeUndefined()
  })
})

describe('closedDayMessage', () => {
  it('spricht im Bestellbetrieb von Bestellungen, im Kassenbetrieb vom Verkauf', () => {
    expect(closedDayMessage('2026-10-26', 'manager-approval', 'orders-only')).toMatch(/Bestellungen annehmen/)
    expect(closedDayMessage('2026-10-26', 'manager-approval', 'pos-cashier')).toMatch(/verkaufen/)
  })

  it('nennt unter block nur den Inhaber', () => {
    expect(closedDayMessage('2026-10-26', 'block')).toMatch(/dem Inhaber/)
    expect(closedDayMessage('2026-10-26', 'block')).not.toMatch(/Manager/)
  })
})
