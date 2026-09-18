import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '../utils/crypto.utils'
import { __resetDeviceApiKeyAuthState } from '../utils/device-apikey-auth'

// Domain-/Backend-Module mocken, damit Vitest keine Domain-Source kompilieren muss.
// Die Enum-Werte sind die echten (user.schema.ts / permissions.ts) — ein Mock mit
// Platzhalter-Strings haette den `deviceRole`-Bug nicht zeigen koennen, weil dort jeder
// Wert wie jeder andere aussieht. `printServerAuthorize` gehoert nicht hierher, sondern
// in authorize.middleware.spec.ts: die laeuft ohne diesen Mock gegen die echte Matrix.
vi.mock('@panary/users/domain', () => ({
  UserSystemRole: {
    PLATFORM_OWNER: 'platform:owner',
    TENANT_OWNER: 'tenant:owner',
    TENANT_STAFF: 'tenant:staff',
    DEVICE_POS: 'device:pos-client',
    DEVICE_KDS: 'device:kds',
    DEVICE_TABLET: 'device:tablet',
    DEVICE_KIOSK: 'device:kiosk',
  },
  hasEffectivePermission: vi.fn(() => false),
  AppAction: { READ: 'read', CREATE: 'create', UPDATE: 'update', DELETE: 'delete', MANAGE: 'manage' },
  AppResource: { PRINT_SERVER: 'print-server' },
}))
vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { printServerAuth } from './auth.middleware'

interface FakeCtx {
  headers: Record<string, string>
  state: { user?: any; authenticated?: boolean }
  status: number
  body: unknown
}

function makeCtx(headers: Record<string, string>): FakeCtx {
  return { headers, state: {}, status: 0, body: undefined }
}

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-17T12:00:00.000Z')
const inDays = (days: number): string => new Date(NOW + days * DAY_MS).toISOString()

// Aufzeichnung je Test, nicht im `describe`-Scope: `findMock.mock.calls` IST ein
// Aufzeichnungsarray. Eine geteilte `let`-Bindung, die `beforeEach` neu zuweist, liesse einen
// Nachzuegler aus einem abgebrochenen Test in das Handle des naechsten schreiben — dessen
// `mock.calls[0]` waere dann fremd. Siehe `.claude/rules/testing.md` §10.
function makeApp(apiKeyRecords: any[]) {
  const findMock = vi.fn().mockResolvedValue(apiKeyRecords)
  const patchMock = vi.fn(async (id: string, data: Record<string, unknown>) => {
    const row = apiKeyRecords.find(r => r._id === id)
    if (row) Object.assign(row, data)
    return row
  })
  return {
    app: { service: vi.fn().mockReturnValue({ find: findMock, patch: patchMock }) } as any,
    findMock,
    patchMock,
  }
}

describe('printServerAuth – API-Key-Flow', () => {
  // Test-Fixture, kein echtes Credential — gitleaks-Inline-Allow gegen den
  // generic-api-key-False-Positive.
  const RAW_KEY = 'test-print-key-abcd1234' // gitleaks:allow

  const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: 'key-1',
    active: true,
    apikey: sha256(RAW_KEY),
    tenantId: 't1',
    locationId: 'l1',
    deviceId: 'dev1',
    // `role` — das ist der Feldname auf dem apikeys-Record. Bis #329 stand hier
    // `deviceRole`, und weil die Middleware denselben falschen Namen las, bestaetigte
    // das Fixture den Bug, statt ihn zu finden.
    role: 'device:pos-client',
    validUntil: inDays(120),
    ...overrides,
  })

  beforeEach(() => {
    __resetDeviceApiKeyAuthState()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hasht den eingehenden Key und sucht über deviceId statt Klartext', async () => {
    const { app, findMock } = makeApp([record()])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    // Regressionskern: Das Klartext-Feld `apikey` darf NIE in der Query stehen
    // (in der DB liegt nur der SHA-256-Hash). Gesucht wird seit der
    // Schluessel-Rotation ueber `deviceId` und nicht mehr ueber `apikeyPrefix` —
    // der rotierte Schluessel hat einen anderen Prefix als der gespeicherte und
    // waere ueber den Prefix nicht auffindbar.
    const query = findMock.mock.calls[0][0].query
    expect(query.apikey).toBeUndefined()
    expect(query.apikeyPrefix).toBeUndefined()
    expect(query.deviceId).toBe('dev1')
    expect(ctx.state.authenticated).toBe(true)
    expect(ctx.state.user.tenantId).toBe('t1')
    expect(next).toHaveBeenCalledOnce()
  })

  it('lehnt ab, wenn kein Hash-Kandidat matcht (falscher Key)', async () => {
    const { app } = makeApp([record({ apikey: sha256('anderer-key') })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('lehnt einen inaktiven Key trotz korrektem Hash ab', async () => {
    const { app } = makeApp([record({ active: false })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('druckt in der Karenz weiter (200 statt 401)', async () => {
    // Der Socket steht, der Schluessel laeuft mitten in der Schicht ab: Ohne
    // Karenz brechen hier die Bons ab, waehrend die Kasse weiterlaeuft.
    const { app } = makeApp([record({ validUntil: inDays(-10) })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.status).not.toBe(401)
    expect(ctx.state.authenticated).toBe(true)
    expect(next).toHaveBeenCalledOnce()
  })

  it('akzeptiert den bereits rotierten Schluessel, den der Client seit dem Handshake sendet', async () => {
    const rows = [
      record({
        apikey: sha256('alter-key'),
        pendingApikey: sha256(RAW_KEY),
        pendingApikeyPrefix: RAW_KEY.slice(0, 8),
        pendingApikeyCreatedAt: inDays(-1),
      }),
    ]
    const { app } = makeApp(rows)
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.state.authenticated).toBe(true)
    expect(next).toHaveBeenCalledOnce()
    // Der Print-Pfad promotet mit — sonst bliebe der alte Hash stehen, bis das
    // Geraet zufaellig einen Handshake macht.
    expect(rows[0].apikey).toBe(sha256(RAW_KEY))
  })

  it('stellt ueber HTTP keinen neuen Schluessel aus', async () => {
    // Ueber HTTP gibt es keinen Kanal, auf dem der Client zuhoert — ein hier
    // ausgestellter Schluessel wuerde nie abgeholt und den zugestellten entwerten.
    const rows = [record({ validUntil: inDays(1) })]
    const { app } = makeApp(rows)
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })

    await printServerAuth(app)(ctx as any, vi.fn())

    expect(rows[0].pendingApikey).toBeUndefined()
  })

  it('lehnt jenseits der Karenz mit einer Meldung ab, die den Weg zurueck nennt', async () => {
    const { app } = makeApp([record({ validUntil: inDays(-100) })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.status).toBe(401)
    expect(String((ctx.body as { error: string }).error)).toContain('abgelaufen')
    expect(next).not.toHaveBeenCalled()
  })
})

// Der Kern von panary/panary-core#329: Welche Rolle traegt der virtuelle Geraete-User?
// Bis dahin las die Middleware `keyRecord.deviceRole` — ein Feld, das auf einem
// apikeys-Record nie existiert (`apikeySchema` kennt nur `role`, additionalProperties:
// false) — und fiel deshalb ausnahmslos auf DEVICE_POS zurueck.
describe('printServerAuth – Rolle des Schluessels', () => {
  const RAW_KEY = 'test-print-key-abcd1234' // gitleaks:allow

  const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: 'key-1',
    active: true,
    apikey: sha256(RAW_KEY),
    tenantId: 't1',
    locationId: 'l1',
    deviceId: 'dev1',
    role: 'device:pos-client',
    validUntil: inDays(120),
    ...overrides,
  })

  beforeEach(() => {
    __resetDeviceApiKeyAuthState()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uebernimmt die echte Rolle des Records (KDS bleibt KDS)', async () => {
    const { app } = makeApp([record({ role: 'device:kds' })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })

    await printServerAuth(app)(ctx as any, vi.fn())

    expect(ctx.state.user.role).toBe('device:kds')
  })

  it('liest NICHT mehr das alte deviceRole-Feld, auch wenn es am Record haengt', async () => {
    // Der Regressionskern: Ein Record, der beide Felder traegt, unterscheidet die
    // korrigierte Fassung von der alten. Waere `deviceRole` noch die Quelle, kaeme hier
    // `tenant:owner` heraus — eine Rechte-Ausweitung statt der Geraeterolle.
    const { app } = makeApp([record({ role: 'device:kds', deviceRole: 'tenant:owner' })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })

    await printServerAuth(app)(ctx as any, vi.fn())

    expect(ctx.state.user.role).toBe('device:kds')
  })

  it('erbt ohne Rolle keine Druckrechte (kein stiller DEVICE_POS-Fallback)', async () => {
    // Bestandsdaten-Fall: eine apikeys-Zeile ohne `role`. Frueher wurde daraus
    // lautlos ein POS-Geraet mit Druckrecht.
    const { app } = makeApp([record({ role: undefined })])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })

    await printServerAuth(app)(ctx as any, vi.fn())

    expect(ctx.state.user.role).toBeUndefined()
    expect(ctx.state.user.role).not.toBe('device:pos-client')
  })
})
