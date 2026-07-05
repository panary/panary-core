// Fokus-Test fuer das geteilte Sync-Apply-Modul (`applyPulledRecords`).
//
// Kein App-Boot: das Modul braucht nur `app.service(<name>)` mit
// find/create/patch/remove. Alles in-memory gemockt — geprueft werden die
// Apply-Semantik (create+patch gemischt, remove via deletedAt), der GEBATCHTE
// Existenz-Check (EIN find pro Seite, NIE get pro Record), die Idempotenz bei
// doppelt angewandter Seite (Upsert) sowie der insert-Modus des
// Bootstrap-Pfads (kein find nach Truncate).
import assert from 'assert'

import { SyncOp, SyncRunRecordStatus, type SyncPullResponse } from '@panary/sync/domain'

import type { Application } from '../../src/declarations'
import { applyPulledRecords } from '../../src/workers/sync-apply'

type PullRecord = SyncPullResponse['records'][number]

interface ServiceCalls {
  find: Array<Record<string, unknown>>
  get: string[]
  create: Array<Record<string, unknown>>
  patch: Array<{ id: string; data: Record<string, unknown> }>
  remove: string[]
}

describe('sync-apply — applyPulledRecords', () => {
  let store: Map<string, Record<string, unknown>>
  let calls: ServiceCalls
  // Optional: create fuer bestimmte IDs fehlschlagen lassen (AJV-Simulation).
  let failCreateIds: Set<string>

  const service = {
    find: async (params: { query: { _id: { $in: string[] } } }) => {
      calls.find.push(params.query as unknown as Record<string, unknown>)
      return params.query._id.$in.filter(id => store.has(id)).map(id => ({ _id: id }))
    },
    get: async (id: string) => {
      calls.get.push(id)
      const row = store.get(id)
      if (!row) throw new Error(`NotFound: ${id}`)
      return row
    },
    create: async (data: Record<string, unknown>) => {
      const id = data['_id'] as string
      calls.create.push(data)
      if (failCreateIds.has(id)) {
        const err = new Error('validation failed') as Error & { data: unknown }
        err.data = [{ instancePath: '/name', message: 'must be string', keyword: 'type' }]
        throw err
      }
      if (store.has(id)) throw new Error(`UNIQUE constraint failed: ${id}`)
      store.set(id, data)
      return data
    },
    patch: async (id: string, data: Record<string, unknown>) => {
      calls.patch.push({ id, data })
      const row = store.get(id)
      if (!row) throw new Error(`NotFound: ${id}`)
      const next = { ...row, ...data }
      store.set(id, next)
      return next
    },
    remove: async (id: string) => {
      calls.remove.push(id)
      store.delete(id)
      return { _id: id }
    },
  }

  const app = {
    service: (path: string) => {
      if (path === 'products') return service
      throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
    },
  } as unknown as Application

  const now = new Date().toISOString()
  const pullRecord = (id: string, extra: Partial<PullRecord> = {}): PullRecord => ({
    _id: id,
    updatedAt: now,
    record: { _id: id, name: `Produkt ${id}`, tenantId: 't-1' },
    ...extra,
  })

  beforeEach(() => {
    store = new Map()
    failCreateIds = new Set()
    calls = { find: [], get: [], create: [], patch: [], remove: [] }
  })

  it('wendet create + patch gemischt an und entfernt deletedAt-Records', async () => {
    store.set('p-1', { _id: 'p-1', name: 'Alt' })
    store.set('p-0', { _id: 'p-0', name: 'Wird geloescht' })
    const page = [pullRecord('p-1'), pullRecord('p-2'), pullRecord('p-0', { deletedAt: now, record: undefined })]

    const result = await applyPulledRecords(app, 'products', page)

    assert.strictEqual(result.applied, 3)
    assert.strictEqual(result.rejected, 0)
    assert.deepStrictEqual(
      result.details.map(d => [d.entityId, d.op, d.status]),
      [
        ['p-1', SyncOp.PATCH, SyncRunRecordStatus.ACCEPTED],
        ['p-2', SyncOp.CREATE, SyncRunRecordStatus.ACCEPTED],
        ['p-0', SyncOp.REMOVE, SyncRunRecordStatus.ACCEPTED],
      ],
    )
    assert.deepStrictEqual(calls.patch.map(p => p.id), ['p-1'])
    assert.deepStrictEqual(calls.create.map(c => c['_id']), ['p-2'])
    assert.deepStrictEqual(calls.remove, ['p-0'])
    assert.strictEqual((store.get('p-1') as { name: string }).name, 'Produkt p-1')
  })

  it('batcht den Existenz-Check: EIN find pro Seite, NIE get pro Record', async () => {
    store.set('p-1', { _id: 'p-1' })
    const page = [pullRecord('p-1'), pullRecord('p-2'), pullRecord('p-3'), pullRecord('p-4', { deletedAt: now })]

    await applyPulledRecords(app, 'products', page)

    assert.strictEqual(calls.find.length, 1)
    assert.strictEqual(calls.get.length, 0)
    // deletedAt-Records gehoeren NICHT in den $in-Existenz-Check.
    assert.deepStrictEqual(calls.find[0], {
      _id: { $in: ['p-1', 'p-2', 'p-3'] },
      $select: ['_id'],
    })
  })

  it('ist idempotent bei doppelt angewandter Seite (zweiter Lauf nur Patches)', async () => {
    const page = [pullRecord('p-1'), pullRecord('p-2')]

    const first = await applyPulledRecords(app, 'products', page)
    const second = await applyPulledRecords(app, 'products', page)

    assert.strictEqual(first.rejected, 0)
    assert.strictEqual(second.rejected, 0)
    assert.strictEqual(second.applied, 2)
    // Erster Lauf: 2 creates. Zweiter Lauf: 0 creates, 2 patches.
    assert.strictEqual(calls.create.length, 2)
    assert.deepStrictEqual(calls.patch.map(p => p.id), ['p-1', 'p-2'])
    assert.strictEqual(store.size, 2)
    assert.ok(second.details.every(d => d.status === SyncRunRecordStatus.ACCEPTED && d.op === SyncOp.PATCH))
  })

  it('insert-Modus (Bootstrap nach Truncate): direkter create ohne Existenz-Find', async () => {
    const page = [pullRecord('p-1'), pullRecord('p-2')]

    const result = await applyPulledRecords(app, 'products', page, { mode: 'insert' })

    assert.strictEqual(calls.find.length, 0)
    assert.strictEqual(calls.get.length, 0)
    assert.strictEqual(calls.create.length, 2)
    assert.strictEqual(result.applied, 2)
  })

  it('markiert fehlgeschlagene Applies als REJECTED, ohne den Rest der Seite zu blockieren', async () => {
    failCreateIds.add('p-2')
    const page = [pullRecord('p-1'), pullRecord('p-2'), pullRecord('p-3')]

    const result = await applyPulledRecords(app, 'products', page)

    assert.strictEqual(result.applied, 2)
    assert.strictEqual(result.rejected, 1)
    const rejectedDetail = result.details.find(d => d.entityId === 'p-2')
    assert.strictEqual(rejectedDetail?.status, SyncRunRecordStatus.REJECTED)
    assert.match(rejectedDetail?.reason ?? '', /validation failed/)
    // p-1 und p-3 sind trotz Fehler in p-2 angekommen.
    assert.ok(store.has('p-1') && store.has('p-3') && !store.has('p-2'))
  })

  it('liefert bei leerer Seite ein leeres Ergebnis ohne Service-Calls', async () => {
    const result = await applyPulledRecords(app, 'products', [])

    assert.deepStrictEqual(result, { applied: 0, rejected: 0, details: [] })
    assert.strictEqual(calls.find.length + calls.create.length + calls.patch.length, 0)
  })
})
