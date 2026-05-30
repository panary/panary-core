import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CACHE_META_STORE, openCacheDatabase } from './cache-bootstrap'
import { IdbStorageAdapter } from './idb-storage.adapter'
import { CacheStorageSchema } from './cache-storage.port'

const SCHEMA: CacheStorageSchema = {
  version: 1,
  stores: [{ name: 'products', indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }] }],
}

const sampleProduct = { _id: 'p1', tenantId: 't1', locationId: 'l1', updatedAt: '2026-05-30T10:00:00.000Z' }

describe('openCacheDatabase', () => {
  let adapter: IdbStorageAdapter
  const dbName = 'bootstrap-test-db'

  beforeEach(async () => {
    adapter = new IdbStorageAdapter()
    await adapter.destroy(dbName)
  })

  // Verbindung schließen, sonst blockiert das destroy() des nächsten beforeEach (deleteDB wartet auf offene Connection)
  afterEach(() => {
    adapter.close()
  })

  it('legt beim Erst-Öffnen die Meta an, ohne zu wipen', async () => {
    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    expect(result.wiped).toBe(false)
    expect(await adapter.get(CACHE_META_STORE, 'meta')).toBeDefined()
  })

  it('behält Daten bei gleicher buildId', async () => {
    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    await adapter.put('products', sampleProduct)
    adapter.close()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    expect(result.wiped).toBe(false)
    expect(await adapter.count('products')).toBe(1)
  })

  it('verwirft Daten bei geänderter buildId (Wipe + Bootstrap)', async () => {
    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    await adapter.put('products', sampleProduct)
    adapter.close()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-2')
    expect(result.wiped).toBe(true)
    expect(await adapter.count('products')).toBe(0)
  })
})
