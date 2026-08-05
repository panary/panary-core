// Fokus-Test fuer die 429-Behandlung der Cloud-Sync-Pfade.
//
// Kein App-Boot: gemockt werden `cloud-connection`, `sync-outbox`,
// `sync-conflicts`, `sync-cursor`, `sync-runs` und `globalThis.fetch`.
//
// Die Aussage, die dieser Test einfriert, ist die teuerste der Datei: ein
// Cloud-Rate-Limit darf den Notfall-Modus der Edge NICHT aktivieren, die
// Outbox nicht terminal setzen und das Pairing nicht anfassen. Jeder Fall hat
// einen Gegen-Test mit HTTP 500, der belegt, dass ausschliesslich 429
// ausgenommen ist — nicht Fehler im Allgemeinen.
import assert from 'assert'

import type { CloudConnection } from '@panary/cloud-connection/domain'
import {
  MAX_RETRY_ATTEMPTS,
  RATE_LIMIT_FALLBACK_DELAY_MS,
  SyncOp,
  SyncOutboxStatus,
  SyncRunOutcome,
  SyncSource,
} from '@panary/sync/domain'

import type { Application } from '../../src/declarations'
import { runHeartbeatPhase, runPullForService, runPush } from '../../src/workers/cloud-sync-scheduler.worker'
import { CloudRateLimitedError } from '../../src/workers/sync-apply'
import { SyncRunTrigger } from '@panary/sync/domain'

interface OutboxRow {
  _id: string
  service: string
  op: string
  entityId: string
  payload: string
  occurredAt: string
  syncSource: string
  status: string
  attempts: number
  nextAttemptAt: string
  lastAttemptAt?: string
  lastError?: string
  terminalAt?: string
  linkedConflictId?: string
}

/** Antwort, die `globalThis.fetch` im jeweiligen Test liefern soll. */
interface StubResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

describe('cloud-sync-scheduler worker — Cloud-Rate-Limit (429)', () => {
  let rows: OutboxRow[]
  let conflicts: Array<Record<string, unknown>>
  let connectionPatches: Array<Record<string, unknown>>
  let syncRuns: Array<Record<string, unknown>>
  let cursorWrites: Array<{ op: 'get' | 'patch' | 'create'; id?: string }>
  let stub: StubResponse

  const originalFetch = globalThis.fetch

  const seedEntry = (id: string, attempts: number): void => {
    const past = new Date(Date.now() - 60_000).toISOString()
    rows.push({
      _id: id,
      service: 'orders',
      op: SyncOp.CREATE,
      entityId: `entity-${id}`,
      payload: JSON.stringify({ n: id }),
      occurredAt: past,
      syncSource: SyncSource.LIVE,
      status: SyncOutboxStatus.PENDING,
      attempts,
      nextAttemptAt: past,
    })
  }

  const outboxService = {
    find: async (params: {
      query: { status: string; nextAttemptAt: { $lte: string }; $limit: number }
    }): Promise<OutboxRow[]> =>
      rows
        .filter(r => r.status === params.query.status && r.nextAttemptAt <= params.query.nextAttemptAt.$lte)
        .sort((a, b) => (a._id < b._id ? -1 : 1))
        .slice(0, params.query.$limit)
        .map(r => ({ ...r })),
    patch: async (id: string, data: Partial<OutboxRow>): Promise<OutboxRow> => {
      const row = rows.find(r => r._id === id)
      if (!row) throw new Error(`Outbox-Eintrag ${id} nicht gefunden`)
      Object.assign(row, data)
      return row
    },
  }

  const conflictsService = {
    create: async (data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      conflicts.push(data)
      return data
    },
  }

  // `runHeartbeatPhase` patcht ueber `_patch` (interner Adapter-Aufruf).
  const cloudConnectionService = {
    _patch: async (_id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      connectionPatches.push(data)
      return data
    },
  }

  const syncRunsService = {
    create: async (data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      syncRuns.push(data)
      return data
    },
  }

  const cursorService = {
    get: async (id: string): Promise<never> => {
      cursorWrites.push({ op: 'get', id })
      throw new Error('nicht gefunden')
    },
    patch: async (id: string): Promise<Record<string, unknown>> => {
      cursorWrites.push({ op: 'patch', id })
      return {}
    },
    create: async (data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      cursorWrites.push({ op: 'create', id: data['_id'] as string })
      return data
    },
  }

  const app = {
    service: (path: string) => {
      if (path === 'sync-outbox') return outboxService
      if (path === 'sync-conflicts') return conflictsService
      if (path === 'cloud-connection') return cloudConnectionService
      if (path === 'sync-runs') return syncRunsService
      if (path === 'sync-cursor') return cursorService
      throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
    },
  } as unknown as Application

  // Klartext-Token (kein `enc:`-Prefix) — decryptCloudToken reicht ihn durch.
  const baseConnection = {
    _id: 'conn-1',
    cloudUrl: 'https://cloud.test',
    cloudToken: 'test-token',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
  } as unknown as CloudConnection

  beforeEach(() => {
    rows = []
    conflicts = []
    connectionPatches = []
    syncRuns = []
    cursorWrites = []
    stub = { status: 200, body: { accepted: [], rejected: [] } }
    globalThis.fetch = (async () =>
      new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
        status: stub.status,
        headers: { 'Content-Type': 'application/json', ...(stub.headers ?? {}) },
      })) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('Heartbeat', () => {
    // Ein Fehlversuch unter der Schwelle: der naechste gezaehlte Fehler wuerde
    // `shouldActivateEmergencyOverride` ausloesen (EMERGENCY_OVERRIDE_FAILURE_THRESHOLD = 3).
    const connectionNearThreshold = {
      ...baseConnection,
      consecutiveHeartbeatFailures: 2,
      lastHeartbeatOk: new Date().toISOString(),
    } as unknown as CloudConnection

    it('429 aktiviert den Notfall-Modus NICHT und zaehlt keinen Fehlversuch', async () => {
      stub = { status: 429, headers: { 'Retry-After': '30' }, body: { message: 'Heartbeat-Rate-Limit erreicht.' } }

      const result = await runHeartbeatPhase(app, connectionNearThreshold, SyncRunTrigger.SCHEDULER)

      assert.strictEqual(result.rateLimited, true)
      assert.strictEqual(result.heartbeat, null)
      // Kein einziger Patch auf der Connection: weder Zaehler noch Override.
      assert.deepStrictEqual(connectionPatches, [])
      assert.ok(result.rateLimitedUntilMs && result.rateLimitedUntilMs > Date.now())
    })

    it('429 fasst den pairingStatus nicht an (nur 401 tut das)', async () => {
      stub = { status: 429, body: { message: 'Heartbeat-Rate-Limit erreicht.' } }

      const result = await runHeartbeatPhase(app, connectionNearThreshold, SyncRunTrigger.SCHEDULER)

      assert.strictEqual(result.pairingRequired, false)
      assert.ok(!connectionPatches.some(p => 'pairingStatus' in p))
    })

    it('429 wird als throttled protokolliert, nicht als failure', async () => {
      stub = { status: 429, body: {} }

      await runHeartbeatPhase(app, connectionNearThreshold, SyncRunTrigger.SCHEDULER)

      assert.strictEqual(syncRuns.length, 1)
      assert.strictEqual(syncRuns[0]['outcome'], SyncRunOutcome.THROTTLED)
    })

    it('ohne Retry-After greift der Fallback (Fensterlaenge der Cloud)', async () => {
      stub = { status: 429, body: {} }
      const before = Date.now()

      const result = await runHeartbeatPhase(app, connectionNearThreshold, SyncRunTrigger.SCHEDULER)

      const waitMs = (result.rateLimitedUntilMs ?? 0) - before
      assert.ok(
        waitMs >= RATE_LIMIT_FALLBACK_DELAY_MS - 1_000 && waitMs <= RATE_LIMIT_FALLBACK_DELAY_MS + 1_000,
        `Erwartet ~${RATE_LIMIT_FALLBACK_DELAY_MS}ms, war ${waitMs}ms`,
      )
    })

    it('Gegenprobe 500: Fehlversuch zaehlt hoch UND aktiviert den Notfall-Modus', async () => {
      stub = { status: 500, body: { message: 'boom' } }

      const result = await runHeartbeatPhase(app, connectionNearThreshold, SyncRunTrigger.SCHEDULER)

      assert.strictEqual(result.rateLimited, false)
      assert.strictEqual(connectionPatches.length, 1)
      assert.strictEqual(connectionPatches[0]['consecutiveHeartbeatFailures'], 3)
      assert.strictEqual(connectionPatches[0]['emergencyOverride'], true)
      assert.strictEqual(syncRuns[0]['outcome'], SyncRunOutcome.FAILURE)
    })
  })

  describe('Push', () => {
    it('429 mit Retry-After: Eintrag bleibt pending, attempts unveraendert', async () => {
      seedEntry('e-1', 0)
      stub = { status: 429, headers: { 'Retry-After': '120' }, body: {} }
      const before = Date.now()

      await assert.rejects(() => runPush(app, baseConnection), CloudRateLimitedError)

      const row = rows[0]
      assert.strictEqual(row.status, SyncOutboxStatus.PENDING)
      assert.strictEqual(row.attempts, 0)
      assert.strictEqual(row.terminalAt, undefined)
      assert.strictEqual(conflicts.length, 0)
      const waitMs = new Date(row.nextAttemptAt).getTime() - before
      assert.ok(waitMs >= 119_000 && waitMs <= 121_000, `Erwartet ~120000ms, war ${waitMs}ms`)
    })

    it('429 ohne Retry-After: Fallback statt Backoff-Schedule', async () => {
      seedEntry('e-1', 0)
      stub = { status: 429, body: {} }
      const before = Date.now()

      await assert.rejects(() => runPush(app, baseConnection), CloudRateLimitedError)

      const waitMs = new Date(rows[0].nextAttemptAt).getTime() - before
      assert.ok(
        waitMs >= RATE_LIMIT_FALLBACK_DELAY_MS - 1_000 && waitMs <= RATE_LIMIT_FALLBACK_DELAY_MS + 1_000,
        `Erwartet ~${RATE_LIMIT_FALLBACK_DELAY_MS}ms, war ${waitMs}ms`,
      )
      assert.strictEqual(rows[0].attempts, 0)
    })

    it('429 an der MAX_RETRY_ATTEMPTS-Grenze eskaliert NICHT zu sync-conflicts', async () => {
      // Genau der Stand, bei dem ein transient-Reject terminal wuerde
      // (shouldEscalateAfterRetry). Ein 429 darf das nie ausloesen — sonst
      // erzeugt anhaltender Rueckstau Datenkonflikte aus dem Nichts.
      seedEntry('e-1', MAX_RETRY_ATTEMPTS - 1)
      stub = { status: 429, headers: { 'Retry-After': '60' }, body: {} }

      await assert.rejects(() => runPush(app, baseConnection), CloudRateLimitedError)

      assert.strictEqual(conflicts.length, 0)
      assert.strictEqual(rows[0].status, SyncOutboxStatus.PENDING)
      assert.strictEqual(rows[0].attempts, MAX_RETRY_ATTEMPTS - 1)
      assert.strictEqual(rows[0].linkedConflictId, undefined)
    })

    it('Gegenprobe 500: Fehlversuch wird gebucht (attempts++)', async () => {
      seedEntry('e-1', 0)
      stub = { status: 500, body: { message: 'boom' } }

      await assert.rejects(() => runPush(app, baseConnection))

      assert.strictEqual(rows[0].status, SyncOutboxStatus.PENDING)
      assert.strictEqual(rows[0].attempts, 1)
    })
  })

  describe('Pull', () => {
    it('429 schreibt den Cursor nicht fort', async () => {
      stub = { status: 429, headers: { 'Retry-After': '45' }, body: {} }

      await assert.rejects(() => runPullForService(app, baseConnection, 'products'), CloudRateLimitedError)

      // `get` beim Lesen des Cursors ist erlaubt — geschrieben werden darf nichts.
      assert.deepStrictEqual(
        cursorWrites.filter(w => w.op !== 'get'),
        [],
      )
    })
  })
})
