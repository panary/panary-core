// Fokus-Test fuer den Token-Schluessel-Zustand im Cloud-Heartbeat (core#1508).
//
// Kein App-Boot: gemockt werden `cloud-connection`, `device-connections` und `globalThis.fetch`. Die Aussagen:
// - der gesendete Body traegt `tokenKey` (nur der Zustand),
// - weder der Schluessel noch ein Teil davon steht im gesendeten Body,
// - ein 200 der Cloud laesst den Heartbeat wie bisher gelingen.
import assert from 'assert'

import type { CloudConnection } from '@panary/cloud-connection/domain'
import { SyncRunTrigger } from '@panary/sync/domain'

import type { Application } from '../../src/declarations'
import { runHeartbeatPhase } from '../../src/workers/cloud-sync-scheduler.worker'

describe('cloud-sync-scheduler worker — tokenKey im Heartbeat', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env['EDGE_TOKEN_ENCRYPTION_KEY']

  const baseConnection = {
    _id: 'conn-1',
    cloudUrl: 'https://cloud.test',
    cloudToken: 'test-token',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
  } as unknown as CloudConnection

  const makeApp = (): Application =>
    ({
      service: (path: string) => {
        if (path === 'cloud-connection') return { _patch: async (_id: string, data: unknown) => data }
        if (path === 'sync-runs') return { create: async (data: unknown) => data }
        if (path === 'device-connections') return { find: async () => ({ online: 0, total: 0 }) }
        throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
      },
    }) as unknown as Application

  /** Fuehrt einen Heartbeat aus und liefert den als String gesendeten Body. */
  const sendeHeartbeat = async (): Promise<string> => {
    let sent = ''
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = String(init?.body ?? '')
      return new Response(
        JSON.stringify({ serverTimestamp: new Date().toISOString(), clockSkewStatus: 'ok', clockSkewMs: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await runHeartbeatPhase(makeApp(), baseConnection, SyncRunTrigger.SCHEDULER)

    assert.ok(result.heartbeat, 'Der Heartbeat muss gelingen')
    return sent
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
    else process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = originalKey
  })

  it('ohne Schluessel traegt der Body tokenKey missing', async () => {
    delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']

    const body = JSON.parse(await sendeHeartbeat()) as Record<string, unknown>

    assert.strictEqual(body['tokenKey'], 'missing')
  })

  it('mit 12 Zeichen traegt der Body tokenKey weak', async () => {
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'zwoelf-zeich'

    const body = JSON.parse(await sendeHeartbeat()) as Record<string, unknown>

    assert.strictEqual(body['tokenKey'], 'weak')
  })

  it('mit 44 Zeichen traegt der Body tokenKey ok', async () => {
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'k'.repeat(44)

    const body = JSON.parse(await sendeHeartbeat()) as Record<string, unknown>

    assert.strictEqual(body['tokenKey'], 'ok')
  })

  it('der Schluesselwert steht nirgends im gesendeten Body', async () => {
    const key = 'GEHEIMER-SCHLUESSEL-' + 'x9Qz'.repeat(8)
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = key

    const raw = await sendeHeartbeat()

    assert.ok(!raw.includes(key), 'Der Schluessel darf den Body nicht erreichen')
    assert.ok(!raw.includes('GEHEIMER'), 'Auch kein Teil des Schluessels')
    const body = JSON.parse(raw) as Record<string, unknown>
    assert.strictEqual(body['tokenKey'], 'ok')
    // Keine Laenge, kein Hash: ausser `tokenKey` traegt kein Feld einen Hinweis auf den Schluessel.
    assert.ok(!Object.keys(body).some(k => /key/i.test(k) && k !== 'tokenKey'), 'Kein weiteres Schluesselfeld')
  })
})
