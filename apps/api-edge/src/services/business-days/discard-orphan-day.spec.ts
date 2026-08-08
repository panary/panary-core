import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequest, NotFound } from '@feathersjs/errors'

// Nur den Logger ersetzen — das Modul liefert ausserdem dataValidator/
// queryValidator, die business-days.schema.ts beim Import braucht.
vi.mock('@panary/shared-backend', async importOriginal => ({
  ...(await importOriginal<typeof import('@panary/shared-backend')>()),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { logger } from '@panary/shared-backend'

// discardOrphanDay ist exportiert, damit die Guard-Matrix ohne App-Boot und ohne
// globalen DB-Zustand testbar ist — dieselbe Begruendung wie bei
// evaluateOutboxGuard in derselben Datei.
import { businessDaysMethods, discardOrphanDay } from './business-days'

/**
 * `discardOrphanDay` haengt nicht am Service-Objekt, sondern wird ueber
 * `configure()` verdrahtet. Statt die halbe App zu booten, wird die Methode hier
 * ueber eine minimale App gefahren: der Service-Proxy liefert genau die Aufrufe,
 * die die Guards machen.
 */
type ServiceStub = Record<string, ReturnType<typeof vi.fn>>

const OPEN_DAY = {
  _id: 'bd-verwaist',
  tenantId: 't-1',
  locationId: 'loc-1',
  date: '2026-07-27',
  status: 'open',
  openedAt: '2026-07-27T15:35:00.000Z',
  openedBy: null,
}

const USER = { _id: 'u-1', tenantId: 't-1', role: 'tenant:owner', locationId: 'loc-1' }

function makeApp(
  opts: {
    businessDay?: Record<string, unknown> | null
    currentBusinessDayId?: string | null
    orderCount?: number
    cashSessionCount?: number
    auditThrows?: boolean
  } = {},
) {
  const businessDayGet = vi.fn().mockImplementation(async () => {
    if (opts.businessDay === null) return undefined
    return opts.businessDay ?? OPEN_DAY
  })
  const businessDayRemove = vi.fn().mockResolvedValue({})
  const locationGet = vi.fn().mockResolvedValue({
    currentBusinessDay: opts.currentBusinessDayId ? { businessDayId: opts.currentBusinessDayId } : null,
  })
  const orderFind = vi.fn().mockResolvedValue({ total: opts.orderCount ?? 0 })
  const cashSessionFind = vi.fn().mockResolvedValue({ total: opts.cashSessionCount ?? 0 })
  const auditCreate = opts.auditThrows
    ? vi.fn().mockRejectedValue(new Error('validation failed'))
    : vi.fn().mockResolvedValue({})

  const services: Record<string, ServiceStub> = {
    businessdays: { get: businessDayGet, remove: businessDayRemove },
    locations: { get: locationGet },
    orders: { find: orderFind },
    'cash-sessions': { find: cashSessionFind },
    'audit-events': { create: auditCreate },
  }

  const app = {
    service: (path: string) => {
      const svc = services[path]
      if (!svc) throw new Error(`unerwarteter Service: ${path}`)
      return svc
    },
  }

  return { app, businessDayGet, businessDayRemove, locationGet, orderFind, cashSessionFind, auditCreate }
}

const callDiscard = (app: unknown, data: unknown, params: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stub-App statt voll gebooteter Feathers-App
  discardOrphanDay(app as any, data as any, params as any)

const params = { provider: 'rest', user: USER }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('businessDaysMethods', () => {
  it('registriert discardOrphanDay als Custom-Method', () => {
    expect(businessDaysMethods).toContain('discardOrphanDay')
  })
})

describe('discardOrphanDay — Guards', () => {
  it('verwirft einen verwaisten, leeren Tag', async () => {
    const { app, businessDayRemove, auditCreate } = makeApp()

    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).resolves.toEqual({
      discarded: true,
      _id: 'bd-verwaist',
    })

    expect(businessDayRemove).toHaveBeenCalledWith('bd-verwaist', { provider: undefined })
    // Audit VOR dem Loeschen — danach waeren die before-Daten weg.
    expect(auditCreate.mock.invocationCallOrder[0]).toBeLessThan(businessDayRemove.mock.invocationCallOrder[0])
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'business_day.orphan_discarded' }))
  })

  it('1 — lehnt anonyme (interne) Aufrufe ab', async () => {
    const { app } = makeApp()
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, { user: USER })).rejects.toBeInstanceOf(BadRequest)
  })

  it('2 — lehnt Aufrufe ohne Tenant-Kontext ab', async () => {
    const { app } = makeApp()
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, { provider: 'rest' })).rejects.toBeInstanceOf(
      BadRequest,
    )
  })

  it('3 — lehnt einen fehlenden Tag ab', async () => {
    const { app } = makeApp({ businessDay: null })
    await expect(callDiscard(app, { businessDayId: 'bd-weg' }, params)).rejects.toBeInstanceOf(NotFound)
  })

  it('4 — lehnt einen fremden Tenant ab', async () => {
    const { app } = makeApp({ businessDay: { ...OPEN_DAY, tenantId: 't-fremd' } })
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/Tenant-Mismatch/)
  })

  it.each(['closed', 'closing-requested', 'audited', 'failed'])('5 — lehnt Status %s ab', async status => {
    const { app, businessDayRemove } = makeApp({ businessDay: { ...OPEN_DAY, status } })
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/Nur offene/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  it('6 — lehnt den aktuellen Tag der Filiale ab', async () => {
    const { app, businessDayRemove } = makeApp({ currentBusinessDayId: 'bd-verwaist' })
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/aktuelle Tag/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  // openedBy gesetzt = openDay() hat ihn eroeffnet, die Cloud kennt ihn.
  // rotateBusinessDay sendet kein openedBy — nur solche Tage sind Verwaiste.
  it('7 — lehnt einen manuell eroeffneten Tag ab', async () => {
    const { app, businessDayRemove } = makeApp({ businessDay: { ...OPEN_DAY, openedBy: 'u-9' } })
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/manuell eroeffnet/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  it('8 — lehnt einen Tag mit Bestellungen ab', async () => {
    const { app, businessDayRemove } = makeApp({ orderCount: 3 })
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/3 Bestellungen/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  it('9 — lehnt einen Tag mit Kassensitzungen ab', async () => {
    const { app, businessDayRemove } = makeApp({ cashSessionCount: 1 })
    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/1 Kassensitzungen/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  it('10 — lehnt ohne businessDayId ab', async () => {
    const { app } = makeApp()
    await expect(callDiscard(app, {}, params)).rejects.toBeInstanceOf(BadRequest)
  })

  // Zaehl-Fehler duerfen NIE als „0 Datensaetze" durchgehen.
  it('bricht ab, wenn der Zaehl-Call fehlschlaegt', async () => {
    const { app, orderFind, businessDayRemove } = makeApp()
    orderFind.mockRejectedValue(new Error('db locked'))

    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/db locked/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  // Array-Antwort = Pagination aus. `.total` waere undefined → fail-open.
  it('wertet ein Array-Ergebnis des Zaehl-Calls aus', async () => {
    const { app, orderFind, businessDayRemove } = makeApp()
    orderFind.mockResolvedValue([{ _id: 'o-1' }])

    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).rejects.toThrow(/1 Bestellungen/)
    expect(businessDayRemove).not.toHaveBeenCalled()
  })

  // Audit-Verlust ist akzeptabel, der Business-Pfad bleibt intakt.
  it('verwirft auch, wenn das Audit-Event fehlschlaegt', async () => {
    const { app, businessDayRemove } = makeApp({ auditThrows: true })

    await expect(callDiscard(app, { businessDayId: 'bd-verwaist' }, params)).resolves.toMatchObject({ discarded: true })
    expect(businessDayRemove).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'business_day.orphan_discard_audit_failed' }),
    )
  })
})
