import { describe, expect, it, vi, type Mock } from 'vitest'

import type { SetupCredentials } from '../models/device-config.model'

// Admin-Login im POS-Setup (core#754). Die Cloud prüft das Passwort seit dem Account-Split am
// Konto (`account-login`), die rohe `local`-Strategie antwortet dort für Tenant-Konten mit 401.
// Der Hub (Edge) kennt kein `account-login` und bleibt bei `local`.
//
// Mock-Gerüst für den Feathers-Client: `vi.mock` ersetzt socket.io und die drei Feathers-Module.
// Abweichung von `.claude/rules/testing.md` §10: Die Mock-Factories sind modulweit und lesen
// deshalb die Modulbindung `harness`, die `createHarness()` je Test neu belegt. Ein Nachzügler
// aus einem früheren Test schriebe in den Harness des nächsten. Ausgeschlossen ist das hier,
// weil jeder Test `adminLogin()` vollständig awaitet und kein Timer läuft (`connect` kommt per
// Microtask, der 10-s-Timeout wird gelöscht).
type AsyncMock = Mock<(...args: unknown[]) => Promise<unknown>>

interface FakeService {
  find: AsyncMock
  create: AsyncMock
}

interface Harness {
  authenticate: AsyncMock
  logout: AsyncMock
  disconnect: Mock<() => void>
  services: Record<string, FakeService>
}

let harness: Harness

vi.mock('socket.io-client', () => ({
  default: () => ({
    on: (event: string, cb: () => void) => {
      if (event === 'connect') queueMicrotask(cb)
    },
    disconnect: () => harness.disconnect(),
  }),
}))
vi.mock('@feathersjs/socketio-client', () => ({ default: () => () => undefined }))
vi.mock('@feathersjs/authentication-client', () => ({ default: () => () => undefined }))
vi.mock('@feathersjs/feathers', () => ({
  feathers: () => ({
    configure: () => undefined,
    authenticate: (...args: unknown[]) => harness.authenticate(...args),
    logout: () => harness.logout(),
    service: (name: string) => {
      const service = harness.services[name]
      if (!service) throw new Error(`Unerwarteter Service im Test: ${name}`)
      return service
    },
  }),
}))

const { DeviceConfigService } = await import('./device-config.service')

class MemoryStorage {
  #data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value)
  }
  removeItem(key: string): void {
    this.#data.delete(key)
  }
}

const feathersError = (code: number, message: string, data?: unknown) =>
  Object.assign(new Error(message), { code, data })

const asyncMock = (value: unknown): AsyncMock =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(value)

const createHarness = () => {
  harness = {
    authenticate: asyncMock({ accessToken: 'jwt' }),
    logout: asyncMock(undefined),
    disconnect: vi.fn<() => void>(),
    services: {
      'account-login': { find: asyncMock(undefined), create: asyncMock({ accessToken: 'konto-jwt', user: {} }) },
      organizations: { find: asyncMock({ data: [{ _id: 't1', name: 'Backstube' }] }), create: asyncMock(undefined) },
      locations: {
        find: asyncMock({ data: [{ _id: 'l1', name: 'Altstadt', tenantId: 't1' }] }),
        create: asyncMock(undefined),
      },
    },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  ;(globalThis as { fetch?: unknown }).fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  return { service: new DeviceConfigService(), harness }
}

const cloud = (extra: Partial<SetupCredentials> = {}): SetupCredentials => ({
  serverUrl: 'https://api.panary.test',
  email: 'owner@example.invalid',
  password: 'geheim',
  target: 'cloud',
  ...extra,
})

describe('DeviceConfigService.adminLogin — Cloud über account-login', () => {
  it('meldet sich am Konto an und übergibt das Token per jwt-Strategie', async () => {
    const { service, harness } = createHarness()

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'ok' })
    expect(harness.services['account-login'].create).toHaveBeenCalledWith({
      email: 'owner@example.invalid',
      password: 'geheim',
    })
    expect(harness.authenticate).toHaveBeenCalledTimes(1)
    expect(harness.authenticate).toHaveBeenCalledWith({ strategy: 'jwt', accessToken: 'konto-jwt' })
    expect(service.organizations()).toEqual([{ _id: 't1', name: 'Backstube' }])
    expect(service.locations()).toEqual([{ _id: 'l1', name: 'Altstadt', tenantId: 't1' }])
    expect(service.registrationStatus()).toBe('idle')
  })

  it('reicht die gewählte Mitgliedschaft im zweiten Aufruf mit', async () => {
    const { service, harness } = createHarness()

    await service.adminLogin(cloud({ membershipId: 'm2' }))

    expect(harness.services['account-login'].create).toHaveBeenCalledWith({
      email: 'owner@example.invalid',
      password: 'geheim',
      membershipId: 'm2',
    })
  })

  it('liefert bei mehreren Mitgliedschaften die Auswahl, ohne sich anzumelden', async () => {
    const { service, harness } = createHarness()
    const memberships = [
      { membershipId: 'm1', tenantId: 't1', tenantName: 'Backstube', role: 'tenant:owner' },
      { membershipId: 'm2', tenantId: 't2', tenantName: 'Café Hafen', role: 'tenant:manager' },
    ]
    harness.services['account-login'].create.mockResolvedValue({ requiresSelection: true, memberships })

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'selection', memberships })
    expect(harness.authenticate).not.toHaveBeenCalled()
    expect(harness.services['organizations'].find).not.toHaveBeenCalled()
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
    expect(service.registrationStatus()).toBe('idle')
  })

  it('weist ein Konto mit zweitem Faktor ab, ohne Token und ohne Fehler-Schritt', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockResolvedValue({
      requiresMfa: true,
      membershipId: 'm1',
      challengeId: 'c1',
      options: {},
    })

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'mfa-required' } })
    expect(harness.authenticate).not.toHaveBeenCalled()
    expect(service.registrationStatus()).toBe('idle')
  })

  it('zeigt ein falsches Passwort im Formular statt im Fehler-Schritt', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(feathersError(401, 'Ungültige Zugangsdaten'))

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'invalid-credentials' } })
    expect(service.registrationStatus()).toBe('idle')
    expect(service.registrationError()).toBeNull()
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
  })

  it('reicht die Drosselung mit Wartezeit weiter', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(
      feathersError(429, 'Zu viele Anmeldeversuche', { retryAfter: 41.2 }),
    )

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'rate-limited', retryAfter: 42 } })
  })

  it('reicht 503 des Hash-Gates als Überlast weiter', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(feathersError(503, 'Bitte später erneut'))

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'unavailable' } })
  })

  it.each(['MFA_GRACE_EXPIRED', 'PLATFORM_MFA_ENROLLMENT_REQUIRED'])(
    'erkennt den gesperrten Login %s als zweiten Faktor',
    async code => {
      const { service, harness } = createHarness()
      harness.services['account-login'].create.mockRejectedValue(feathersError(401, code))

      const result = await service.adminLogin(cloud())

      expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'mfa-required' } })
    },
  )

  it('wechselt bei einem unbekannten Fehler wie bisher in den Fehler-Schritt', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(new Error('Connection timeout'))

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'failed' })
    expect(service.registrationStatus()).toBe('error')
    expect(service.registrationError()).toBe('Connection timeout')
  })

  it('wertet eine Auswahl ohne gültige Mitgliedschaften als Fehler statt als leere Liste', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockResolvedValue({
      requiresSelection: true,
      memberships: [{ tenantName: 'ohne membershipId' }],
    })

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'failed' })
    expect(harness.authenticate).not.toHaveBeenCalled()
  })

  it('liest eine Antwort ohne Token nie als Sitzung', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockResolvedValue({ user: {} })

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'failed' })
    expect(harness.authenticate).not.toHaveBeenCalled()
  })

  it('klassifiziert ein 401 beim Laden der Organisationen nicht als falsches Passwort', async () => {
    const { service, harness } = createHarness()
    harness.services['organizations'].find.mockRejectedValue(feathersError(401, 'Not authenticated'))

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'failed' })
    expect(service.registrationError()).toBe('Organisationen/Standorte konnten nicht geladen werden')
  })
})

describe('DeviceConfigService.adminLogin — Login-Nachweis (core#755)', () => {
  const challenge = {
    parameters: { algorithm: 'PBKDF2/SHA-256', nonce: 'ab', salt: 'cd', keyPrefix: '00' },
    signature: 's',
  }
  const proofRequired = (reason = 'required') =>
    Object.assign(
      feathersError(428, 'Für diese Anmeldung ist ein Sicherheitsnachweis nötig.', { loginProof: reason, challenge }),
      {
        className: 'login-proof-required',
      },
    )
  const payload = { challenge, solution: { counter: 7, derivedKey: '00ff' } }

  it('löst den verlangten Nachweis und wiederholt den Aufruf mit ihm', async () => {
    const { service, harness } = createHarness()
    const create = harness.services['account-login'].create
    create.mockRejectedValueOnce(proofRequired())
    const statusWhileSolving: string[] = []
    const solveLoginProof = vi.fn(async (c: unknown) => {
      statusWhileSolving.push(service.registrationStatus())
      expect(c).toEqual(challenge)
      return payload
    })

    const result = await service.adminLogin(cloud(), { solveLoginProof })

    expect(result).toEqual({ kind: 'ok' })
    expect(solveLoginProof).toHaveBeenCalledTimes(1)
    expect(statusWhileSolving).toEqual(['solving'])
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]).toEqual([{ email: 'owner@example.invalid', password: 'geheim', loginProof: payload }])
    expect(harness.authenticate).toHaveBeenCalledWith({ strategy: 'jwt', accessToken: 'konto-jwt' })
  })

  it('wiederholt höchstens einmal und zeigt danach die Abweisung im Formular', async () => {
    const { service, harness } = createHarness()
    const create = harness.services['account-login'].create
    create.mockRejectedValue(proofRequired('invalid'))
    const solveLoginProof = vi.fn(async () => payload)

    const result = await service.adminLogin(cloud(), { solveLoginProof })

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'proof-failed' } })
    expect(solveLoginProof).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(2)
    expect(service.registrationStatus()).toBe('idle')
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
  })

  it('bricht ab, wenn das Gerät den Nachweis nicht löst, und baut den Socket ab', async () => {
    const { service, harness } = createHarness()
    const create = harness.services['account-login'].create
    create.mockRejectedValue(proofRequired())
    const solveLoginProof = vi.fn(async () => {
      throw new Error('Login-Nachweis nach 20000 ms nicht gelöst')
    })

    const result = await service.adminLogin(cloud(), { solveLoginProof })

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'proof-failed' } })
    expect(create).toHaveBeenCalledTimes(1)
    expect(service.registrationStatus()).toBe('idle')
    expect(service.registrationError()).toBeNull()
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
  })

  it('weist ohne Löser ab, statt in den Fehler-Schritt zu wechseln', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(proofRequired())

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'proof-failed' } })
    expect(service.registrationStatus()).toBe('idle')
  })

  it('gibt den Nachweis beim Auswahl-Folgeaufruf mit, ohne neu zu rechnen', async () => {
    const { service, harness } = createHarness()
    const create = harness.services['account-login'].create
    const memberships = [
      { membershipId: 'm1', tenantId: 't1', tenantName: 'Backstube', role: 'tenant:owner' },
      { membershipId: 'm2', tenantId: 't2', tenantName: 'Café Hafen', role: 'tenant:manager' },
    ]
    create.mockRejectedValueOnce(proofRequired()).mockResolvedValueOnce({ requiresSelection: true, memberships })
    const solveLoginProof = vi.fn(async () => payload)

    const first = await service.adminLogin(cloud(), { solveLoginProof })
    const second = await service.adminLogin(cloud({ membershipId: 'm2' }), { solveLoginProof })

    expect(first).toEqual({ kind: 'selection', memberships })
    expect(second).toEqual({ kind: 'ok' })
    expect(solveLoginProof).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(3)
    expect(create.mock.calls[2]).toEqual([
      { email: 'owner@example.invalid', password: 'geheim', membershipId: 'm2', loginProof: payload },
    ])
  })

  it('rechnet neu, wenn die Cloud den mitgegebenen Nachweis nicht mehr annimmt', async () => {
    const { service, harness } = createHarness()
    const create = harness.services['account-login'].create
    const memberships = [
      { membershipId: 'm1', tenantId: 't1', tenantName: 'Backstube', role: 'tenant:owner' },
      { membershipId: 'm2', tenantId: 't2', tenantName: 'Café Hafen', role: 'tenant:manager' },
    ]
    create
      .mockRejectedValueOnce(proofRequired())
      .mockResolvedValueOnce({ requiresSelection: true, memberships })
      .mockRejectedValueOnce(proofRequired('expired'))
    const solveLoginProof = vi.fn(async () => payload)

    await service.adminLogin(cloud(), { solveLoginProof })
    const second = await service.adminLogin(cloud({ membershipId: 'm2' }), { solveLoginProof })

    expect(second).toEqual({ kind: 'ok' })
    expect(solveLoginProof).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(4)
  })

  it('gibt den Nachweis einer anderen E-Mail nicht mit', async () => {
    const { service, harness } = createHarness()
    const create = harness.services['account-login'].create
    const memberships = [
      { membershipId: 'm1', tenantId: 't1', tenantName: 'Backstube', role: 'tenant:owner' },
      { membershipId: 'm2', tenantId: 't2', tenantName: 'Café Hafen', role: 'tenant:manager' },
    ]
    create.mockRejectedValueOnce(proofRequired()).mockResolvedValueOnce({ requiresSelection: true, memberships })
    const solveLoginProof = vi.fn(async () => payload)

    await service.adminLogin(cloud(), { solveLoginProof })
    await service.adminLogin(cloud({ email: 'technik@example.invalid' }), { solveLoginProof })

    expect(create.mock.calls[2]).toEqual([{ email: 'technik@example.invalid', password: 'geheim' }])
  })

  it('verlangt am Hub keinen Nachweis', async () => {
    const { service } = createHarness()
    const solveLoginProof = vi.fn(async () => payload)

    const result = await service.adminLogin(cloud({ serverUrl: 'http://192.168.1.5:3030', target: 'hub' }), {
      solveLoginProof,
    })

    expect(result).toEqual({ kind: 'ok' })
    expect(solveLoginProof).not.toHaveBeenCalled()
  })
})

describe('DeviceConfigService.adminLogin — Hub bleibt bei local', () => {
  it('meldet sich am Edge mit der local-Strategie an und ruft kein account-login', async () => {
    const { service, harness } = createHarness()

    const result = await service.adminLogin(cloud({ serverUrl: 'http://192.168.1.5:3030', target: 'hub' }))

    expect(result).toEqual({ kind: 'ok' })
    expect(harness.authenticate).toHaveBeenCalledWith({
      strategy: 'local',
      email: 'owner@example.invalid',
      password: 'geheim',
    })
    expect(harness.services['account-login'].create).not.toHaveBeenCalled()
  })

  it('zeigt auch am Hub ein falsches Passwort im Formular', async () => {
    const { service, harness } = createHarness()
    harness.authenticate.mockRejectedValue(feathersError(401, 'Invalid login'))

    const result = await service.adminLogin(cloud({ serverUrl: 'http://192.168.1.5:3030', target: 'hub' }))

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'invalid-credentials' } })
  })
})
