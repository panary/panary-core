import { describe, expect, it } from 'vitest'

import { pricelistSchema, pricelistProductPriceSchema, pricelistStatusSchema } from './pricelist.schema'

describe('pricelistSchema', () => {
  it('hat $id "Pricelist"', () => {
    expect((pricelistSchema as { $id?: string }).$id).toBe('Pricelist')
  })

  it('verbietet additionalProperties', () => {
    expect((pricelistSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false)
  })

  it('definiert productPrices als Pflichtfeld (Array)', () => {
    const required = (pricelistSchema as { required?: string[] }).required ?? []
    expect(required).toContain('productPrices')
    expect(required).toContain('name')
    expect(required).toContain('externalId')
  })

  it('Item-Schema deckt updateStatus + Tracking-Felder', () => {
    const props = (pricelistProductPriceSchema as { properties: Record<string, unknown> }).properties
    expect(props).toHaveProperty('productId')
    expect(props).toHaveProperty('oldPrice')
    expect(props).toHaveProperty('newPrice')
    expect(props).toHaveProperty('updateStatus')
    expect(props).toHaveProperty('updatedAt')
    expect(props).toHaveProperty('updatedBy')
  })

  it('Status-Enum enthält die vier erwarteten Werte', () => {
    const enumValues = (pricelistStatusSchema as { enum?: string[] }).enum ?? []
    expect(enumValues).toEqual(expect.arrayContaining(['DRAFT', 'ACTIVE', 'APPLIED', 'ARCHIVED']))
  })

  it('Legacy-Felder (items, currency, isDefault) sind NICHT enthalten', () => {
    const props = (pricelistSchema as { properties: Record<string, unknown> }).properties
    expect(props).not.toHaveProperty('items')
    expect(props).not.toHaveProperty('currency')
    expect(props).not.toHaveProperty('isDefault')
  })
})
