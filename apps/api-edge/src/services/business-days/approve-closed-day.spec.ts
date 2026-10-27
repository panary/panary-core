import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Forbidden, NotAuthenticated, TooManyRequests } from '@feathersjs/errors'

vi.mock('@panary/shared-backend', async importOriginal => ({
  ...(await importOriginal<typeof import('@panary/shared-backend')>()),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// Lifecycle-Helfer sind in business-day.utils getestet; hier zaehlt, wann die
// Freigabe rotiert und wann sie nur stempelt.
const isLocalRotationAllowed = vi.fn()
const loadBusinessDayRuntime = vi.fn()
const hasActiveOrders = vi.fn()
const shouldAutoRotate = vi.fn()
const rotateBusinessDay = vi.fn()
vi.mock('../../utils/business-day.utils', () => ({
  isLocalRotationAllowed: (...a: unknown[]) => isLocalRotationAllowed(...a),
  loadBusinessDayRuntime: (...a: unknown[]) => loadBusinessDayRuntime(...a),
  hasActiveOrders: (...a: unknown[]) => hasActiveOrders(...a),
  shouldAutoRotate: (...a: unknown[]) => shouldAutoRotate(...a),
  rotateBusinessDay: (...a: unknown[]) => rotateBusinessDay(...a),
}))

const loadClosedDayCheck = vi.fn()
vi.mock('../../utils/closed-day-gate', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/closed-day-gate')>()),
  loadClosedDayCheck: (...a: unknown[]) => loadClosedDayCheck(...a),
}))

import { approveClosedDay, businessDaysMethods } from './business-days'

const DEVICE = { _id: 'device-1', tenantId: 't-1', role: 'device:pos', locationId: 'loc-1' }
const CLOSED = { status: { state: 'closed', date: '2026-10-26', reason: 'regular' }, policy: 'manager-approval' }

function makeApp(
  opts: {
    approver?: { _id: string; role: string } | Error
    currentBusinessDay?: { businessDayId: string; date: string } | null
    locationTenantId?: string
  } = {},
) {
  const verifyPin = vi.fn(async () => {
    if (opts.approver instanceof Error) throw opts.approver
    return opts.approver ?? { _id: 'manager-1', role: 'tenant:manager' }
  })
  const businessDayPatch = vi.fn(async (id: string, data: Record<string, unknown>) => ({ _id: id, ...data }))
  const auditCreate = vi.fn(async () => ({}))
  const services: Record<string, Record<string, unknown>> = {
    locations: {
      get: vi.fn(async () => ({
        _id: 'loc-1',
        tenantId: opts.locationTenantId ?? 't-1',
        currentBusinessDay:
          opts.currentBusinessDay === undefined
            ? { businessDayId: 'bd-vortag', date: '2026-10-25' }
            : opts.currentBusinessDay,
      })),
    },
    users: { verifyPin },
    businessdays: { patch: businessDayPatch },
    'audit-events': { create: auditCreate },
  }
  return { app: { service: (p: string) => services[p] } as any, verifyPin, businessDayPatch, auditCreate }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadClosedDayCheck.mockResolvedValue(CLOSED)
  isLocalRotationAllowed.mockResolvedValue(true)
  loadBusinessDayRuntime.mockResolvedValue({ openHours: 14 })
  hasActiveOrders.mockResolvedValue(false)
  shouldAutoRotate.mockReturnValue(true)
  rotateBusinessDay.mockResolvedValue('bd-ruhetag')
})

const call = (app: any, data: Record<string, unknown> = {}) =>
  approveClosedDay(
    app,
    { authorizedByUserId: 'manager-1', pin: '1234', ...data },
    { provider: 'socketio', user: DEVICE },
  )

describe('approveClosedDay', () => {
  it('ist als Custom-Method registriert', () => {
    expect(businessDaysMethods).toContain('approveClosedDay')
  })

  it('eröffnet im Standalone-Betrieb den Ruhetag und stempelt ihn mit der Manager-Freigabe', async () => {
    const { app, businessDayPatch, auditCreate } = makeApp()

    const result = await call(app)

    expect(rotateBusinessDay).toHaveBeenCalledWith(app, expect.objectContaining({ _id: 'loc-1' }), '2026-10-26')
    expect(businessDayPatch).toHaveBeenCalledWith(
      'bd-ruhetag',
      expect.objectContaining({
        openedOnClosedDayBy: 'manager-1',
        openedOnClosedDayRole: 'tenant:manager',
        openedOnClosedDayDate: '2026-10-26',
      }),
      expect.objectContaining({ provider: undefined }),
    )
    expect(result).toEqual({
      approved: true,
      businessDayId: 'bd-ruhetag',
      date: '2026-10-26',
      policy: 'manager-approval',
      role: 'tenant:manager',
    })
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'closed-day-approved' }) }),
      { provider: undefined },
    )
  })

  it('prüft die PIN mit dem Aufrufer als user — sonst fehlt der Mandanten-Scope (#332)', async () => {
    const { app, verifyPin } = makeApp()
    await call(app)
    expect(verifyPin).toHaveBeenCalledWith({ userId: 'manager-1', pin: '1234' }, { provider: undefined, user: DEVICE })
  })

  it('stempelt gepairt den laufenden Tag, statt zu rotieren', async () => {
    isLocalRotationAllowed.mockResolvedValue(false)
    const { app, businessDayPatch } = makeApp()

    await call(app)

    expect(rotateBusinessDay).not.toHaveBeenCalled()
    expect(businessDayPatch).toHaveBeenCalledWith('bd-vortag', expect.anything(), expect.anything())
  })

  it('stempelt den Vortag, wenn dort noch Bestellungen offen sind', async () => {
    hasActiveOrders.mockResolvedValue(true)
    const { app, businessDayPatch } = makeApp()

    await call(app)

    expect(rotateBusinessDay).not.toHaveBeenCalled()
    expect(businessDayPatch).toHaveBeenCalledWith('bd-vortag', expect.anything(), expect.anything())
  })

  it('meldet gepairt ohne Tag BUSINESS_DAY_NOT_SET — eröffnen muss die Cloud', async () => {
    isLocalRotationAllowed.mockResolvedValue(false)
    const { app, businessDayPatch } = makeApp({ currentBusinessDay: null })

    await expect(call(app)).rejects.toMatchObject({ data: { code: 'BD_6001' } })
    expect(businessDayPatch).not.toHaveBeenCalled()
  })

  it('lehnt eine falsche PIN mit eigenem Code ab und schreibt nichts', async () => {
    const { app, businessDayPatch } = makeApp({ approver: new NotAuthenticated('PIN ungueltig') })

    await expect(call(app)).rejects.toMatchObject({ code: 403, data: { code: 'BD_6011' } })
    expect(businessDayPatch).not.toHaveBeenCalled()
    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('reicht die PIN-Sperre unverändert durch', async () => {
    const { app } = makeApp({ approver: new TooManyRequests('Zu viele Fehlversuche') })
    await expect(call(app)).rejects.toBeInstanceOf(TooManyRequests)
  })

  it('lehnt einen Mitarbeiter ohne Manager- oder Inhaberrolle ab', async () => {
    const { app, businessDayPatch } = makeApp({ approver: { _id: 'staff-1', role: 'tenant:staff' } })

    await expect(call(app)).rejects.toMatchObject({ code: 403, data: { code: 'BD_6012' } })
    expect(businessDayPatch).not.toHaveBeenCalled()
  })

  it('lässt unter block nur den Inhaber freigeben', async () => {
    loadClosedDayCheck.mockResolvedValue({ ...CLOSED, policy: 'block' })

    const manager = makeApp()
    await expect(call(manager.app)).rejects.toThrow(/nur der Inhaber/)
    expect(manager.businessDayPatch).not.toHaveBeenCalled()

    const owner = makeApp({ approver: { _id: 'owner-1', role: 'tenant:owner' } })
    const result = await call(owner.app)
    expect(result).toMatchObject({ approved: true, policy: 'block', role: 'tenant:owner' })
    expect(owner.businessDayPatch).toHaveBeenCalledWith(
      'bd-ruhetag',
      expect.objectContaining({ openedOnClosedDayRole: 'tenant:owner' }),
      expect.anything(),
    )
  })

  it('prüft und schreibt nichts, wenn heute kein Ruhetag ist', async () => {
    loadClosedDayCheck.mockResolvedValue({ ...CLOSED, status: { ...CLOSED.status, state: 'open' } })
    const { app, verifyPin, businessDayPatch } = makeApp()

    await expect(call(app)).resolves.toMatchObject({ approved: false, businessDayId: 'bd-vortag' })
    expect(verifyPin).not.toHaveBeenCalled()
    expect(businessDayPatch).not.toHaveBeenCalled()
  })

  it('verweigert eine Filiale eines fremden Mandanten', async () => {
    const { app, verifyPin } = makeApp({ locationTenantId: 't-fremd' })
    await expect(call(app)).rejects.toBeInstanceOf(Forbidden)
    expect(verifyPin).not.toHaveBeenCalled()
  })

  it('verlangt PIN und freigebende Person', async () => {
    const { app } = makeApp()
    await expect(call(app, { pin: '' })).rejects.toThrow(/erforderlich/)
  })
})
