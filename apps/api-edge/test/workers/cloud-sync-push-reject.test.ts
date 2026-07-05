// Fokus-Test fuer den Rejected-/Backoff-Pfad des Push-Workers (`runPush`).
//
// Kein App-Boot: gemockt werden `sync-outbox` (find/patch), `sync-conflicts`
// (create) und `globalThis.fetch`. Geprueft wird die Klassifikations-Logik
// der Cloud-Rejects:
//  - transient unterhalb der Grenze  → Retry mit Backoff (pending + attempts++)
//  - transient AN der Grenze         → Eskalation via shouldEscalateAfterRetry
//    (sync-conflicts-Eintrag + Outbox rejected mit linkedConflictId)
//  - conflict                        → sofortige Eskalation mit conflictReason
//  - terminal / ohne Klassifikation  → rejected OHNE Conflict-Eintrag
import assert from 'assert'

import type { CloudConnection } from '@panary/cloud-connection/domain'
import {
  MAX_RETRY_ATTEMPTS,
  SyncConflictReason,
  SyncOp,
  SyncOutboxStatus,
  SyncRejectionClassification,
  SyncRunRecordStatus,
  SyncSource,
} from '@panary/sync/domain'

import type { Application } from '../../src/declarations'
import { runPush } from '../../src/workers/cloud-sync-scheduler.worker'

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

interface Rejection {
  _id: string
  reason: string
  classification?: string
  conflictReason?: string
  cloudPayload?: unknown
}

describe('cloud-sync-scheduler worker — push reject/backoff', () => {
  let rows: OutboxRow[]
  let conflicts: Array<Record<string, unknown>>
  // Cloud-Antwort des naechsten Push-Calls: alles ausserhalb wird accepted.
  let rejections: Rejection[]

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

  const app = {
    service: (path: string) => {
      if (path === 'sync-outbox') return outboxService
      if (path === 'sync-conflicts') return conflictsService
      throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
    },
  } as unknown as Application

  // Klartext-Token (kein `enc:`-Prefix) — decryptCloudToken reicht ihn durch.
  const connection = {
    _id: 'conn-1',
    cloudUrl: 'https://cloud.test',
    cloudToken: 'test-token',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
  } as unknown as CloudConnection

  beforeEach(() => {
    rows = []
    conflicts = []
    rejections = []
    globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { ops: Array<{ _id: string }> }
      const rejectedIds = new Set(rejections.map(r => r._id))
      return new Response(
        JSON.stringify({
          accepted: body.ops.map(o => o._id).filter(id => !rejectedIds.has(id)),
          rejected: rejections,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('transient unterhalb der Grenze: Retry mit Backoff, kein Conflict', async () => {
    seedEntry('e-1', 0)
    rejections = [{ _id: 'e-1', reason: 'Mongo down', classification: SyncRejectionClassification.TRANSIENT }]

    const result = await runPush(app, connection)

    assert.strictEqual(result.rejected, 1)
    assert.strictEqual(conflicts.length, 0)
    const row = rows[0]
    assert.strictEqual(row.status, SyncOutboxStatus.PENDING)
    assert.strictEqual(row.attempts, 1)
    assert.ok(new Date(row.nextAttemptAt).getTime() > Date.now())
    assert.strictEqual(row.lastError, 'Mongo down')
    assert.strictEqual(result.details[0].status, SyncRunRecordStatus.RETRY)
  })

  it('transient an der MAX_RETRY_ATTEMPTS-Grenze: Eskalation zu sync-conflicts', async () => {
    // shouldEscalateAfterRetry(attempts) eskaliert, sobald attempts+1 >= MAX.
    seedEntry('e-1', MAX_RETRY_ATTEMPTS - 1)
    rejections = [{ _id: 'e-1', reason: 'Mongo down', classification: SyncRejectionClassification.TRANSIENT }]

    const result = await runPush(app, connection)

    assert.strictEqual(conflicts.length, 1)
    assert.strictEqual(conflicts[0]['reason'], SyncConflictReason.PUSH_REJECTED)
    assert.strictEqual(conflicts[0]['tenantId'], 'tenant-1')
    assert.strictEqual(conflicts[0]['edgeRecordId'], 'entity-e-1')
    const row = rows[0]
    assert.strictEqual(row.status, SyncOutboxStatus.REJECTED)
    assert.strictEqual(row.linkedConflictId, conflicts[0]['_id'])
    assert.ok(row.terminalAt)
    assert.strictEqual(result.details[0].status, SyncRunRecordStatus.CONFLICT)
  })

  it('classification=conflict: sofortige Eskalation mit Cloud-conflictReason', async () => {
    seedEntry('e-1', 0)
    rejections = [
      {
        _id: 'e-1',
        reason: 'Tenant-Mismatch',
        classification: SyncRejectionClassification.CONFLICT,
        conflictReason: SyncConflictReason.PUSH_FORBIDDEN,
        cloudPayload: { _id: 'entity-e-1', name: 'Cloud-Stand' },
      },
    ]

    const result = await runPush(app, connection)

    assert.strictEqual(conflicts.length, 1)
    assert.strictEqual(conflicts[0]['reason'], SyncConflictReason.PUSH_FORBIDDEN)
    assert.deepStrictEqual(conflicts[0]['cloudPayload'], { _id: 'entity-e-1', name: 'Cloud-Stand' })
    assert.strictEqual(rows[0].status, SyncOutboxStatus.REJECTED)
    assert.strictEqual(rows[0].linkedConflictId, conflicts[0]['_id'])
    assert.strictEqual(result.details[0].status, SyncRunRecordStatus.CONFLICT)
  })

  it('ohne classification (Alt-Cloud): terminal rejected OHNE Conflict-Eintrag', async () => {
    seedEntry('e-1', 0)
    rejections = [{ _id: 'e-1', reason: 'validation failed' }]

    const result = await runPush(app, connection)

    assert.strictEqual(conflicts.length, 0)
    const row = rows[0]
    assert.strictEqual(row.status, SyncOutboxStatus.REJECTED)
    assert.strictEqual(row.linkedConflictId, undefined)
    assert.ok(row.terminalAt)
    assert.strictEqual(result.details[0].status, SyncRunRecordStatus.REJECTED)
  })

  it('gemischte Antwort: accepted wird geackt, rejected einzeln klassifiziert', async () => {
    seedEntry('e-1', 0)
    seedEntry('e-2', 0)
    rejections = [{ _id: 'e-2', reason: 'Mongo down', classification: SyncRejectionClassification.TRANSIENT }]

    const result = await runPush(app, connection)

    assert.strictEqual(result.accepted, 1)
    assert.strictEqual(result.rejected, 1)
    assert.strictEqual(rows.find(r => r._id === 'e-1')?.status, SyncOutboxStatus.ACKED)
    assert.strictEqual(rows.find(r => r._id === 'e-2')?.status, SyncOutboxStatus.PENDING)
  })
})
