import 'fake-indexeddb/auto'
import { describe, expect, it, onTestFinished } from 'vitest'

import { CACHE_CURSORS_STORE, CACHE_META_STORE, CACHE_OUTBOX_STORE, openCacheDatabase } from './cache-bootstrap'
import { IdbStorageAdapter } from './idb-storage.adapter'
import { CacheStorageSchema } from './cache-storage.port'

const SCHEMA: CacheStorageSchema = {
  version: 1,
  stores: [{ name: 'products', indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }] }],
}

const sampleProduct = { _id: 'p1', tenantId: 't1', locationId: 'l1', updatedAt: '2026-05-30T10:00:00.000Z' }

const outboxEntry = (id: string) => ({
  _id: id,
  service: 'orders',
  op: 'create',
  entityId: id,
  payload: { totalGrossCents: 1250 },
  occurredAt: '2026-09-16T08:00:00.000Z',
  status: 'pending',
  attempts: 0,
})

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

  // #322: Der Wipe galt dem regenerierbaren Cache. Die Outbox liegt in derselben DB,
  // ist aber das Gegenteil — ein `destroy()` löschte bei JEDEM App-Update (die buildId
  // traegt die App-Version) alle noch nicht uebertragenen Bestellungen. Siehe ADR 0039.
  it('behält die Outbox beim buildId-Wechsel (App-Update)', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'app-1.0.0#1')
    await adapter.put('products', sampleProduct)
    await adapter.put(CACHE_OUTBOX_STORE, outboxEntry('o1'))
    await adapter.put(CACHE_OUTBOX_STORE, outboxEntry('o2'))
    adapter.close()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'app-1.1.0#1')

    expect(result.wiped).toBe(true)
    expect(result.preservedOutboxCount).toBe(2)
    expect(await adapter.count(CACHE_OUTBOX_STORE)).toBe(2)
    expect(await adapter.count('products')).toBe(0)
  })

  it('behält die Outbox auch beim Schema-Versionssprung', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'app-1.0.0#1')
    await adapter.put('products', sampleProduct)
    await adapter.put(CACHE_OUTBOX_STORE, outboxEntry('o1'))
    adapter.close()

    const nextSchema: CacheStorageSchema = {
      version: 2,
      stores: [
        { name: 'products', indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }] },
        { name: 'discounts' },
      ],
    }
    const result = await openCacheDatabase(adapter, dbName, nextSchema, 'app-1.0.0#2')

    expect(result.preservedOutboxCount).toBe(1)
    expect(await adapter.count(CACHE_OUTBOX_STORE)).toBe(1)
    expect(await adapter.count('products')).toBe(0)
    expect(await adapter.count('discounts')).toBe(0)
  })

  // Bliebe ein lastPullAt stehen, waehrend die fachlichen Stores leer sind, zoege der
  // Delta-Sync nur noch Deltas seit diesem Zeitpunkt — der Cache bliebe dauerhaft
  // unvollstaendig. Cursors gehoeren deshalb NICHT in die Keep-Liste.
  it('leert die Delta-Cursor beim Wipe', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    await adapter.put(CACHE_CURSORS_STORE, { _id: 'products', value: '2026-09-16T08:00:00.000Z' })
    adapter.close()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-2')

    expect(await adapter.count(CACHE_CURSORS_STORE)).toBe(0)
  })

  // Geleert wird ueber port.storeNames(), nicht ueber das Schema — sonst bliebe ein aus
  // dem Schema entfernter, physisch noch vorhandener Store mit Altbestand stehen.
  it('leert auch Stores, die nicht mehr im Schema stehen', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, { version: 1, stores: [{ name: 'products' }, { name: 'legacy' }] }, 'b-1')
    await adapter.put('legacy', { _id: 'l1' })
    adapter.close()

    await openCacheDatabase(adapter, dbName, { version: 1, stores: [{ name: 'products' }] }, 'b-2')

    expect(await adapter.count('legacy')).toBe(0)
  })

  it('meldet preservedOutboxCount 0, wenn nicht gewipet wurde', async () => {
    const { adapter, dbName } = createAdapter()

    await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')
    await adapter.put(CACHE_OUTBOX_STORE, outboxEntry('o1'))
    adapter.close()

    const result = await openCacheDatabase(adapter, dbName, SCHEMA, 'build-1')

    expect(result.wiped).toBe(false)
    expect(result.preservedOutboxCount).toBe(0)
    expect(await adapter.count(CACHE_OUTBOX_STORE)).toBe(1)
  })
})
