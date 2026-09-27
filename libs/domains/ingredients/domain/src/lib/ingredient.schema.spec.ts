import { addFormats, Ajv } from '@feathersjs/schema'
import type { TSchema } from '@feathersjs/typebox'
import { describe, expect, it } from 'vitest'
import {
  INGREDIENT_STATUSES,
  INGREDIENT_VERSION_FIELDS,
  ingredientSchema,
  ingredientWithComputedSchema,
} from './ingredient.schema'

// Dieselbe AJV-Konfiguration wie der Feathers-`dataValidator`; `Value.Check` scheitert an
// StringEnum (Type.Unsafe). Je Schema eine eigene Instanz, damit keine `$id` kollidiert.
const compile = (schema: TSchema) => addFormats(new Ajv({}), ['uuid', 'date-time']).compile(schema)

const minimal = { _id: 'i-1', name: 'Weizenmehl', baseUnit: 'GRAM', tenantId: 't-1' }

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
    expect([...INGREDIENT_VERSION_FIELDS]).toEqual(['baseUnit', 'baseQuantity', 'conversionFactor'])
  })
})

describe('INGREDIENT_STATUSES', () => {
  it('definiert die drei Lifecycle-Werte', () => {
    expect(INGREDIENT_STATUSES).toEqual(['ACTIVE', 'DRAFT', 'ARCHIVED'])
  })
})

// Die Codes stehen als Literale da, nicht als `ALLERGENS[0]`: Laedt der Testlauf
// `@panary/allergens/domain` als dist-`.d.ts` (ohne den Resolver in `vitest.config.mts`),
// ist jeder Export `undefined`. Dann sollen genau diese Tests mit einer Assertion rot
// werden — nicht die Datei mit einem TypeError beim Sammeln (panary/panary-core#403).
describe('ingredientSchema — Allergen- und Diät-Codes', () => {
  const validate = compile(ingredientSchema)

  it('akzeptiert bekannte Codes', () => {
    expect(validate({ ...minimal, allergensManual: ['GLUTEN', 'EGG'], dietaryTags: ['VEGAN'] })).toBe(true)
  })

  it('lehnt einen unbekannten Code in allergensManual ab', () => {
    expect(validate({ ...minimal, allergensManual: ['GLUTEN', 'KEIN_ALLERGEN'] })).toBe(false)
  })

  it('lehnt einen unbekannten Code in dietaryTags ab', () => {
    expect(validate({ ...minimal, dietaryTags: ['VEGAN', 'KEIN_TAG'] })).toBe(false)
  })
})

describe('ingredientWithComputedSchema — berechnete allergens', () => {
  // TypeBox verschmilzt das Intersect zweier Objekte zu EINEM Objekt, ohne
  // `additionalProperties: false` — `allergens` erreicht also wirklich `allergenSchema`.
  const validate = compile(ingredientWithComputedSchema)

  it('akzeptiert bekannte Codes', () => {
    expect(validate({ ...minimal, allergens: ['GLUTEN', 'MILK'] })).toBe(true)
  })

  it('lehnt einen unbekannten Code ab', () => {
    expect(validate({ ...minimal, allergens: ['GLUTEN', 'KEIN_ALLERGEN'] })).toBe(false)
  })
})
