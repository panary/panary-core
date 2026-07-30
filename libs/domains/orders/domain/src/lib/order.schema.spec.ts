import { FormatRegistry } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  genericLineItemSchema,
  lineComponentSchema,
  modifierLineItemSchema,
  orderLineItemSchema,
  orderQuerySchema,
} from './order.schema'

// TypeBox liefert keine eingebauten Format-Validatoren — in der Feathers-App
// uebernimmt AJV das. Fuer Value.Check registrieren wir die verwendeten
// Formate lokal (analog sync-trigger.schema.spec).
beforeAll(() => {
  if (!FormatRegistry.Has('uuid')) {
    FormatRegistry.Set('uuid', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  }
})

const UUID = {
  line: '019eccc0-e285-7d46-a0c6-a98452192abe',
  product: 'cf095a84-6456-5d0b-bb78-854b497e79be',
  group: '019eccc0-e03d-7df6-a8eb-a0f42f772436',
  modifier: '2145d096-7ea2-58f1-a61b-89d3fb0915f1',
}

const modifier = (amount: number) => ({
  _id: UUID.line,
  externalId: UUID.modifier,
  amount,
  name: 'Bacon',
  parentId: UUID.product,
  price: 1.9,
  recipeReferences: [],
  ingredientReferences: [],
  taxInside: 19,
  taxOutside: 7,
  topic: 'Extras',
})

const lineItem = (overrides: Record<string, unknown> = {}) => ({
  _id: UUID.line,
  externalId: UUID.product,
  amount: 1,
  name: 'Margherita',
  parentId: UUID.group,
  price: 6.7,
  recipeReferences: [],
  ingredientReferences: [],
  taxInside: 19,
  taxOutside: 7,
  topic: 'Pizza',
  productGroupExternalId: UUID.group,
  bundleNumber: null,
  modifiers: [],
  ...overrides,
})

describe('modifierLineItemSchema — „OHNE"-Marker', () => {
  // Regression: `decreaseExtra()` im POS-Bestelldialog legt fuer „OHNE <Extra>"
  // einen Modifier mit amount −1 an; der Bon-Renderer liest genau diesen Wert.
  // Die Inline-Haertung (minimum 0) hatte den Flow ab 2026-05-22 mit
  // „/lineItems/0/modifiers/0/amount must be >= 0" abgelehnt.
  it('akzeptiert amount −1', () => {
    expect(Value.Check(modifierLineItemSchema, modifier(-1))).toBe(true)
  })

  it('akzeptiert positive Mengen', () => {
    expect(Value.Check(modifierLineItemSchema, modifier(2))).toBe(true)
  })

  it('lehnt amount < −1 ab (−1 ist der Boden, die UI erzeugt nichts Kleineres)', () => {
    expect(Value.Check(modifierLineItemSchema, modifier(-2))).toBe(false)
  })
})

describe('modifierLineItemSchema — Abzug via priceAdjustment', () => {
  // Regression: `toggleRemovableIngredient()` übernimmt für entfernbare Zutaten
  // `ingredient.priceAdjustment` als Modifier-`price`. Das Admin-UI in
  // panary-cloud schlägt dort per Placeholder „-1.0" einen NEGATIVEN Wert vor
  // (Abzug fürs Weglassen) — `price minimum 0` lehnte genau das mit
  // „/lineItems/0/modifiers/0/price must be >= 0" ab.
  const withPrice = (price: number) => ({ ...modifier(1), price })

  it('akzeptiert einen negativen Preis', () => {
    expect(Value.Check(modifierLineItemSchema, withPrice(-1))).toBe(true)
  })

  it('akzeptiert weiterhin einen Aufpreis', () => {
    expect(Value.Check(modifierLineItemSchema, withPrice(1.9))).toBe(true)
  })

  it('lehnt einen nicht-numerischen Preis ab', () => {
    expect(Value.Check(modifierLineItemSchema, { ...modifier(1), price: '-1' })).toBe(false)
  })
})

describe('orderLineItemSchema', () => {
  it('akzeptiert eine Position mit „OHNE"-Modifier (amount −1)', () => {
    expect(Value.Check(orderLineItemSchema, lineItem({ modifiers: [modifier(-1)] }))).toBe(true)
  })

  it('lehnt eine negative Menge auf der Position selbst ab', () => {
    expect(Value.Check(orderLineItemSchema, lineItem({ amount: -1 }))).toBe(false)
  })

  it('akzeptiert eine Position mit Abzugs-Modifier (price −1)', () => {
    expect(Value.Check(orderLineItemSchema, lineItem({ modifiers: [{ ...modifier(1), price: -1 }] }))).toBe(true)
  })

  it('lehnt einen negativen Preis auf der Position selbst ab', () => {
    expect(Value.Check(orderLineItemSchema, lineItem({ price: -1 }))).toBe(false)
  })
})

describe('genericLineItemSchema / lineComponentSchema bleiben bei minimum 0', () => {
  // Negative Mengen und Preise haben nur auf Modifier-Ebene eine Bedeutung
  // (OHNE-Marker bzw. konfigurierter Abzug). Auf Hauptartikel und
  // Bundle-Komponenten wuerden sie negativen Verbrauch (explodeOrderConsumption)
  // und negatives Brutto (computeOrderTax) erzeugen.
  it('genericLineItemSchema lehnt amount −1 ab', () => {
    expect(Value.Check(genericLineItemSchema, modifier(-1))).toBe(false)
  })

  it('genericLineItemSchema lehnt price −1 ab', () => {
    expect(Value.Check(genericLineItemSchema, { ...modifier(1), price: -1 })).toBe(false)
  })

  it('lineComponentSchema lehnt amount −1 ab', () => {
    expect(Value.Check(lineComponentSchema, { ...modifier(-1), role: 'drink' })).toBe(false)
  })

  it('lineComponentSchema lehnt price −1 ab', () => {
    expect(Value.Check(lineComponentSchema, { ...modifier(1), price: -1, role: 'drink' })).toBe(false)
  })
})

// Dot-Notation-Filter der Admin-Bestellliste. Sie stehen bewusst NICHT in
// `orderQueryProperties` (TS2589), sondern als flache Properties im
// Query-Schema — dieser Test haelt fest, dass sie tatsaechlich validieren.
describe('orderQuerySchema — Filter fuer Personalessen und Rabatte', () => {
  it('akzeptiert $exists auf staffPaymentInfo.userId (nur Personalessen)', () => {
    expect(Value.Check(orderQuerySchema, { 'staffPaymentInfo.userId': { $exists: true } })).toBe(true)
  })

  it('akzeptiert einen konkreten Mitarbeiter', () => {
    expect(Value.Check(orderQuerySchema, { 'staffPaymentInfo.userId': UUID.line })).toBe(true)
  })

  it('akzeptiert $exists auf appliedDiscounts.discountId (nur rabattierte)', () => {
    expect(Value.Check(orderQuerySchema, { 'appliedDiscounts.discountId': { $exists: true } })).toBe(true)
  })

  it('akzeptiert einen konkreten Rabatt', () => {
    expect(Value.Check(orderQuerySchema, { 'appliedDiscounts.discountId': UUID.product })).toBe(true)
  })

  // Die von `querySyntax` generierten Standard-Properties lassen sich hier NICHT
  // pruefen: `Value.Check` bricht darauf mit „Unknown type" ab (in der App
  // uebernimmt AJV, das damit klarkommt). Dieser Block deckt deshalb bewusst nur
  // die selbst definierten Dot-Felder ab.

  it('lehnt unbekannte Felder weiterhin ab (additionalProperties: false)', () => {
    expect(Value.Check(orderQuerySchema, { nichtVorhanden: 'x' })).toBe(false)
  })

  it('lehnt einen fremden Operator auf dem Dot-Feld ab', () => {
    expect(Value.Check(orderQuerySchema, { 'staffPaymentInfo.userId': { $regex: 'x' } })).toBe(false)
  })
})
