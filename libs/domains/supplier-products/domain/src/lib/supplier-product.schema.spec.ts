import { describe, expect, it } from 'vitest'
import {
  SUPPLIER_PRODUCT_SOURCES,
  SUPPLIER_PRODUCT_STATUSES,
  supplierProductSchema,
  supplierProductPreviewSchema,
} from './supplier-product.schema'

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
