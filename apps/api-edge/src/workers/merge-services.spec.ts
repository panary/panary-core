// Invariante fuer den Bootstrap-Modus `merge-by-external-id` (#184).
//
// `runMergeByExternalId` matcht ausschliesslich ueber `record.externalId`. Steht
// ein Service in der Liste, dessen Domain-Schema das Feld nicht kennt, laeuft
// JEDER seiner Edge-Records in den `external-id-missing`-Zweig und wird zum
// `sync-conflict` — ein frisch aufgesetzter Edge produziert damit garantiert
// mindestens einen, und bei `users` ist er unaufloesbar, weil `tenant:owner`
// nie zur Cloud gepusht wird.
//
// Genau das war bis #184 der Fall: Die Liste war eine Ausschlussliste, und
// `users`/`customers`/`corporate-customers` standen darin, ohne `externalId` je
// gehabt zu haben. Diese Spec haelt fest, dass die Allowlist und die Schemas
// nicht wieder auseinanderlaufen.

import { describe, expect, it } from 'vitest'

import { corporateCustomerDataSchema } from '@panary/corporate-customers/domain'
import { customerDataSchema } from '@panary/customers/domain'
import { productGroupDataSchema } from '@panary/product-groups/domain'
import { productDataSchema } from '@panary/products/domain'
import { userDataSchema } from '@panary/users/domain'

import { MERGE_BY_EXTERNAL_ID_SERVICES } from './merge-services'

/** Sammelt die Property-Namen eines TypeBox-Schemas inkl. Type.Intersect-Zweigen. */
const propertyNames = (schema: unknown): string[] => {
  if (!schema || typeof schema !== 'object') return []
  const node = schema as { properties?: Record<string, unknown>; allOf?: unknown[] }
  const own = node.properties ? Object.keys(node.properties) : []
  const nested = Array.isArray(node.allOf) ? node.allOf.flatMap(propertyNames) : []
  return [...own, ...nested]
}

const DATA_SCHEMAS: Record<string, unknown> = {
  products: productDataSchema,
  'product-groups': productGroupDataSchema,
  users: userDataSchema,
  customers: customerDataSchema,
  'corporate-customers': corporateCustomerDataSchema,
}

describe('MERGE_BY_EXTERNAL_ID_SERVICES', () => {
  it('listet nur Services, deren Data-Schema externalId fuehrt', () => {
    for (const service of MERGE_BY_EXTERNAL_ID_SERVICES) {
      const schema = DATA_SCHEMAS[service]
      expect(schema, `Kein Data-Schema fuer '${service}' hinterlegt — Spec erweitern`).toBeDefined()
      expect(propertyNames(schema), `'${service}' steht im Merge-Pfad, hat aber kein externalId`).toContain('externalId')
    }
  })

  it.each(['users', 'customers', 'corporate-customers'])(
    '%s steht NICHT im Merge-Pfad (kein externalId-Traeger)',
    service => {
      expect(propertyNames(DATA_SCHEMAS[service])).not.toContain('externalId')
      expect(MERGE_BY_EXTERNAL_ID_SERVICES).not.toContain(service)
    },
  )

  it('ist nicht leer — sonst waere der Merge-Modus wirkungslos', () => {
    expect(MERGE_BY_EXTERNAL_ID_SERVICES.length).toBeGreaterThan(0)
  })

  it('fuehrt product-groups vor products (Referenz-Reihenfolge)', () => {
    const groups = MERGE_BY_EXTERNAL_ID_SERVICES.indexOf('product-groups')
    const products = MERGE_BY_EXTERNAL_ID_SERVICES.indexOf('products')
    expect(groups).toBeGreaterThanOrEqual(0)
    expect(groups).toBeLessThan(products)
  })
})
