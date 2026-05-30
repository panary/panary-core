import { describe, expect, it } from 'vitest'

import { buildCacheBuildId, buildCacheDatabaseName, CACHE_DB_PREFIX } from './cache-namespace'

describe('buildCacheDatabaseName', () => {
  it('isoliert Tenant, Location und Server-Host', () => {
    const name = buildCacheDatabaseName({
      tenantId: 't1',
      locationId: 'l1',
      serverUrl: 'https://cloud.panary.app',
    })
    expect(name).toBe(`${CACHE_DB_PREFIX}::t1::l1::cloud.panary.app`)
  })

  it('verwendet "global" für locationId null', () => {
    const name = buildCacheDatabaseName({
      tenantId: 't1',
      locationId: null,
      serverUrl: 'http://localhost:3030',
    })
    expect(name).toBe(`${CACHE_DB_PREFIX}::t1::global::localhost:3030`)
  })

  it('erzeugt für unterschiedliche Tenants unterschiedliche DB-Namen', () => {
    const a = buildCacheDatabaseName({ tenantId: 't1', locationId: 'l1', serverUrl: 'https://c.app' })
    const b = buildCacheDatabaseName({ tenantId: 't2', locationId: 'l1', serverUrl: 'https://c.app' })
    expect(a).not.toBe(b)
  })

  it('fällt bei ungültiger URL auf den Rohwert zurück', () => {
    const name = buildCacheDatabaseName({ tenantId: 't1', locationId: 'l1', serverUrl: 'not-a-url' })
    expect(name).toBe(`${CACHE_DB_PREFIX}::t1::l1::not-a-url`)
  })
})

describe('buildCacheBuildId', () => {
  it('kombiniert App- und Schema-Version', () => {
    expect(buildCacheBuildId({ appVersion: '26.5.1', schemaVersion: 3 })).toBe('26.5.1#3')
  })

  it('ändert sich bei einem Schema-Bump', () => {
    const v1 = buildCacheBuildId({ appVersion: '26.5.1', schemaVersion: 1 })
    const v2 = buildCacheBuildId({ appVersion: '26.5.1', schemaVersion: 2 })
    expect(v1).not.toBe(v2)
  })
})
