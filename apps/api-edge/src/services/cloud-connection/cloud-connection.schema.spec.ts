import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/cloud-token-cipher', () => ({
  encryptCloudToken: (v: string) => `enc:${v}`,
  decryptCloudToken: (v: string) => v,
}))

import { cloudConnectionPatchResolver } from './cloud-connection.schema'

/**
 * Der Notfall-Modus steuert, ob der `cloudManaged()`-Hook lokale
 * Drucker-Patches durchlaesst. Waeren die Felder extern patchbar, koennte ein
 * authentifizierter Client mit CLOUD_CONNECTION: MANAGE die Cloud-Hoheit ueber
 * Standort-Stammdaten aushebeln — ohne RBAC-Eintrag und ohne Audit-Spur. Der
 * einzige externe Weg ist die Custom-Method `setEmergencyOverride`.
 */
const resolvePatch = (data: Record<string, unknown>, provider: string | undefined) =>
  (
    cloudConnectionPatchResolver as unknown as {
      resolve: (d: unknown, c: unknown) => Promise<Record<string, unknown>>
    }
  ).resolve(data, { params: { provider } })

const GUARDED_FIELDS = [
  'emergencyOverride',
  'emergencyOverrideSince',
  'emergencyOverrideSource',
  'emergencyOverrideSuppressedUntil',
  'lastHeartbeatOk',
  'consecutiveHeartbeatFailures',
] as const

beforeEach(() => vi.clearAllMocks())

describe('cloudConnectionPatchResolver — Notfall-Modus-Felder', () => {
  it.each(GUARDED_FIELDS)('strippt %s aus externen Patches', async field => {
    const resolved = await resolvePatch({ [field]: field === 'consecutiveHeartbeatFailures' ? 0 : true }, 'rest')

    expect(resolved[field]).toBeUndefined()
  })

  it.each(GUARDED_FIELDS)('laesst %s bei internen Aufrufen durch', async field => {
    const value = field === 'consecutiveHeartbeatFailures' ? 3 : 'x'
    const resolved = await resolvePatch({ [field]: value }, undefined)

    expect(resolved[field]).toBe(value)
  })

  // Bewusste Ausnahme: der OfflineOverrideService im Admin patcht dieses Feld
  // extern (Banner-Aktion "Offline-Modus aktivieren").
  it('laesst offlineOverrideActiveUntil extern durch', async () => {
    const until = new Date().toISOString()
    const resolved = await resolvePatch({ offlineOverrideActiveUntil: until }, 'rest')

    expect(resolved['offlineOverrideActiveUntil']).toBe(until)
  })

  it('setzt updatedAt immer serverseitig', async () => {
    const resolved = await resolvePatch({ updatedAt: '1999-01-01T00:00:00.000Z' }, 'rest')

    expect(resolved['updatedAt']).not.toBe('1999-01-01T00:00:00.000Z')
  })
})
