import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@panary/shared-backend'

import type { Application } from './declarations'

// Der Handshake ist die einzige Stelle, an der der Edge die Version eines Geräts erfährt (core#1438).
// Geprüft wird, was `channels.ts` daraus macht — nicht die Authentifizierung selbst, die ihre eigene Spec hat.
vi.mock('./utils/device-apikey-auth', () => ({
  authenticateDeviceApiKey: vi.fn(async () => ({
    ok: true,
    state: 'current',
    record: { _id: 'key-1', tenantId: 'tenant-a', locationId: 'loc-1', deviceId: 'dev-1', role: 'device:pos-client' },
  })),
}))
vi.mock('./utils/device-reverification', () => ({
  evaluateDeviceReverification: vi.fn(async () => ({
    due: false,
    alreadyPending: false,
    offlineSince: null,
    offlineForMs: 0,
    thresholdMs: 0,
  })),
  recordReverificationRequired: vi.fn(),
}))
vi.mock('./utils/apikey-last-used', () => ({ stampApiKeyLastUsed: vi.fn() }))

import { channels } from './channels'

type ConnectionHandler = (connection: Record<string, unknown>) => Promise<void>

/** Baut eine Geräteverbindung und lässt den Handshake durchlaufen. */
async function connect(auth: Record<string, unknown>) {
  let onConnection: ConnectionHandler | undefined
  const app = {
    on: (event: string, handler: ConnectionHandler) => {
      if (event === 'connection') onConnection = handler
    },
    channel: () => ({ join: vi.fn() }),
    publish: vi.fn(),
    service: () => ({ find: vi.fn(async () => ({ data: [] })), patch: vi.fn() }),
  } as unknown as Application
  channels(app)

  const emit = vi.fn()
  const connection: Record<string, unknown> = { _socket: { handshake: { auth }, emit } }
  await onConnection?.(connection)
  return { connection, emit }
}

const deviceAuth = { apiKey: 'geheim', deviceId: 'dev-1', deviceName: 'Kasse 1' }

describe('channels: clientVersion im Socket-auth', () => {
  afterEach(() => vi.restoreAllMocks())

  it('hält die Version am Connection-Objekt fest', async () => {
    const { connection } = await connect({ ...deviceAuth, clientVersion: '26.11.15' })
    expect(connection['clientVersion']).toBe('26.11.15')
  })

  it('verbindet einen älteren POS ohne das Feld unverändert, die Version ist unbekannt', async () => {
    const { connection, emit } = await connect(deviceAuth)
    expect(connection['clientVersion']).toBeNull()
    expect(emit).toHaveBeenCalledWith('device:authenticated', expect.objectContaining({ success: true }))
  })

  it('weist weder einen zu langen noch einen nicht-textuellen Wert ab', async () => {
    for (const clientVersion of ['x'.repeat(500), 26.11, { a: 1 }]) {
      const { connection, emit } = await connect({ ...deviceAuth, clientVersion })
      expect(connection['clientVersion']).toBeNull()
      expect(emit).toHaveBeenCalledWith('device:authenticated', expect.objectContaining({ success: true }))
    }
  })

  it('trägt die Version ins Wide Event der Verbindung ein', async () => {
    const info = vi.spyOn(logger, 'info')
    await connect({ ...deviceAuth, clientVersion: '26.11.15' })
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'device.auth', status: 'success', clientVersion: '26.11.15' }),
    )
  })

  it('schreibt den API-Schlüssel nicht ins Wide Event', async () => {
    const info = vi.spyOn(logger, 'info')
    await connect({ ...deviceAuth, clientVersion: '26.11.15' })
    const serialized = JSON.stringify(info.mock.calls)
    expect(serialized).not.toContain('geheim')
  })
})
