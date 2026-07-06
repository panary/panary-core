// Resolver-Schutz-Spec (repraesentativ fuer alle Edge-Services, #55).
//
// Der Patch-Resolver ist die Schutzschicht fuer server-verwaltete Felder:
// `_id`/`externalId`/`tenantId`/`locationId`/`createdAt` duerfen ueber PATCH
// niemals veraendert werden (→ undefined = Feld wird nicht geschrieben),
// `updatedAt` wird ausschliesslich serverseitig gestempelt. Anders als die
// Cloud (`protectFromExternal`) schuetzt der Edge-Resolver BEDINGUNGSLOS —
// auch interne Patches (provider undefined) koennen diese Felder nicht setzen.

import { describe, expect, it } from 'vitest'
import type { HookContext } from '../../declarations'
import { productsPatchResolver } from './products.schema'

const externalContext = { params: { provider: 'rest' } } as unknown as HookContext
const internalContext = { params: {} } as unknown as HookContext

const hostilePatch = {
  _id: '01931d80-0000-7000-8000-000000000001',
  externalId: '01931d80-0000-7000-8000-000000000002',
  tenantId: '01931d80-0000-7000-8000-000000000003',
  locationId: '01931d80-0000-7000-8000-000000000004',
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  name: 'Neuer Name',
  price: 4.2,
} as unknown

describe('productsPatchResolver — Schutz server-verwalteter Felder', () => {
  it('verwirft _id/externalId/tenantId/locationId/createdAt bei externem Patch', async () => {
    const result = (await productsPatchResolver.resolve(hostilePatch, externalContext)) as Record<string, unknown>

    expect(result['_id']).toBeUndefined()
    expect(result['externalId']).toBeUndefined()
    expect(result['tenantId']).toBeUndefined()
    expect(result['locationId']).toBeUndefined()
    expect(result['createdAt']).toBeUndefined()
  })

  it('stempelt updatedAt serverseitig auf einen frischen ISO-8601-String (Client-Wert wird ignoriert)', async () => {
    const before = Date.now()
    const result = (await productsPatchResolver.resolve(hostilePatch, externalContext)) as { updatedAt?: string }

    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(result.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    expect(new Date(result.updatedAt as string).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('laesst ungeschuetzte Felder unveraendert durch', async () => {
    const result = (await productsPatchResolver.resolve(hostilePatch, externalContext)) as Record<string, unknown>

    expect(result['name']).toBe('Neuer Name')
    expect(result['price']).toBe(4.2)
  })

  it('schuetzt auch bei internen Patches (bedingungslos, kein protectFromExternal-Bypass)', async () => {
    const result = (await productsPatchResolver.resolve(hostilePatch, internalContext)) as Record<string, unknown>

    expect(result['_id']).toBeUndefined()
    expect(result['externalId']).toBeUndefined()
    expect(result['tenantId']).toBeUndefined()
    expect(result['locationId']).toBeUndefined()
    expect(result['createdAt']).toBeUndefined()
    expect(result['name']).toBe('Neuer Name')
  })

  it('stempelt updatedAt auch bei leerem Patch (jeder Patch aktualisiert den Zeitstempel)', async () => {
    const result = (await productsPatchResolver.resolve({} as unknown, externalContext)) as Record<string, unknown>

    expect(typeof result['updatedAt']).toBe('string')
    expect(Object.keys(result)).toEqual(['updatedAt'])
  })
})
