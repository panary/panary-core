import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

describe('IdbStorageAdapter', () => {
  let adapter: IdbStorageAdapter
  const dbName = 'adapter-test-db'

  beforeEach(async () => {
    adapter = new IdbStorageAdapter()
    await adapter.destroy(dbName)
    await adapter.open(dbName, SCHEMA)
  })

  // Verbindung schließen, sonst blockiert das destroy() des nächsten beforeEach (deleteDB wartet auf offene Connection)
  afterEach(() => {
    adapter.close()
  })

  it('persistiert und liest einen Datensatz über _id', async () => {
    await adapter.put('products', product('p1'))
    const loaded = await adapter.get<TestProduct>('products', 'p1')
    expect(loaded?.name).toBe('Produkt p1')
  })

  it('liefert undefined für eine unbekannte ID', async () => {
    expect(await adapter.get('products', 'missing')).toBeUndefined()
  })

  it('bulkPut schreibt mehrere Datensätze in einer Transaktion', async () => {
    await adapter.bulkPut('products', [product('p1'), product('p2'), product('p3')])
    expect(await adapter.count('products')).toBe(3)
  })

  it('getAllByIndex filtert über die updatedAt-Range (Delta-Cursor)', async () => {
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
    await adapter.put('products', product('p1'))
    await adapter.destroy(dbName)
    await adapter.open(dbName, SCHEMA)
    expect(await adapter.count('products')).toBe(0)
  })
})
