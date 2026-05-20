import { describe, it, expect } from 'vitest'

import type { Order } from '@panary/orders/domain'
import {
  computeCogs,
  versionedRecipeKey,
  type IngredientPricingMap,
  type RecipeIngredientMap,
  type RecipeIngredientResolution,
} from './cogs'
import { makeOrder, resetIds } from './fixtures/orders.fixtures'

/**
 * REV-2: Historische Recipe-Versions-Aufloesung im COGS.
 *
 * Szenario: Rezept "Pizza" hatte am Verkaufstag Version 1 mit 200g Mehl,
 * wurde aber zwischen Verkauf und Tagesabschluss auf Version 2 umgestellt
 * (300g Mehl). Bei Order-Replay (Re-Aggregation) MUSS Version 1 verwendet
 * werden, sonst wird der Verbrauch falsch berechnet.
 */

const RECIPE_PIZZA = '00000000-0000-7000-8000-bbbbbbbbbb01'
const FLOUR = '00000000-0000-7000-8000-aaaaaaaaaa01'

function buildVersionedRecipeMap(): RecipeIngredientMap {
  const v1: RecipeIngredientResolution[] = [
    { ingredientId: FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.2, unit: 'kg', ingredientVersion: 1 },
  ]
  const v2: RecipeIngredientResolution[] = [
    { ingredientId: FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.3, unit: 'kg', ingredientVersion: 1 },
  ]
  return new Map<string, RecipeIngredientResolution[]>([
    [versionedRecipeKey(RECIPE_PIZZA, 1), v1],
    [versionedRecipeKey(RECIPE_PIZZA, 2), v2],
    [RECIPE_PIZZA, v2], // Default = currentVersion = v2
  ])
}

function buildPricing(): IngredientPricingMap {
  return new Map([[FLOUR, 150]])
}

function makePizzaOrder(opts: { amount: number; recipeVersion?: number }): Order {
  return makeOrder({
    lineItems: [
      {
        _id: 'li-pizza-' + Math.random(),
        externalId: 'ext-pizza',
        amount: opts.amount,
        name: 'Pizza',
        price: 9.5,
        recipeReferences: [
          {
            externalId: RECIPE_PIZZA,
            quantity: 1,
            version: opts.recipeVersion,
          } as never,
        ],
        ingredientReferences: [],
        taxInside: 0,
        taxOutside: 0,
        topic: '',
        productGroupExternalId: 'pg-pizza',
        bundleNumber: null,
        modifiers: [],
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
      },
    ],
  })
}

describe('cogs — Recipe-Versionierung (REV-2)', () => {
  it('Order mit recipeReferences[i].version=1 nutzt historische v1-Mengen', () => {
    resetIds()
    const order = makePizzaOrder({ amount: 5, recipeVersion: 1 })
    const cogs = computeCogs([order], buildPricing(), buildVersionedRecipeMap())
    // 5 Pizzen × 0.2 kg Mehl (v1) = 1.0 kg
    expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(1.0, 9)
  })

  it('Order ohne version-Feld fällt auf aktuelle Version zurück', () => {
    resetIds()
    const order = makePizzaOrder({ amount: 5 })
    const cogs = computeCogs([order], buildPricing(), buildVersionedRecipeMap())
    // 5 Pizzen × 0.3 kg Mehl (current = v2) = 1.5 kg
    expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(1.5, 9)
  })

  it('Mixed: zwei Orders, eine v1 + eine v2, summieren korrekt', () => {
    resetIds()
    const orders = [
      makePizzaOrder({ amount: 2, recipeVersion: 1 }), // 2 × 0.2 = 0.4
      makePizzaOrder({ amount: 3, recipeVersion: 2 }), // 3 × 0.3 = 0.9
    ]
    const cogs = computeCogs(orders, buildPricing(), buildVersionedRecipeMap())
    expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.4 + 0.9, 9)
  })

  it('Order mit unbekannter version=99 fällt auf currentVersion zurück', () => {
    resetIds()
    const order = makePizzaOrder({ amount: 1, recipeVersion: 99 })
    const cogs = computeCogs([order], buildPricing(), buildVersionedRecipeMap())
    // Fallback auf v2 (current) = 0.3 kg
    expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.3, 9)
  })
})
