import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '../utils/crypto.utils'

// Domain-/Backend-Module mocken, damit Vitest keine Domain-Source kompilieren muss.
// `printServerAuthorize` (nutzt RolePermissions/AppAction/AppResource) wird hier nicht
// getestet — für den API-Key-Flow genügt UserSystemRole als Fallback-Wert.
vi.mock('@panary/users/domain', () => ({
  UserSystemRole: { DEVICE_POS: 'device:pos-client', PLATFORM_OWNER: 'platform:owner' },
  RolePermissions: {},
  AppAction: {},
  AppResource: {},
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

describe('printServerAuth – API-Key-Flow', () => {
  // Test-Fixture, kein echtes Credential — gitleaks-Inline-Allow gegen den
  // generic-api-key-False-Positive.
  const RAW_KEY = 'test-print-key-abcd1234' // gitleaks:allow
  let findMock: ReturnType<typeof vi.fn>
  let app: any

  beforeEach(() => {
    findMock = vi.fn()
    app = { service: vi.fn().mockReturnValue({ find: findMock }) }
  })

  it('hasht den eingehenden Key und sucht über apikeyPrefix statt Klartext', async () => {
    findMock.mockResolvedValue([
      { active: true, apikey: sha256(RAW_KEY), tenantId: 't1', locationId: 'l1', deviceRole: 'device:pos-client' },
    ])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    // Regressionskern: Lookup läuft über den Prefix des Klartext-Keys, NICHT über
    // das Klartext-Feld `apikey` (das in der DB nur als SHA-256-Hash existiert).
    const query = findMock.mock.calls[0][0].query
    expect(query.apikeyPrefix).toBe(RAW_KEY.slice(0, 8))
    expect(query.apikey).toBeUndefined()
    expect(query.deviceId).toBe('dev1')
    expect(ctx.state.authenticated).toBe(true)
    expect(ctx.state.user.tenantId).toBe('t1')
    expect(next).toHaveBeenCalledOnce()
  })

  it('lehnt ab, wenn kein Hash-Kandidat matcht (falscher Key)', async () => {
    findMock.mockResolvedValue([{ active: true, apikey: sha256('anderer-key'), tenantId: 't1', locationId: 'l1' }])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('lehnt einen inaktiven Key trotz korrektem Hash ab', async () => {
    findMock.mockResolvedValue([{ active: false, apikey: sha256(RAW_KEY), tenantId: 't1', locationId: 'l1' }])
    const ctx = makeCtx({ 'x-api-key': RAW_KEY, 'x-device-id': 'dev1' })
    const next = vi.fn()

    await printServerAuth(app)(ctx as any, next)

    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
