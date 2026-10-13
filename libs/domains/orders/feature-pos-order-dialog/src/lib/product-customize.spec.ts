import { describe, expect, it } from 'vitest'

import type { OrderLineItem } from '@panary/orders/data-access'
import type { ProductSchema } from '@panary/products/domain'

import {
  buildCustomizeModel,
  hasCustomizableContent,
  opensCustomizeAutomatically,
  toggleIngredientRemoval,
} from './product-customize'

/**
 * Anpassen-Panel (#639): Modell und Zutaten-Abwahl ohne Angular.
 * Alles je Test angelegt (code-style.md §10) — die Fabriken liefern frische Objekte.
 */

const KETCHUP = '018f0000-0000-7000-8000-00000000a001'
const ZWIEBEL = '018f0000-0000-7000-8000-00000000a002'
const SALAT = '018f0000-0000-7000-8000-00000000a003'

const ingredient = (externalId: string, name: string, over: Record<string, unknown> = {}) => ({
  externalId,
  version: 1,
  ingredientName: name,
  initialQuantity: 1,
  quantity: 1,
  onlyOutsideConsumption: false,
  isRemovable: true,
  priceAdjustment: 0,
  ...over,
})

const product = (over: Partial<ProductSchema> = {}): ProductSchema =>
  ({
    _id: 'burger',
    externalId: 'ext-burger',
    name: 'Burger',
    price: 9,
    ...over,
  }) as unknown as ProductSchema

const line = (over: Partial<OrderLineItem> = {}): OrderLineItem =>
  ({
    _id: 'line-1',
    externalId: 'ext-burger',
    name: 'Burger',
    amount: 1,
    price: 9,
    modifiers: [],
    taxInside: 19,
    taxOutside: 7,
    ingredientReferences: [ingredient(KETCHUP, 'Ketchup'), ingredient(SALAT, 'Salat', { isRemovable: false })],
    recipeReferences: [],
    topic: '',
    ...over,
  }) as unknown as OrderLineItem

const cheese = { _id: 'cheese', name: 'Käse', price: 0.5, productType: 'MODIFIER' } as unknown as ProductSchema
const bacon = { _id: 'bacon', name: 'Bacon', price: 1.5, productType: 'MODIFIER' } as unknown as ProductSchema
const fries = { _id: 'fries', name: 'Pommes', price: 3, productType: 'PRODUCT' } as unknown as ProductSchema

const catalog = {
  findProductById: (id: string) => [cheese, bacon, fries].find(p => p._id === id),
  isModifier: (p: ProductSchema) => p.productType === 'MODIFIER',
}

const extrasGroup = (over: Record<string, unknown> = {}) => ({
  id: 'g-extras',
  name: 'Extras',
  minSelections: 0,
  maxSelections: 2,
  freeQuantity: 0,
  options: [{ productId: 'cheese' }, { productId: 'bacon' }],
  ...over,
})

describe('hasCustomizableContent / opensCustomizeAutomatically', () => {
  it('erkennt entfernbare Zutaten und Optionsgruppen, sonst nichts', () => {
    expect(hasCustomizableContent(product({ ingredientReferences: [ingredient(KETCHUP, 'Ketchup')] } as never))).toBe(
      true,
    )
    expect(hasCustomizableContent(product({ optionGroups: [extrasGroup()] } as never))).toBe(true)
    expect(
      hasCustomizableContent(
        product({ ingredientReferences: [ingredient(SALAT, 'Salat', { isRemovable: false })] } as never),
      ),
    ).toBe(false)
    expect(hasCustomizableContent(product({ optionGroups: [extrasGroup({ options: [] })] } as never))).toBe(false)
    expect(hasCustomizableContent(product())).toBe(false)
  })

  it('öffnet nur mit ui.showOptionsAuto UND anpassbarem Inhalt', () => {
    const ui = { index: 1, showOptionsAuto: true, hideOnMainScreen: false }
    const withContent = { ingredientReferences: [ingredient(KETCHUP, 'Ketchup')] }
    expect(opensCustomizeAutomatically(product({ ui, ...withContent } as never))).toBe(true)
    expect(
      opensCustomizeAutomatically(product({ ui: { ...ui, showOptionsAuto: false }, ...withContent } as never)),
    ).toBe(false)
    expect(opensCustomizeAutomatically(product(withContent as never))).toBe(false)
    expect(opensCustomizeAutomatically(product({ ui } as never))).toBe(false)
  })
})

describe('toggleIngredientRemoval', () => {
  it('legt genau einen „Ohne"-Modifier an und nimmt ihn beim zweiten Tipp wieder weg', () => {
    const item = line()
    const ketchup = ingredient(KETCHUP, 'Ketchup', { priceAdjustment: -0.3 })

    expect(toggleIngredientRemoval(item, ketchup, 'Extras')).toBe(true)
    expect(item.modifiers).toEqual([
      {
        _id: KETCHUP,
        externalId: KETCHUP,
        name: 'Ohne Ketchup',
        amount: 1,
        price: -0.3,
        parentId: 'ext-burger',
        taxInside: 19,
        taxOutside: 7,
        topic: 'Extras',
        recipeReferences: [],
        ingredientReferences: [],
      },
    ])

    expect(toggleIngredientRemoval(item, ketchup, 'Extras')).toBe(false)
    expect(item.modifiers).toEqual([])
  })

  it('lässt andere Modifier der Zeile stehen', () => {
    const item = line({ modifiers: [{ _id: 'cheese', name: 'Käse', amount: 1, price: 0.5 }] as never })
    toggleIngredientRemoval(item, ingredient(KETCHUP, 'Ketchup'), 'Extras')
    toggleIngredientRemoval(item, ingredient(KETCHUP, 'Ketchup'), 'Extras')
    expect(item.modifiers.map(m => m.name)).toEqual(['Käse'])
  })
})

describe('buildCustomizeModel', () => {
  it('zeigt nur entfernbare Zutaten, mit Abwahl-Zustand', () => {
    const item = line({
      ingredientReferences: [
        ingredient(KETCHUP, 'Ketchup'),
        ingredient(ZWIEBEL, 'Zwiebel', { displayName: 'Rote Zwiebel' }),
        ingredient(SALAT, 'Salat', { isRemovable: false }),
      ] as never,
    })
    toggleIngredientRemoval(item, ingredient(KETCHUP, 'Ketchup'), 'Extras')

    const model = buildCustomizeModel(item, product(), catalog)

    expect(model.ingredients.map(i => [i.name, i.removed])).toEqual([
      ['Ketchup', true],
      ['Rote Zwiebel', false],
    ])
    expect(model.summary).toBe('ohne Ketchup')
  })

  it('zählt Optionen je Gruppe und sperrt Plus bei maxSelections', () => {
    const item = line({
      modifiers: [
        { _id: 'cheese', name: 'Käse', amount: 1, price: 0.5 },
        { _id: 'bacon', name: 'Bacon', amount: 1, price: 1.5 },
      ] as never,
    })
    const model = buildCustomizeModel(item, product({ optionGroups: [extrasGroup()] } as never), catalog)

    expect(model.groups).toHaveLength(1)
    expect(model.groups[0]).toEqual(expect.objectContaining({ selected: 2, maxSelections: 2, full: true, missing: 0 }))
    expect(model.summary).toBe('Käse · Bacon')
  })

  it('maxSelections 0 heißt unbegrenzt', () => {
    const item = line({ modifiers: [{ _id: 'cheese', name: 'Käse', amount: 5, price: 0.5 }] as never })
    const group = buildCustomizeModel(
      item,
      product({ optionGroups: [extrasGroup({ maxSelections: 0 })] } as never),
      catalog,
    ).groups[0]
    expect(group.maxSelections).toBeNull()
    expect(group.full).toBe(false)
  })

  it('sperrt „Fertig", solange eine Pflichtgruppe unter minSelections liegt', () => {
    const p = product({ optionGroups: [extrasGroup({ minSelections: 1 })] } as never)
    const empty = buildCustomizeModel(line(), p, catalog)
    expect(empty.canFinish).toBe(false)
    expect(empty.groups[0].missing).toBe(1)

    const filled = buildCustomizeModel(
      line({ modifiers: [{ _id: 'cheese', name: 'Käse', amount: 1, price: 0.5 }] as never }),
      p,
      catalog,
    )
    expect(filled.canFinish).toBe(true)
  })

  it('zählt Bestands-Marker mit amount −1 nicht als Auswahl', () => {
    const item = line({ modifiers: [{ _id: 'cheese', name: 'Käse', amount: -1, price: 0.5 }] as never })
    const model = buildCustomizeModel(item, product({ optionGroups: [extrasGroup()] } as never), catalog)
    expect(model.groups[0].options.find(o => o.productId === 'cheese')?.amount).toBe(0)
    expect(model.summary).toBe('')
  })

  it('markiert Nicht-Modifier, statt sie stumm wegzulassen', () => {
    const model = buildCustomizeModel(
      line(),
      product({
        optionGroups: [extrasGroup({ options: [{ productId: 'fries' }, { productId: 'gibt-es-nicht' }] })],
      } as never),
      catalog,
    )
    expect(model.groups[0].options).toEqual([
      { productId: 'fries', name: 'Pommes', price: 3, amount: 0, isModifier: false },
    ])
  })
})
