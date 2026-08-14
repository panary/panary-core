import 'fake-indexeddb/auto'
import { describe, expect, it, onTestFinished } from 'vitest'

import { CACHE_META_STORE, openCacheDatabase } from './cache-bootstrap'
import { IdbStorageAdapter } from './idb-storage.adapter'
import { CacheStorageSchema } from './cache-storage.port'

const SCHEMA: CacheStorageSchema = {
  version: 1,
  stores: [{ name: 'products', indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }] }],
}

const sampleProduct = { _id: 'p1', tenantId: 't1', locationId: 'l1', updatedAt: '2026-05-30T10:00:00.000Z' }

// Adapter UND Datenbankname je Test. Geteilt war bisher beides: die `let`-Bindung, die
// `beforeEach` neu zuwies, und der feste DB-Name — ein Nachzuegler aus einem abgebrochenen Test
// haette also in genau die Datenbank geschrieben, die der naechste frisch geoeffnet hat.
// Siehe `.claude/rules/code-style.md` §10. Der eindeutige Name macht das vorherige
// `destroy()` ueberfluessig; `onTestFinished` schliesst die Verbindung, sonst blockiert ein
// spaeteres deleteDB auf der noch offenen Connection.
let dbSeq = 0

function createAdapter() {
  const adapter = new IdbStorageAdapter()
  onTestFinished(() => adapter.close())
  return { adapter, dbName: `bootstrap-test-db-${++dbSeq}` }
}

describe('openCacheDatabase', () => {
  it('legt beim Erst-Öffnen die Meta an, ohne zu wipen', async () => {
    const { adapter, dbName } = createAdapter()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    expect(result.wiped).toBe(false)
    expect(await adapter.get(CACHE_META_STORE, 'meta')).toBeDefined()
  })

  it('behält Daten bei gleicher buildId', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    await adapter.put('products', sampleProduct)
    adapter.close()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    expect(result.wiped).toBe(false)
    expect(await adapter.count('products')).toBe(1)
  })

  it('verwirft Daten bei geänderter buildId (Wipe + Bootstrap)', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    await adapter.put('products', sampleProduct)
    adapter.close()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-2')
    expect(result.wiped).toBe(true)
    expect(await adapter.count('products')).toBe(0)
  })
})
