import { addFormats, Ajv } from '@feathersjs/schema'
import type { TSchema } from '@feathersjs/typebox'
import { describe, expect, it } from 'vitest'

import {
  productDataSchema,
  productLabelingSchema,
  productPatchSchema,
  productQuerySchema,
  productSchema,
} from './product.schema'

// Schema-Spec für die Deklaration am Produkt (#393, ADR 0050). Geprüft wird mit derselben
// AJV-Konfiguration wie `dataValidator`/`queryValidator` aus @panary/shared-backend —
// `Value.Check` scheitert an StringEnum (Type.Unsafe), und genau die Enum-Prüfung ist hier der
// Punkt. Je Schema eine eigene AJV-Instanz, damit kein `$id` aus einem Test in den nächsten reicht.
const compile = (schema: TSchema, options: { coerceTypes?: boolean } = {}) =>
  addFormats(new Ajv(options), ['uuid', 'date-time']).compile(schema)

const TENANT = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e2'
const LOCATION = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e3'
const USER = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e4'

const productData = (extra: Record<string, unknown> = {}) => ({
  name: 'Laugenbrezel',
  acronym: 'BREZEL',
  price: 1.2,
  taxInside: 19,
  taxOutside: 7,
  tenantId: TENANT,
  locationId: LOCATION,
  ...extra,
})

const labeling = (extra: Record<string, unknown> = {}) => ({
  allergens: ['GLUTEN', 'MILK'],
  additives: ['PRESERVATIVE'],
  declaredAt: '2026-09-26T08:00:00.000Z',
  declaredBy: USER,
  ...extra,
})

describe('productLabelingSchema', () => {
  it('ist geschlossen (additionalProperties: false)', () => {
    expect(productLabelingSchema.additionalProperties).toBe(false)
  })

  it('verlangt beide Listen, aber keinen der Server-Stempel', () => {
    // declaredAt/declaredBy setzt der Server; stünden sie in `required`, lehnte validateData
    // jede Bestätigung ab, bevor der stempelnde Hook überhaupt läuft.
    expect([...(productLabelingSchema.required ?? [])].sort()).toEqual(['additives', 'allergens'])
  })
})

describe('productDataSchema (create) — drei Zustände', () => {
  const validate = compile(productDataSchema)

  it('nicht deklariert: ohne `labeling`', () => {
    expect(validate(productData())).toBe(true)
  })

  it('deklariert ohne: leere Listen', () => {
    expect(validate(productData({ labeling: labeling({ allergens: [], additives: [] }) }))).toBe(true)
  })

  it('deklariert mit: Allergene und Zusatzstoffe', () => {
    expect(validate(productData({ labeling: labeling() }))).toBe(true)
  })

  it('akzeptiert eine Deklaration ohne declaredAt/declaredBy — die stempelt der Server', () => {
    expect(validate(productData({ labeling: { allergens: ['EGG'], additives: [] } }))).toBe(true)
  })

  it('akzeptiert `labeling: null` als „nicht deklariert"', () => {
    expect(validate(productData({ labeling: null }))).toBe(true)
  })
})

describe('productDataSchema (create) — Ablehnungen', () => {
  const validate = compile(productDataSchema)

  it('lehnt einen unbekannten Allergen-Code ab', () => {
    expect(validate(productData({ labeling: labeling({ allergens: ['PEANUT'] }) }))).toBe(false)
  })

  it('lehnt einen unbekannten Zusatzstoff-Code ab', () => {
    expect(validate(productData({ labeling: labeling({ additives: ['SULPHURED'] }) }))).toBe(false)
  })

  it('lehnt vertauschte Kataloge ab — ein Allergen ist kein Zusatzstoff', () => {
    expect(validate(productData({ labeling: labeling({ additives: ['GLUTEN'] }) }))).toBe(false)
    expect(validate(productData({ labeling: labeling({ allergens: ['COLOURING'] }) }))).toBe(false)
  })

  it('lehnt eine Deklaration mit nur einer Liste ab', () => {
    expect(validate(productData({ labeling: { allergens: ['MILK'] } }))).toBe(false)
    expect(validate(productData({ labeling: { additives: [] } }))).toBe(false)
  })

  it('lehnt doppelte Codes ab', () => {
    expect(validate(productData({ labeling: labeling({ allergens: ['MILK', 'MILK'] }) }))).toBe(false)
  })

  it('lehnt ein zusätzliches Feld in der Deklaration ab', () => {
    expect(validate(productData({ labeling: labeling({ source: 'ingredients' }) }))).toBe(false)
  })

  it('lehnt declaredAt ohne ISO-8601-Zeitstempel ab', () => {
    expect(validate(productData({ labeling: labeling({ declaredAt: '26.09.2026' }) }))).toBe(false)
  })

  it('lehnt declaredBy ohne UUID ab', () => {
    expect(validate(productData({ labeling: labeling({ declaredBy: 'michael' }) }))).toBe(false)
  })
})

describe('productPatchSchema', () => {
  const validate = compile(productPatchSchema)

  it('erbt die Deklaration aus productSchema', () => {
    expect(validate({ labeling: labeling() })).toBe(true)
  })

  it('akzeptiert `labeling: null` — der Widerruf', () => {
    expect(validate({ labeling: null })).toBe(true)
  })

  it('ersetzt die Deklaration nur ganz — eine Teil-Deklaration wird abgelehnt', () => {
    expect(validate({ labeling: { allergens: ['MILK'] } })).toBe(false)
  })
})

describe('productQuerySchema', () => {
  it('bietet `labeling` bewusst nicht als Filter an (ADR 0050)', () => {
    const validate = compile(productQuerySchema, { coerceTypes: true })
    expect(validate({ name: 'Brezel' })).toBe(true)
    expect(validate({ labeling: null })).toBe(false)
  })
})

describe('productSchema', () => {
  it('führt `labeling` als optionales Feld — Bestandsprodukte bleiben gültig', () => {
    expect(productSchema.properties).toHaveProperty('labeling')
    expect(productSchema.required).not.toContain('labeling')
  })
})
