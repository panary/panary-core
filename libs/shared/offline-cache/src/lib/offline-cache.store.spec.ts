import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

describe('OfflineCacheStore', () => {
  let store: OfflineCacheStore
  let port: IdbStorageAdapter
  const dbName = 'store-test-db'

  beforeEach(async () => {
    port = new IdbStorageAdapter()
    await port.destroy(dbName)
    store = new OfflineCacheStore()
    await store.init(port, dbName, SCHEMA, BUILD_ID)
  })

  afterEach(() => {
    port.close()
  })

  it('ist nach init bereit, mit leerem Mirror', () => {
    expect(store.isReady()).toBe(true)
    expect(store.mirror<TestProduct>('products')()).toEqual([])
  })

  it('upsert schreibt in IndexedDB und Mirror', async () => {
    await store.upsert('products', product('p1', { name: 'A' }))
    expect(store.mirror<TestProduct>('products')().map(p => p._id)).toEqual(['p1'])
    expect(await store.get<TestProduct>('products', 'p1')).toBeDefined()
  })

  it('upsertMany merged per _id', async () => {
    await store.upsertMany('products', [product('p1', { name: 'A' }), product('p2')])
    await store.upsertMany('products', [product('p1', { name: 'B' })])
    const mirror = store.mirror<TestProduct>('products')()
    expect(mirror.length).toBe(2)
    expect(mirror.find(p => p._id === 'p1')?.name).toBe('B')
  })

  it('removeOne entfernt aus IndexedDB und Mirror', async () => {
    await store.upsertMany('products', [product('p1'), product('p2')])
    await store.removeOne('products', 'p1')
    expect(store.mirror<TestProduct>('products')().map(p => p._id)).toEqual(['p2'])
  })

  it('hydratisiert den Mirror beim init aus IndexedDB', async () => {
    await store.upsertMany('products', [product('p1'), product('p2')])
    port.close()

    const reopened = new OfflineCacheStore()
    await reopened.init(port, dbName, SCHEMA, BUILD_ID)
    expect(reopened.mirror<TestProduct>('products')().length).toBe(2)
  })

  it('destroy verwirft Cache und setzt ready zurück', async () => {
    await store.upsert('products', product('p1'))
    await store.destroy()
    expect(store.isReady()).toBe(false)
  })
})
