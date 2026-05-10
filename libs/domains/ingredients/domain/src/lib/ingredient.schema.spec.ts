import { describe, expect, it } from 'vitest'
import {
  INGREDIENT_STATUSES,
  INGREDIENT_VERSION_FIELDS,
  ingredientSchema,
} from './ingredient.schema'

describe('ingredientSchema', () => {
  it('hat die Kern-Pflicht-Felder', () => {
    const required = (ingredientSchema as { required?: string[] }).required ?? []
    expect(required).toContain('_id')
    expect(required).toContain('name')
    expect(required).toContain('baseUnit')
    expect(required).toContain('tenantId')
  })

  it('hat die richtige $id-Annotation', () => {
    expect((ingredientSchema as { $id?: string }).$id).toBe('Ingredient')
  })
})

describe('INGREDIENT_VERSION_FIELDS', () => {
  it('enthält genau die drei strukturellen Whitelist-Felder', () => {
    expect([...INGREDIENT_VERSION_FIELDS]).toEqual([
      'baseUnit',
      'baseQuantity',
      'conversionFactor',
    ])
  })
})

describe('INGREDIENT_STATUSES', () => {
  it('definiert die drei Lifecycle-Werte', () => {
    expect(INGREDIENT_STATUSES).toEqual(['ACTIVE', 'DRAFT', 'ARCHIVED'])
  })
})
