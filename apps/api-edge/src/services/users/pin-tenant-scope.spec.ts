// HARTES GATE fuer die Verdrahtung: Pruefen `verifyPin` und `changePin` den
// Mandanten des Aufrufers, bevor sie einen PIN vergleichen?
// (panary/panary-core#332)
//
// Muster und Begruendung wie `time-clock-wiring.spec.ts`: Der Fehler, um den es
// geht, war nicht „die Pruefung entscheidet falsch", sondern „es gibt keine".
// Ein Test der Policy allein bliebe gruen, wenn jemand den Guard wieder aus der
// Methode entfernt — deshalb der echte Aufruf gegen die registrierte
// Service-Instanz, ohne SQLite, mit gestubbtem `get`.
//
// Mitgeprueft wird die Reihenfolge: Der Mandanten-Guard muss VOR dem
// Konto-Status-Check und VOR `bcrypt.compare` greifen. Stuende er dahinter,
// unterschieden Antwortzeit und Fehlversuchs-Zaehler wieder Zustaende fremder
// Datensaetze — und `recordPinFailure` spannte den PIN-Lockout einer Person
// eines anderen Mandanten.

import { describe, expect, it, vi } from 'vitest'

import { UserStatus, UserSystemRole } from '@panary/users/domain'

import { users } from './users'

import type { Application } from '../../declarations'

const { compareMock, recordPinFailureMock, clearPinFailuresMock } = vi.hoisted(() => ({
  compareMock: vi.fn(async () => true),
  recordPinFailureMock: vi.fn(),
  clearPinFailuresMock: vi.fn(),
}))

vi.mock('bcryptjs', () => ({ default: { compare: compareMock, hash: vi.fn(async () => 'hash') } }))

vi.mock('@panary/shared-backend', async importOriginal => {
  const actual = await importOriginal<typeof import('@panary/shared-backend')>()
  return {
    ...actual,
    getPinLockoutSeconds: vi.fn(() => null),
    recordPinFailure: recordPinFailureMock,
    clearPinFailures: clearPinFailuresMock,
  }
})

/** Wie in time-clock-wiring.spec.ts: echte Werte, weil createServiceAdapter sonst wirft. */
const setup = (target: Record<string, unknown>) => {
  const patch = vi.fn(async (_id: string, _data: Record<string, unknown>, _params?: unknown) => target)
  let registered: Record<string, unknown> = {}

  const app = {
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
    service: (_path?: string) => {
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
  return { service: registered, patch }
}

const ACTIVE_TARGET = {
  _id: 'u-victim',
  tenantId: 't-fremd',
  status: UserStatus.ACTIVE,
  posPin: '$2a$06$irrelevant-weil-bcrypt-gemockt',
  role: UserSystemRole.TENANT_STAFF,
}

/** Das Geraet spricht fuer t-1 — `allowApiKey` bildet params.user aus der Connection. */
const deviceActor = { _id: 'device:dev-1', role: UserSystemRole.DEVICE_POS, tenantId: 't-1' }
const humanActor = { _id: 'u-chef', role: UserSystemRole.TENANT_MANAGER, tenantId: 't-1' }

const call = (service: Record<string, unknown>, method: string, data: unknown, params?: unknown) =>
  (service[method] as (d: unknown, p?: unknown) => Promise<unknown>)(data, params)

describe('verifyPin prueft den Mandanten des Aufrufers (#332)', () => {
  it('lehnt einen fremden Mandanten mit 403 ab', async () => {
    const { service } = setup(ACTIVE_TARGET)

    await expect(
      call(service, 'verifyPin', { userId: 'u-victim', pin: '1234' }, { user: deviceActor }),
    ).rejects.toMatchObject({ code: 403, message: 'Benutzer gehoert nicht zum eigenen Mandanten' })
  })

  it('vergleicht dabei keinen PIN und zaehlt keinen Fehlversuch', async () => {
    // Der Kern der Entscheidung gegen die PIN-Tarnung: `recordPinFailure` auf
    // eine fremde `userId` waere ein mandantenuebergreifender Aussperr-Effekt.
    const { service } = setup(ACTIVE_TARGET)
    compareMock.mockClear()
    recordPinFailureMock.mockClear()

    await expect(
      call(service, 'verifyPin', { userId: 'u-victim', pin: '1234' }, { user: humanActor }),
    ).rejects.toMatchObject({ code: 403 })

    expect(compareMock).not.toHaveBeenCalled()
    expect(recordPinFailureMock).not.toHaveBeenCalled()
  })

  it('lehnt VOR dem Konto-Status-Check ab, statt Status zu verraten', async () => {
    // Fremder Mandant UND archiviert: Kaeme hier 401 („PIN ungueltig"), stuende
    // der Guard hinter dem Status-Check — und die Antwort verriete, dass es den
    // Datensatz gibt und wie es um ihn steht.
    const { service } = setup({ ...ACTIVE_TARGET, status: UserStatus.ARCHIVED })

    await expect(
      call(service, 'verifyPin', { userId: 'u-victim', pin: '1234' }, { user: deviceActor }),
    ).rejects.toMatchObject({ code: 403 })
  })

  it('laesst den eigenen Mandanten mit richtigem PIN durch', async () => {
    // Gegenprobe: Der Guard darf den Pfad nicht mitnehmen, ueber den sich am
    // Terminal tatsaechlich jeder anmeldet.
    const { service } = setup({ ...ACTIVE_TARGET, tenantId: 't-1' })
    compareMock.mockResolvedValueOnce(true)

    const result = (await call(
      service,
      'verifyPin',
      { userId: 'u-victim', pin: '1234' },
      { user: deviceActor },
    )) as Record<string, unknown>

    expect(result['_id']).toBe('u-victim')
    expect(result['posPin']).toBeUndefined()
  })

  it('laesst die PIN-Tarnung im eigenen Mandanten unveraendert (401, nicht 403)', async () => {
    const { service } = setup({ ...ACTIVE_TARGET, tenantId: 't-1' })
    compareMock.mockResolvedValueOnce(false)

    await expect(
      call(service, 'verifyPin', { userId: 'u-victim', pin: '9999' }, { user: deviceActor }),
    ).rejects.toMatchObject({ code: 401, message: 'PIN ungueltig' })
  })

  it('interner Aufruf ohne params laeuft weiterhin durch', async () => {
    // Gleiche Bedingung wie in `changePin`: ohne Aufrufer kein Vergleich. Der
    // Sync- und Seed-Pfad ruft ohne `params.user` auf.
    const { service } = setup(ACTIVE_TARGET)
    compareMock.mockResolvedValueOnce(true)

    await expect(call(service, 'verifyPin', { userId: 'u-victim', pin: '1234' })).resolves.toMatchObject({
      _id: 'u-victim',
    })
  })
})

describe('changePin prueft den Mandanten weiterhin (Regression)', () => {
  it('lehnt einen fremden Mandanten mit 403 ab und schreibt nicht', async () => {
    const { service, patch } = setup(ACTIVE_TARGET)

    await expect(
      call(
        service,
        'changePin',
        { userId: 'u-victim', currentPin: '1234', newPin: '5678' },
        { user: { ...humanActor, _id: 'u-victim' } },
      ),
    ).rejects.toMatchObject({ code: 403 })
    expect(patch).not.toHaveBeenCalled()
  })
})
