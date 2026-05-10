import { describe, expect, it } from 'vitest'
import { ALLERGENS, OFF_ALLERGEN_TAG_MAP } from './allergen.enum'
import { DIETARY_TAGS } from './dietary-tag.enum'

describe('ALLERGENS', () => {
  it('umfasst alle 14 EU-LMIV-Allergene', () => {
    expect(ALLERGENS).toHaveLength(14)
  })

  it('enthält die wichtigen Hauptallergene', () => {
    expect(ALLERGENS).toContain('GLUTEN')
    expect(ALLERGENS).toContain('MILK')
    expect(ALLERGENS).toContain('EGG')
    expect(ALLERGENS).toContain('NUTS')
  })
})

describe('OFF_ALLERGEN_TAG_MAP', () => {
  it('mappt jeden OFF-Tag auf einen gültigen Allergen', () => {
    expect(Object.keys(OFF_ALLERGEN_TAG_MAP)).toHaveLength(ALLERGENS.length)
    for (const panaryAllergen of Object.values(OFF_ALLERGEN_TAG_MAP)) {
      expect(ALLERGENS).toContain(panaryAllergen)
    }
  })

  it('enthält Mappings für die typischen OFF-Tag-Schreibweisen', () => {
    expect(OFF_ALLERGEN_TAG_MAP['en:milk']).toBe('MILK')
    expect(OFF_ALLERGEN_TAG_MAP['en:gluten']).toBe('GLUTEN')
    expect(OFF_ALLERGEN_TAG_MAP['en:eggs']).toBe('EGG')
    expect(OFF_ALLERGEN_TAG_MAP['en:soybeans']).toBe('SOY')
    expect(OFF_ALLERGEN_TAG_MAP['en:sesame-seeds']).toBe('SESAME')
  })
})

describe('DIETARY_TAGS', () => {
  it('enthält die Standard-Tags', () => {
    expect(DIETARY_TAGS).toContain('VEGETARIAN')
    expect(DIETARY_TAGS).toContain('VEGAN')
    expect(DIETARY_TAGS).toContain('GLUTEN_FREE')
    expect(DIETARY_TAGS).toContain('LACTOSE_FREE')
  })
})
