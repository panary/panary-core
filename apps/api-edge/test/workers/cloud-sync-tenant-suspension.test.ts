// Fokus-Test: Mandantensperre aus `/sync-pull` (panary/panary-core#1401).
//
// Der POS im Edge-Tier spricht nie selbst mit der Cloud. Er erfährt die Sperre nur,
// wenn der Edge sie aus dem Pull übernimmt und über `/health` meldet. Eingefroren wird:
// 403 TENANT_SUSPENDED setzt den Zustand, ein durchgelaufener Pull hebt ihn auf, andere
// Fehler (generischer 403, 500) lassen ihn stehen bzw. setzen ihn nicht.
//
// Kein App-Boot: gemockt werden `sync-cursor` und `globalThis.fetch`; die App-Settings
// (`app.get`/`app.set`) liegen je Test in einer eigenen Map (§10).
import assert from 'assert'
import { afterEach, describe, it } from 'vitest'

import type { CloudConnection } from '@panary/cloud-connection/domain'

import type { Application } from '../../src/declarations'
import { getCloudTenantSuspension, tenantSuspensionForHealth } from '../../src/utils/cloud-tenant-suspension'
import { runPullForService } from '../../src/workers/cloud-sync-scheduler.worker'

interface StubResponse {
  status: number
  body: unknown
}

const connection = {
  _id: 'conn-1',
  cloudUrl: 'https://cloud.test',
  cloudToken: 'test-token',
  tenantId: 'tenant-1',
  locationId: 'loc-1',
} as unknown as CloudConnection

const originalFetch = globalThis.fetch

/** Eigene App je Test: Settings-Map + Cursor-Stub, der nichts nach aussen teilt. */
const createApp = (): Application => {
  const settings = new Map<string, unknown>()
  const cursorService = {
    get: async (): Promise<never> => {
      throw new Error('nicht gefunden')
    },
    patch: async (): Promise<Record<string, unknown>> => ({}),
    create: async (data: Record<string, unknown>): Promise<Record<string, unknown>> => data,
  }
  return {
    get: (key: string) => settings.get(key),
    set: (key: string, value: unknown) => settings.set(key, value),
    service: (path: string) => {
      if (path === 'sync-cursor') return cursorService
      throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
    },
  } as unknown as Application
}

const stubFetch = (stub: StubResponse): void => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(stub.body), {
      status: stub.status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
}

const suspendedBody = (tenantStatus: string) => ({
  name: 'Forbidden',
  message: `TENANT_SUSPENDED: Der Mandant ist gesperrt (${tenantStatus}).`,
  code: 403,
  data: { code: 'TENANT_SUSPENDED', tenantStatus },
})

const okBody = { records: [], hasMore: false, serverTimestamp: '2026-11-09T18:00:00.000Z' }

describe('cloud-sync-scheduler worker — Mandantensperre aus sync-pull (#1401)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('vor dem ersten Pull ist der Zustand unbekannt, /health laesst das Feld weg', () => {
    const app = createApp()

    assert.strictEqual(getCloudTenantSuspension(app), undefined)
    assert.strictEqual(tenantSuspensionForHealth(app, true), undefined)
  })

  it('403 TENANT_SUSPENDED setzt die Sperre mit dem Status der Cloud', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: suspendedBody('SUSPENDED') })

    await assert.rejects(() => runPullForService(app, connection, 'products'))

    assert.deepStrictEqual(tenantSuspensionForHealth(app, true), { tenantStatus: 'SUSPENDED' })
  })

  it('ARCHIVED zaehlt wie SUSPENDED', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: suspendedBody('ARCHIVED') })

    await assert.rejects(() => runPullForService(app, connection, 'products'))

    assert.deepStrictEqual(tenantSuspensionForHealth(app, true), { tenantStatus: 'ARCHIVED' })
  })

  it('ein erfolgreicher Pull hebt die Sperre auf', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: suspendedBody('SUSPENDED') })
    await assert.rejects(() => runPullForService(app, connection, 'products'))

    stubFetch({ status: 200, body: okBody })
    await runPullForService(app, connection, 'products')

    assert.strictEqual(tenantSuspensionForHealth(app, true), null)
  })

  it('ein generischer 403 setzt keine Sperre', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: { name: 'Forbidden', message: 'Keine Berechtigung', code: 403 } })

    await assert.rejects(() => runPullForService(app, connection, 'products'))

    assert.strictEqual(tenantSuspensionForHealth(app, true), undefined)
  })

  it('ein 500 nach der Sperre laesst sie stehen', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: suspendedBody('SUSPENDED') })
    await assert.rejects(() => runPullForService(app, connection, 'products'))

    stubFetch({ status: 500, body: { message: 'boom' } })
    await assert.rejects(() => runPullForService(app, connection, 'products'))

    assert.deepStrictEqual(tenantSuspensionForHealth(app, true), { tenantStatus: 'SUSPENDED' })
  })

  it('ohne gekoppelte Cloud meldet /health keine Sperre, auch wenn der Merker noch steht', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: suspendedBody('SUSPENDED') })
    await assert.rejects(() => runPullForService(app, connection, 'products'))

    assert.strictEqual(tenantSuspensionForHealth(app, false), null)
  })

  it('erkennt die Sperre auch nur am Message-Praefix, dann ohne Status', async () => {
    const app = createApp()
    stubFetch({ status: 403, body: { name: 'Forbidden', message: 'TENANT_SUSPENDED: gesperrt', code: 403 } })

    await assert.rejects(() => runPullForService(app, connection, 'products'))

    assert.deepStrictEqual(tenantSuspensionForHealth(app, true), { tenantStatus: null })
  })
})
