import 'fake-indexeddb/auto'
import { describe, expect, it, onTestFinished } from 'vitest'

import { buildCacheBuildId } from './cache-namespace'
import { CacheStorageSchema } from './cache-storage.port'
import { IdbStorageAdapter } from './idb-storage.adapter'
import { OfflineCacheStore } from './offline-cache.store'

const SCHEMA: CacheStorageSchema = {
  version: 1,
  stores: [{ name: 'products', indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }] }],
}
const BUILD_ID = buildCacheBuildId({ appVersion: '1.0.0', schemaVersion: 1 })

interface TestProduct {
  _id: string
  tenantId: string
  locationId: string | null
  updatedAt: string
  name?: string
}

const product = (id: string, extra: Partial<TestProduct> = {}): TestProduct => ({
  _id: id,
  tenantId: 't1',
  locationId: 'l1',
  updatedAt: '2026-05-30T10:00:00.000Z',
  ...extra,
})

// Store, Port UND Datenbankname je Test — siehe `.claude/rules/code-style.md` §10 und den
// Kommentar in `cache-bootstrap.spec.ts`. `onTestFinished` schliesst die Verbindung, sonst
// blockiert ein spaeteres deleteDB auf der noch offenen Connection.
let dbSeq = 0

async function createStore() {
  const port = new IdbStorageAdapter()
  const dbName = `store-test-db-${++dbSeq}`
  const store = new OfflineCacheStore()
  await store.init(port, dbName, SCHEMA, BUILD_ID)
  onTestFinished(() => port.close())
  return { store, port, dbName }
}

describe('OfflineCacheStore', () => {
  it('ist nach init bereit, mit leerem Mirror', async () => {
    const { store } = await createStore()

    expect(store.isReady()).toBe(true)
    expect(store.mirror<TestProduct>('products')()).toEqual([])
  })

  it('upsert schreibt in IndexedDB und Mirror', async () => {
    const { store } = await createStore()

    await store.upsert('products', product('p1', { name: 'A' }))
    expect(
      store
        .mirror<TestProduct>('products')()
        .map(p => p._id),
    ).toEqual(['p1'])
    expect(await store.get<TestProduct>('products', 'p1')).toBeDefined()
  })

  it('upsertMany merged per _id', async () => {
    const { store } = await createStore()

    await store.upsertMany('products', [product('p1', { name: 'A' }), product('p2')])
    await store.upsertMany('products', [product('p1', { name: 'B' })])
    const mirror = store.mirror<TestProduct>('products')()
    expect(mirror.length).toBe(2)
    expect(mirror.find(p => p._id === 'p1')?.name).toBe('B')
  })

  it('removeOne entfernt aus IndexedDB und Mirror', async () => {
    const { store } = await createStore()

    await store.upsertMany('products', [product('p1'), product('p2')])
    await store.removeOne('products', 'p1')
    expect(
      store
        .mirror<TestProduct>('products')()
        .map(p => p._id),
    ).toEqual(['p2'])
  })

  it('replaceAll ersetzt Store-Inhalt + Mirror (kein Anhäufen)', async () => {
    const { store } = await createStore()

    await store.upsertMany('products', [product('p1'), product('p2'), product('p3')])
    await store.replaceAll('products', [product('p2', { name: 'neu' }), product('p4')])
    expect(
      store
        .mirror<TestProduct>('products')()
        .map(p => p._id)
        .sort(),
    ).toEqual(['p2', 'p4'])
    expect((await store.readAll<TestProduct>('products')).map(p => p._id).sort()).toEqual(['p2', 'p4'])
    expect(await store.get<TestProduct>('products', 'p1')).toBeUndefined()
  })

  it('hydratisiert den Mirror beim init aus IndexedDB', async () => {
    const { store, port, dbName } = await createStore()

    await store.upsertMany('products', [product('p1'), product('p2')])
    port.close()

    const reopened = new OfflineCacheStore()
    await reopened.init(port, dbName, SCHEMA, BUILD_ID)
    expect(reopened.mirror<TestProduct>('products')().length).toBe(2)
  })

  it('destroy verwirft Cache und setzt ready zurück', async () => {
    const { store } = await createStore()

    await store.upsert('products', product('p1'))
    await store.destroy()
    expect(store.isReady()).toBe(false)
  })

  it('persistiert und liest Delta-Sync-Cursor pro Service', async () => {
    const { store } = await createStore()

    expect(await store.getCursor('products')).toBeUndefined()
    await store.setCursor('products', '2026-05-30T10:00:00.000Z')
    await store.setCursor('orders', '2026-05-30T11:00:00.000Z')
    expect(await store.getCursor('products')).toBe('2026-05-30T10:00:00.000Z')
    expect(await store.getCursor('orders')).toBe('2026-05-30T11:00:00.000Z')
  })

  it('überschreibt einen vorhandenen Cursor', async () => {
    const { store } = await createStore()

    await store.setCursor('products', '2026-05-30T10:00:00.000Z')
    await store.setCursor('products', '2026-05-30T12:00:00.000Z')
    expect(await store.getCursor('products')).toBe('2026-05-30T12:00:00.000Z')
  })
})
