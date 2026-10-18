import { describe, expect, it, vi } from 'vitest'

import type { SetupCredentials } from '../models/device-config.model'

// Admin-Login im POS-Setup (core#754). Die Cloud prüft das Passwort seit dem Account-Split am
// Konto (`account-login`), die rohe `local`-Strategie antwortet dort für Tenant-Konten mit 401.
// Der Hub (Edge) kennt kein `account-login` und bleibt bei `local`.
//
// Mock-Gerüst für den Feathers-Client: `vi.mock` ersetzt socket.io und die drei Feathers-Module.
// Der Fake-Client je Test hängt an `harness` und wird in `createHarness()` frisch gebaut
// (`.claude/rules/testing.md` §10/§10.1) — `vi.mock` ist modulweit, sein Zustand nicht.
interface FakeService {
  find: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

interface Harness {
  authenticate: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
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

const createHarness = () => {
  harness = {
    authenticate: vi.fn().mockResolvedValue({ accessToken: 'jwt' }),
    logout: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    services: {
      'account-login': { find: vi.fn(), create: vi.fn().mockResolvedValue({ accessToken: 'konto-jwt', user: {} }) },
      organizations: { find: vi.fn().mockResolvedValue({ data: [{ _id: 't1', name: 'Backstube' }] }), create: vi.fn() },
      locations: {
        find: vi.fn().mockResolvedValue({ data: [{ _id: 'l1', name: 'Altstadt', tenantId: 't1' }] }),
        create: vi.fn(),
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

  it('erkennt den gesperrten Login wegen fehlender MFA-Einrichtung als zweiten Faktor', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(feathersError(401, 'MFA_GRACE_EXPIRED'))

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'rejected', rejection: { kind: 'mfa-required' } })
  })

  it('wechselt bei einem unbekannten Fehler wie bisher in den Fehler-Schritt', async () => {
    const { service, harness } = createHarness()
    harness.services['account-login'].create.mockRejectedValue(new Error('Connection timeout'))

    const result = await service.adminLogin(cloud())

    expect(result).toEqual({ kind: 'failed' })
    expect(service.registrationStatus()).toBe('error')
    expect(service.registrationError()).toBe('Connection timeout')
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
