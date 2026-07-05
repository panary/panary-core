// Fokus-Test fuer den Push-Drain-Loop (`runPush`) des Cloud-Sync-Schedulers.
//
// Kein App-Boot: `runPush` braucht nur `app.service('sync-outbox')` (find/patch)
// und `globalThis.fetch`. Beides wird in-memory gemockt — geprueft wird die
// Drain-Semantik (mehrere volle Batches in EINEM Aufruf), der Abbruch bei
// HTTP-Fehlern (Batch geht via markOutboxRetry zurueck auf pending+Backoff)
// und der Batch-Deckel MAX_PUSH_BATCHES_PER_CYCLE, nicht die Feathers-Schicht.
import assert from 'assert'

import type { CloudConnection } from '@panary/cloud-connection/domain'
import { SyncOp, SyncOutboxStatus, SyncSource } from '@panary/sync/domain'

import type { Application } from '../../src/declarations'
import { runPush } from '../../src/workers/cloud-sync-scheduler.worker'

// Muss PUSH_BATCH_SIZE im Worker entsprechen (Konstante ist bewusst nicht
// exportiert — bei Aenderung Test mitziehen).
const BATCH_SIZE = 100

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
  syncedAt?: string
  terminalAt?: string
}

describe('cloud-sync-scheduler worker — push drain', () => {
  let rows: OutboxRow[]
  let fetchCalls: Array<{ url: string; opIds: string[] }>
  // 1-basierter Index des fetch-Calls, der mit HTTP 500 antworten soll.
  let failOnCall: number | null

  const originalFetch = globalThis.fetch

  const seedOutbox = (count: number): void => {
    const past = new Date(Date.now() - 60_000).toISOString()
    rows = Array.from({ length: count }, (_, i) => ({
      _id: `e-${String(i).padStart(5, '0')}`,
      service: 'orders',
      op: SyncOp.CREATE,
      entityId: `entity-${i}`,
      payload: JSON.stringify({ n: i }),
      occurredAt: past,
      syncSource: SyncSource.LIVE,
      status: SyncOutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: past,
    }))
  }

  // Nachbildung der vom Worker genutzten sync-outbox-Queries: fetchPendingOutbox
  // (find mit status/nextAttemptAt/$limit/$sort), die Coalescing-Sibling-Query
  // (find mit entityId.$in) und die Status-Patches (in-flight/acked/retry/
  // superseded).
  const outboxService = {
    find: async (params: {
      query: {
        status?: string
        nextAttemptAt?: { $lte: string }
        $limit?: number
        entityId?: { $in: string[] }
      }
    }): Promise<Array<Partial<OutboxRow>>> => {
      if (params.query.entityId?.$in) {
        const wanted = new Set(params.query.entityId.$in)
        return rows
          .filter(r => wanted.has(r.entityId))
          .map(r => ({ _id: r._id, service: r.service, entityId: r.entityId }))
      }
      return rows
        .filter(
          r => r.status === params.query.status && r.nextAttemptAt <= (params.query.nextAttemptAt?.$lte ?? ''),
        )
        .sort((a, b) => (a._id < b._id ? -1 : 1))
        .slice(0, params.query.$limit)
        .map(r => ({ ...r }))
    },
    patch: async (id: string, data: Partial<OutboxRow>): Promise<OutboxRow> => {
      const row = rows.find(r => r._id === id)
      if (!row) throw new Error(`Outbox-Eintrag ${id} nicht gefunden`)
      Object.assign(row, data)
      return row
    },
  }

  const app = {
    service: (path: string) => {
      if (path === 'sync-outbox') return outboxService
      throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
    },
  } as unknown as Application

  // Klartext-Token (kein `enc:`-Prefix) — decryptCloudToken reicht ihn ohne
  // EDGE_TOKEN_ENCRYPTION_KEY unveraendert durch.
  const connection = {
    _id: 'conn-1',
    cloudUrl: 'https://cloud.test',
    cloudToken: 'test-token',
    tenantId: 'tenant-1',
    locationId: null,
  } as unknown as CloudConnection

  beforeEach(() => {
    rows = []
    fetchCalls = []
    failOnCall = null
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { ops: Array<{ _id: string }> }
      fetchCalls.push({ url: String(input), opIds: body.ops.map(o => o._id) })
      if (failOnCall !== null && fetchCalls.length === failOnCall) {
        return new Response('Cloud kaputt', { status: 500 })
      }
      return new Response(JSON.stringify({ accepted: body.ops.map(o => o._id), rejected: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('draint 250 pending Eintraege in drei Batches in einem Aufruf', async () => {
    seedOutbox(250)

    const result = await runPush(app, connection)

    assert.strictEqual(result.accepted, 250)
    assert.strictEqual(result.rejected, 0)
    assert.strictEqual(result.details.length, 250)
    assert.deepStrictEqual(
      fetchCalls.map(c => c.opIds.length),
      [BATCH_SIZE, BATCH_SIZE, 50],
    )
    assert.strictEqual(rows.filter(r => r.status === SyncOutboxStatus.ACKED).length, 250)
  })

  it('bricht bei HTTP-Fehler im zweiten Batch ab und setzt den Batch auf Retry', async () => {
    seedOutbox(250)
    failOnCall = 2

    await assert.rejects(() => runPush(app, connection), /500/)

    // Kein dritter Batch nach dem Fehler.
    assert.strictEqual(fetchCalls.length, 2)
    // Batch 1 bleibt geackt — bereits uebertragene Daten gehen nicht verloren.
    const acked = rows.filter(r => r.status === SyncOutboxStatus.ACKED)
    assert.strictEqual(acked.length, BATCH_SIZE)
    // Batch 2: zurueck auf pending mit attempts=1 und Backoff in der Zukunft.
    const retried = rows.filter(r => r.attempts === 1)
    assert.strictEqual(retried.length, BATCH_SIZE)
    for (const row of retried) {
      assert.strictEqual(row.status, SyncOutboxStatus.PENDING)
      assert.ok(new Date(row.nextAttemptAt).getTime() > Date.now())
      assert.match(row.lastError ?? '', /500/)
    }
    // Rest wurde nie angefasst.
    assert.strictEqual(rows.filter(r => r.status === SyncOutboxStatus.PENDING && r.attempts === 0).length, 50)
  })

  // --- Coalescing pro (service, entityId): nur der juengste Eintrag wird gepusht ---

  const seedRow = (overrides: Partial<OutboxRow> & { _id: string; entityId: string }): void => {
    const past = new Date(Date.now() - 60_000).toISOString()
    rows.push({
      service: 'orders',
      op: SyncOp.PATCH,
      payload: JSON.stringify({}),
      occurredAt: past,
      syncSource: SyncSource.LIVE,
      status: SyncOutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: past,
      ...overrides,
    })
  }

  it('coalesct zwei pending-Mutationen derselben Entity auf EINEN Push-Kandidaten mit juengster Payload', async () => {
    seedRow({ _id: 'e-alt', entityId: 'order-x', payload: JSON.stringify({ rev: 1 }) })
    seedRow({ _id: 'e-neu', entityId: 'order-x', payload: JSON.stringify({ rev: 2 }) })

    const result = await runPush(app, connection)

    // Genau EIN Cloud-Call mit genau dem juengeren Eintrag.
    assert.strictEqual(fetchCalls.length, 1)
    assert.deepStrictEqual(fetchCalls[0].opIds, ['e-neu'])
    assert.strictEqual(result.accepted, 1)
    const alt = rows.find(r => r._id === 'e-alt')
    const neu = rows.find(r => r._id === 'e-neu')
    assert.strictEqual(alt?.status, SyncOutboxStatus.SUPERSEDED)
    assert.ok(alt?.terminalAt, 'superseded-Eintrag traegt terminalAt (Retention-Referenz)')
    assert.match(alt?.lastError ?? '', /e-neu/)
    assert.strictEqual(neu?.status, SyncOutboxStatus.ACKED)
  })

  it('supersedet einen faellig gewordenen Backoff-Eintrag, wenn ein juengerer bereits acked ist', async () => {
    // Szenario Stale-Overwrite: e-alt scheiterte transient (Backoff), waehrend
    // e-neu laengst erfolgreich gepusht wurde. Ohne Coalescing wuerde e-alt
    // beim Faelligwerden den juengeren Cloud-Stand ueberschreiben.
    seedRow({ _id: 'e-alt', entityId: 'order-x', attempts: 2 })
    seedRow({
      _id: 'e-neu',
      entityId: 'order-x',
      status: SyncOutboxStatus.ACKED,
      syncedAt: new Date().toISOString(),
    })

    const result = await runPush(app, connection)

    assert.strictEqual(fetchCalls.length, 0, 'kein Cloud-Call — es gibt keinen Push-Kandidaten')
    assert.strictEqual(result.accepted, 0)
    assert.strictEqual(rows.find(r => r._id === 'e-alt')?.status, SyncOutboxStatus.SUPERSEDED)
  })

  it('coalesct nicht ueber Entity-Grenzen und bricht den Drain nach reinen superseded-Batches nicht ab', async () => {
    // Erster Roh-Batch (100 aelteste _ids) besteht komplett aus superseded
    // Duplikaten — der Drain muss trotzdem weiterziehen und die 5 frischen
    // Eintraege im zweiten Batch pushen (fetched zaehlt Roh-Eintraege).
    for (let i = 0; i < BATCH_SIZE; i++) {
      const id = String(i).padStart(5, '0')
      seedRow({ _id: `a-${id}`, entityId: `dup-${id}` })
      seedRow({ _id: `b-${id}`, entityId: `dup-${id}`, status: SyncOutboxStatus.ACKED })
    }
    for (let i = 0; i < 5; i++) {
      seedRow({ _id: `z-${i}`, entityId: `frisch-${i}` })
    }

    const result = await runPush(app, connection)

    assert.strictEqual(result.accepted, 5)
    assert.strictEqual(fetchCalls.length, 1)
    assert.deepStrictEqual(fetchCalls[0].opIds, ['z-0', 'z-1', 'z-2', 'z-3', 'z-4'])
    assert.strictEqual(rows.filter(r => r.status === SyncOutboxStatus.SUPERSEDED).length, BATCH_SIZE)
  })

  it('deckelt den Drain bei MAX_PUSH_BATCHES_PER_CYCLE Batches', async () => {
    // 51 volle Batches noetig — der Deckel (50, nicht exportiert; bei Aenderung
    // Test mitziehen) stoppt nach 5000 Eintraegen, Rest wartet auf den
    // naechsten Tick.
    seedOutbox(5100)

    const result = await runPush(app, connection)

    assert.strictEqual(result.accepted, 5000)
    assert.strictEqual(fetchCalls.length, 50)
    // Details-Aggregat ist auf MAX_SYNC_RUN_DETAILS gekappt.
    assert.strictEqual(result.details.length, 500)
    assert.strictEqual(rows.filter(r => r.status === SyncOutboxStatus.PENDING).length, 100)
  })
})
