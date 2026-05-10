import { describe, expect, it } from 'vitest'
import { RECIPE_VERSION_FIELDS, recipeSchema } from './recipe.schema'

describe('recipeSchema', () => {
  it('hat die Kern-Pflicht-Felder', () => {
    const required = (recipeSchema as { required?: string[] }).required ?? []
    expect(required).toContain('_id')
    expect(required).toContain('name')
    expect(required).toContain('baseUnit')
    expect(required).toContain('baseQuantity')
    expect(required).toContain('ingredients')
    expect(required).toContain('tenantId')
  })

  it('hat die richtige $id-Annotation', () => {
    expect((recipeSchema as { $id?: string }).$id).toBe('Recipe')
  })

  it('hat additionalProperties: false (strict)', () => {
    expect((recipeSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false)
  })

  it('definiert defaultReferenceQuantity als optional', () => {
    const props = (recipeSchema as { properties?: Record<string, unknown> }).properties ?? {}
    expect(props['defaultReferenceQuantity']).toBeDefined()
    const required = (recipeSchema as { required?: string[] }).required ?? []
    expect(required).not.toContain('defaultReferenceQuantity')
  })

  it('enthält weder version (Legacy) noch ingredientReferences/recipeReferences (Legacy)', () => {
    const props = (recipeSchema as { properties?: Record<string, unknown> }).properties ?? {}
    expect(props['version']).toBeUndefined()
    expect(props['ingredientReferences']).toBeUndefined()
    expect(props['recipeReferences']).toBeUndefined()
  })
})

describe('RECIPE_VERSION_FIELDS', () => {
  it('enthält die strukturellen + preisbildenden Felder', () => {
    expect([...RECIPE_VERSION_FIELDS]).toEqual([
      'baseUnit',
      'baseQuantity',
      'priceAdjustment',
      'ingredients',
    ])
  })
})
