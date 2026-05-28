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
const getDifferenceInDays = vi.fn()
const getHoursSince = vi.fn()
vi.mock('../utils/business-day.utils', () => ({
  shouldAutoRotate: (...a: unknown[]) => shouldAutoRotate(...a),
  rotateBusinessDay: (...a: unknown[]) => rotateBusinessDay(...a),
  hasActiveOrders: (...a: unknown[]) => hasActiveOrders(...a),
  getDifferenceInDays: (...a: unknown[]) => getDifferenceInDays(...a),
  getHoursSince: (...a: unknown[]) => getHoursSince(...a),
}))

import { restrictOrderToBusinessDay } from './restrict-order-to-business-day'

// Stub-App: ein User mit activeLocationId, eine Location und optional eine
// cloud-connection. `system.mode` steuert standalone vs. enterprise.
function makeContext(opts: {
  systemMode?: string
  location?: any
  cloudConnection?: any
  data?: any
}): any {
  const services: Record<string, any> = {
    users: { get: vi.fn().mockResolvedValue({ activeLocationId: 'loc-1' }) },
    locations: {
      get: vi.fn().mockResolvedValue(opts.location ?? { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null }),
    },
    'cloud-connection': {
      find: vi.fn().mockResolvedValue(opts.cloudConnection ? [opts.cloudConnection] : []),
    },
    businessdays: { get: vi.fn().mockResolvedValue({ openedAt: new Date().toISOString() }) },
  }
  return {
    app: {
      get: (key: string) => (key === 'system' ? { mode: opts.systemMode ?? 'standalone' } : undefined),
      service: (path: string) => services[path],
    },
    params: { user: { _id: 'user-1' } },
    data: opts.data ?? {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('restrictOrderToBusinessDay', () => {
  it('lässt einen offenen Geschäftstag passieren und stempelt die businessDayId', async () => {
    shouldAutoRotate.mockReturnValue(false)
    getDifferenceInDays.mockReturnValue(0)
    const ctx = makeContext({
      systemMode: 'standalone',
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-1', date: new Date().toISOString().slice(0, 10) },
      },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(ctx.data.businessDayId).toBe('bd-1')
  })

  it('wirft BadRequest, wenn kein Geschäftstag gesetzt ist (standalone, keine Rotation)', async () => {
    shouldAutoRotate.mockReturnValue(false)
    const ctx = makeContext({
      systemMode: 'standalone',
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
  })

  it('rotiert im Standalone-Modus automatisch und stempelt die neue businessDayId', async () => {
    shouldAutoRotate.mockReturnValue(true)
    rotateBusinessDay.mockResolvedValue('bd-new')
    const ctx = makeContext({
      systemMode: 'standalone',
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
    })

    await restrictOrderToBusinessDay()(ctx)

    expect(rotateBusinessDay).toHaveBeenCalledTimes(1)
    expect(ctx.data.businessDayId).toBe('bd-new')
  })

  it('blockiert im Connected-Modus ohne Override, wenn der Tag rotiert werden müsste', async () => {
    shouldAutoRotate.mockReturnValue(true)
    const ctx = makeContext({
      systemMode: 'standalone',
      location: { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null },
      cloudConnection: { pairingStatus: 'connected', offlineOverrideActiveUntil: null },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('verweigert die Rotation bei aktiven Bestellungen und zu lange offenem Tag', async () => {
    shouldAutoRotate.mockReturnValue(true)
    hasActiveOrders.mockResolvedValue(true)
    // ensureBusinessDayNotOpenTooLong wirft, weil getHoursSince > maxOpenHours.
    getHoursSince.mockReturnValue(48)
    const ctx = makeContext({
      systemMode: 'standalone',
      location: {
        _id: 'loc-1',
        tenantId: 't-1',
        currentBusinessDay: { businessDayId: 'bd-old', date: '2026-05-01' },
      },
    })

    await expect(restrictOrderToBusinessDay()(ctx)).rejects.toBeInstanceOf(BadRequest)
  })
})
