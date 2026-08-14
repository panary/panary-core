import 'fake-indexeddb/auto'
import { describe, expect, it, onTestFinished } from 'vitest'

import { IdbStorageAdapter } from './idb-storage.adapter'
import { CacheStorageSchema } from './cache-storage.port'

interface TestProduct {
  _id: string
  tenantId: string
  locationId: string | null
  updatedAt: string
  name: string
}

const SCHEMA: CacheStorageSchema = {
  version: 1,
  stores: [
    {
      name: 'products',
      indexes: [
        { name: 'updatedAt', keyPath: 'updatedAt' },
        { name: 'tenant_location', keyPath: ['tenantId', 'locationId'] },
      ],
    },
  ],
}

const product = (id: string, overrides: Partial<TestProduct> = {}): TestProduct => ({
  _id: id,
  tenantId: 't1',
  locationId: 'l1',
  updatedAt: '2026-05-30T10:00:00.000Z',
  name: `Produkt ${id}`,
  ...overrides,
})

// Adapter UND Datenbankname je Test — siehe `.claude/rules/code-style.md` §10 und den
// Kommentar in `cache-bootstrap.spec.ts`. `onTestFinished` schliesst die Verbindung, sonst
// blockiert ein spaeteres deleteDB auf der noch offenen Connection.
let dbSeq = 0

async function openAdapter() {
  const adapter = new IdbStorageAdapter()
  const dbName = `adapter-test-db-${++dbSeq}`
  await adapter.open(dbName, SCHEMA)
  onTestFinished(() => adapter.close())
  return { adapter, dbName }
}

describe('IdbStorageAdapter', () => {
  it('persistiert und liest einen Datensatz über _id', async () => {
    const { adapter } = await openAdapter()

    await adapter.put('products', product('p1'))
    const loaded = await adapter.get<TestProduct>('products', 'p1')
    expect(loaded?.name).toBe('Produkt p1')
  })

  it('liefert undefined für eine unbekannte ID', async () => {
    const { adapter } = await openAdapter()

    expect(await adapter.get('products', 'missing')).toBeUndefined()
  })

  it('bulkPut schreibt mehrere Datensätze in einer Transaktion', async () => {
    const { adapter } = await openAdapter()

    await adapter.bulkPut('products', [product('p1'), product('p2'), product('p3')])
    expect(await adapter.count('products')).toBe(3)
  })

  it('getAllByIndex filtert über die updatedAt-Range (Delta-Cursor)', async () => {
    const { adapter } = await openAdapter()

    await adapter.bulkPut('products', [
      product('p1', { updatedAt: '2026-05-30T09:00:00.000Z' }),
      product('p2', { updatedAt: '2026-05-30T11:00:00.000Z' }),
      product('p3', { updatedAt: '2026-05-30T12:00:00.000Z' }),
    ])
    const since = IDBKeyRange.lowerBound('2026-05-30T10:00:00.000Z', true)
    const delta = await adapter.getAllByIndex<TestProduct>('products', 'updatedAt', since)
    expect(delta.map(p => p._id).sort()).toEqual(['p2', 'p3'])
  })

  it('delete und clear entfernen Datensätze', async () => {
    const { adapter } = await openAdapter()

    await adapter.bulkPut('products', [product('p1'), product('p2')])
    await adapter.delete('products', 'p1')
    expect(await adapter.count('products')).toBe(1)
    await adapter.clear('products')
    expect(await adapter.count('products')).toBe(0)
  })

  it('wirft, wenn vor open() zugegriffen wird', async () => {
    const fresh = new IdbStorageAdapter()
    await expect(fresh.get('products', 'p1')).rejects.toThrow(/nicht geöffnet/)
  })

  it('destroy löscht die gesamte Datenbank', async () => {
    const { adapter, dbName } = await openAdapter()

    await adapter.put('products', product('p1'))
    await adapter.destroy(dbName)
    await adapter.open(dbName, SCHEMA)
    expect(await adapter.count('products')).toBe(0)
  })
})
