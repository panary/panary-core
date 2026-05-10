import { describe, expect, it } from 'vitest'
import { SUPPLIER_STATUSES, supplierSchema } from './supplier.schema'

describe('supplierSchema', () => {
  it('hat die Pflicht-Felder im TypeBox-Schema', () => {
    const required = (supplierSchema as { required?: string[] }).required ?? []
    expect(required).toContain('_id')
    expect(required).toContain('name')
    expect(required).toContain('tenantId')
  })

  it('exposes 3 Lifecycle-Status-Werte', () => {
    expect(SUPPLIER_STATUSES).toEqual(['ACTIVE', 'DRAFT', 'ARCHIVED'])
  })

  it('hat die richtige $id-Annotation für Schema-Discovery', () => {
    expect((supplierSchema as { $id?: string }).$id).toBe('Supplier')
  })
})
