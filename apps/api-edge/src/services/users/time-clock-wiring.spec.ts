// HARTES GATE fuer die Verdrahtung: Ruft jede der vier Stempel-Methoden den
// Scope-Check ueberhaupt auf? (panary/panary-core#189)
//
// time-clock-scope.spec.ts prueft die Entscheidung. Die reicht als Schutz
// nicht: Genau der Fehler, um den es geht, war ja nicht „die Policy entscheidet
// falsch", sondern „es gibt gar keine". Ein Umbau, der `assertTimeClockScope`
// aus einer der Methoden entfernt, laesst jene Spec unveraendert gruen.
//
// Deshalb hier der echte Aufruf gegen die registrierte Service-Instanz — ohne
// SQLite, mit gestubbtem `get`. Geprueft wird die Reihenfolge mit: Der
// Scope-Check muss VOR jedem Schreibvorgang und vor jeder Zustands-Meldung
// greifen, sonst leckt die Ablehnung wieder Zustand (`bereits eingestempelt`
// vs. `nicht eingestempelt`) ueber fremde Mitarbeiter.

import { describe, expect, it, vi } from 'vitest'

import { UserStatus, UserSystemRole } from '@panary/users/domain'

import { users } from './users'

import type { Application } from '../../declarations'

const TIME_CLOCK_METHODS = ['checkin', 'checkout', 'startBreak', 'endBreak'] as const

/**
 * Registriert den users-Service gegen eine App-Attrappe und ersetzt `get` durch
 * einen Stub, der den uebergebenen Ziel-User liefert. `patch` und `create`
 * werden mitgezaehlt — so faellt auf, wenn eine Methode trotz Ablehnung
 * geschrieben hat.
 */
const setup = (target: Record<string, unknown>) => {
  // Parameter explizit deklariert, damit `patch.mock.calls[0][1]` (das Data-
  // Argument) typisiert ist — `vi.fn(async () => …)` haette den Call-Typ `[]`.
  const patch = vi.fn(async (_id: string, _data: Record<string, unknown>, _params?: unknown) => target)
  const create = vi.fn(async (_data: Record<string, unknown>, _params?: unknown) => ({ _id: 'wt-1' }))
  let registered: Record<string, unknown> = {}

  const app = {
    // Echte Werte statt eines Allzweck-Stubs: `createServiceAdapter` wirft bei
    // unbekanntem dbType, und `getJsonFieldHooks` haengt daran ebenfalls.
    get: (key: string) => {
      if (key === 'system') return { dbType: 'sqlite' }
      if (key === 'paginate') return { default: 50, max: 250 }
      if (key === 'sqliteClient') return () => undefined
      return undefined
    },
    set: () => undefined,
    use: (_path: string, service: unknown) => {
      registered = service as Record<string, unknown>
    },
    service: (path?: string) => {
      if (path === 'working-times') return { create, patch, get: async () => ({ breaks: [] }) }
      if (path === 'locations') return { get: async () => ({ currentBusinessDay: { date: '2026-08-13' } }) }
      const svc = registered
      svc['hooks'] = () => svc
      svc['get'] = vi.fn(async () => target)
      svc['patch'] = patch
      return svc
    },
    configure: function (fn: (a: Application) => void) {
      fn(this as unknown as Application)
      return this
    },
    hooks: () => undefined,
  } as unknown as Application

  users(app)
  return { service: registered, patch, create }
}

const foreignTarget = {
  _id: 'u-victim',
  tenantId: 't-1',
  status: UserStatus.ACTIVE,
  // Bewusst gesetzt: Ohne diese beiden wuerden checkout/endBreak/startBreak
  // schon an ihrer Vorbedingung scheitern und der Test waere wertlos — er
  // wuerde eine Ablehnung messen, die nichts mit dem Scope zu tun hat.
  stampingId: 'stamp-1',
  startBreakAt: '2026-08-13T10:00:00.000Z',
}

const attacker = { _id: 'u-attacker', role: UserSystemRole.TENANT_STAFF, tenantId: 't-1' }
const deviceActor = { _id: 'device:dev-1', role: UserSystemRole.DEVICE_POS, tenantId: 't-1' }

const call = (service: Record<string, unknown>, method: string, data: unknown, params: unknown) =>
  (service[method] as (d: unknown, p: unknown) => Promise<unknown>)(data, params)

describe('Verdrahtung: jede Stempel-Methode prueft den Aufrufer-Scope', () => {
  it.each(TIME_CLOCK_METHODS)('%s lehnt einen fremden Kollegen mit 403 ab und schreibt nicht', async method => {
    const { service, patch, create } = setup(foreignTarget)

    await expect(call(service, method, { userId: 'u-victim' }, { user: attacker })).rejects.toMatchObject({ code: 403 })
    // Der Befund von #189 war, dass der Write durchlief und HTTP 200 kam.
    expect(patch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it.each(TIME_CLOCK_METHODS)('%s lehnt einen fremden Mandanten mit 403 ab', async method => {
    const { service, patch } = setup({ ...foreignTarget, tenantId: 't-fremd' })

    await expect(call(service, method, { userId: 'u-victim' }, { user: attacker })).rejects.toMatchObject({ code: 403 })
    expect(patch).not.toHaveBeenCalled()
  })

  it.each(TIME_CLOCK_METHODS)('%s lehnt ein archiviertes Konto ab, auch fuer das Terminal', async method => {
    const { service, patch } = setup({ ...foreignTarget, status: UserStatus.ARCHIVED })

    await expect(call(service, method, { userId: 'u-victim' }, { user: deviceActor })).rejects.toMatchObject({
      code: 403,
    })
    expect(patch).not.toHaveBeenCalled()
  })

  it.each(TIME_CLOCK_METHODS)('%s respektiert die Geraete-Zuweisung aus params', async method => {
    const { service, patch } = setup(foreignTarget)

    await expect(
      call(service, method, { userId: 'u-victim' }, { user: deviceActor, deviceAccessScope: ['u-jemand-anders'] }),
    ).rejects.toMatchObject({ code: 403 })
    expect(patch).not.toHaveBeenCalled()
  })

  it.each(TIME_CLOCK_METHODS)('%s lehnt ab, bevor es Zustand verraet', async method => {
    // Ziel-User ohne stampingId: Waere der Scope-Check hinter der Vorbedingung,
    // kaeme hier 409 („nicht eingestempelt") statt 403 — und genau diese
    // Unterscheidung ist das Oracle ueber fremde Mitarbeiter.
    const { service } = setup({ ...foreignTarget, stampingId: null, startBreakAt: null })

    await expect(call(service, method, { userId: 'u-victim' }, { user: attacker })).rejects.toMatchObject({ code: 403 })
  })

  it('der legitime Terminal-Pfad bleibt offen (Geraet stempelt einen Mitarbeiter ein)', async () => {
    // Gegenprobe: Der Scope-Check darf den Pfad nicht mitnehmen, ueber den die
    // Zeiterfassung tatsaechlich laeuft — POS-Login-Screen und POS-Dashboard
    // rufen beide unter dem Geraete-JWT auf.
    const { service, patch, create } = setup({ ...foreignTarget, stampingId: null, startBreakAt: null })

    await call(service, 'checkin', { userId: 'u-victim' }, { user: deviceActor, deviceAccessScope: ['u-victim'] })

    expect(create).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ stampingId: 'wt-1' })
  })

  it('Selbst-Stempeln bleibt offen (startBreak auf den eigenen Datensatz)', async () => {
    const self = {
      _id: 'u-attacker',
      tenantId: 't-1',
      status: UserStatus.ACTIVE,
      stampingId: 'stamp-1',
      startBreakAt: null,
    }
    const { service, patch } = setup(self)

    await call(service, 'startBreak', { userId: 'u-attacker' }, { user: attacker })

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ startBreakAt: expect.any(String) })
  })

  it('interner Aufruf ohne params laeuft weiterhin durch', async () => {
    const self = { _id: 'u-any', tenantId: 't-1', status: UserStatus.ACTIVE, stampingId: 's-1', startBreakAt: null }
    const { service, patch } = setup(self)

    await call(service, 'startBreak', { userId: 'u-any' }, undefined)

    expect(patch).toHaveBeenCalledTimes(1)
  })
})
