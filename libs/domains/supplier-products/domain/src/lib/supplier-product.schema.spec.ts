import { addFormats, Ajv } from '@feathersjs/schema'
import type { TSchema } from '@feathersjs/typebox'
import { describe, expect, it } from 'vitest'
import {
  SUPPLIER_PRODUCT_SOURCES,
  SUPPLIER_PRODUCT_STATUSES,
  supplierProductSchema,
  supplierProductPreviewSchema,
} from './supplier-product.schema'

// Dieselbe AJV-Konfiguration wie der Feathers-`dataValidator`; `Value.Check` scheitert an
// StringEnum (Type.Unsafe); `uri` fuer `imageUrl`. Je Schema eine eigene Instanz — beide
// betten `supplierProductNutritionSchema` samt `$id` ein.
const compile = (schema: TSchema) => addFormats(new Ajv({}), ['uuid', 'date-time', 'uri']).compile(schema)

describe('supplierProductSchema', () => {
  it('hat die Kern-Pflicht-Felder', () => {
    const required = (supplierProductSchema as { required?: string[] }).required ?? []
    expect(required).toContain('_id')
    expect(required).toContain('ingredientId')
    expect(required).toContain('productName')
    expect(required).toContain('packageQuantity')
    expect(required).toContain('packageUnit')
    expect(required).toContain('source')
    expect(required).toContain('tenantId')
  })

  it('hat die richtige $id-Annotation', () => {
    expect((supplierProductSchema as { $id?: string }).$id).toBe('SupplierProduct')
  })
})

describe('supplierProductPreviewSchema', () => {
  it('hat gtin und source als Pflicht-Felder', () => {
    const required = (supplierProductPreviewSchema as { required?: string[] }).required ?? []
    expect(required).toContain('gtin')
    expect(required).toContain('source')
  })
})

describe('SUPPLIER_PRODUCT_SOURCES', () => {
  it('definiert MANUAL, OFF, GS1', () => {
    expect(SUPPLIER_PRODUCT_SOURCES).toEqual(['MANUAL', 'OFF', 'GS1'])
  })
})

describe('SUPPLIER_PRODUCT_STATUSES', () => {
  it('definiert die drei Lifecycle-Werte', () => {
    expect(SUPPLIER_PRODUCT_STATUSES).toEqual(['ACTIVE', 'DRAFT', 'ARCHIVED'])
  })
})

// Die Codes stehen als Literale da, nicht als `ALLERGENS[0]`: Laedt der Testlauf
// `@panary/allergens/domain` als dist-`.d.ts` (ohne den Resolver in `vitest.config.mts`),
// ist `allergenSchema` `undefined`. Dann sollen genau diese Tests mit einer Assertion rot
// werden — nicht die Datei mit einem TypeError beim Sammeln (panary/panary-core#403).
describe('allergens — nur bekannte Codes', () => {
  const record = {
    _id: 'sp-1',
    ingredientId: 'i-1',
    productName: 'Weizenmehl Type 550',
    packageQuantity: 25,
    packageUnit: 'KILOGRAM',
    source: 'MANUAL',
    tenantId: 't-1',
  }
  const preview = { gtin: '4000000000000', source: 'OFF' }

  it.each([
    ['supplierProductSchema', supplierProductSchema, record],
    ['supplierProductPreviewSchema', supplierProductPreviewSchema, preview],
  ] as const)('%s akzeptiert bekannte und lehnt unbekannte Codes ab', (_name, schema, base) => {
    const validate = compile(schema)
    expect(validate({ ...base, allergens: ['GLUTEN', 'SOY'] })).toBe(true)
    expect(validate({ ...base, allergens: ['GLUTEN', 'KEIN_ALLERGEN'] })).toBe(false)
  })
})
