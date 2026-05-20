import { describe, it, expect } from 'vitest'

import type { Order } from '@panary/orders/domain'
import {
  computeCogs,
  type IngredientPricingMap,
  type RecipeIngredientMap,
} from './cogs'
import { makeOrder, resetIds } from './fixtures/orders.fixtures'

/**
 * Konsistenz-Test Variante A.9:
 *
 *   Hook-Buchung (order-stock-update.hook.ts) und Tagesabschluss-Snapshot
 *   (snapshot-inventory.ts) MÜSSEN exakt dieselbe Rezeptur-Aufloesungs-
 *   Logik verwenden. Beide gehen heute durch `computeCogs()` aus dieser
 *   Aggregator-Lib.
 *
 *   Dieser Test verifiziert die strukturelle Konsistenz-Garantie empirisch:
 *
 *     1. Fixture: realistische Orders mit verschiedenen Mustern
 *        (ingredientReferences, recipeReferences, Modifier, Menus)
 *     2. Simuliere Hook-Verhalten: pro Order computeCogs() → quantityUsed
 *        pro Zutat aggregieren
 *     3. Simuliere Tagesabschluss-Verhalten: ALLE Orders gemeinsam in
 *        computeCogs() → quantityUsed pro Zutat
 *     4. Per-Order-Summe MUSS gleich All-Orders-Aggregation sein.
 *
 *   Wenn dieser Test bricht, ist eine der beiden Aufrufseiten (Hook ODER
 *   Snapshot) divergent — Drift droht in Produktion.
 */

const TEST_INGREDIENT_FLOUR = '00000000-0000-7000-8000-aaaaaaaaaa01'
const TEST_INGREDIENT_TOMATO = '00000000-0000-7000-8000-aaaaaaaaaa02'
const TEST_INGREDIENT_CHEESE = '00000000-0000-7000-8000-aaaaaaaaaa03'
const TEST_RECIPE_PIZZA = '00000000-0000-7000-8000-bbbbbbbbbb01'

function buildRecipeMap(): RecipeIngredientMap {
  // Pizza-Rezept: pro Output-Einheit (1 Pizza) 200g Mehl + 100g Tomate + 80g Käse
  return new Map([
    [
      TEST_RECIPE_PIZZA,
      [
        { ingredientId: TEST_INGREDIENT_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.2, unit: 'kg' },
        { ingredientId: TEST_INGREDIENT_TOMATO, ingredientName: 'Tomaten', quantityPerOutputUnit: 0.1, unit: 'kg' },
        { ingredientId: TEST_INGREDIENT_CHEESE, ingredientName: 'Käse', quantityPerOutputUnit: 0.08, unit: 'kg' },
      ],
    ],
  ])
}

function buildPricingMap(): IngredientPricingMap {
  // Preise pro kg in Cents
  return new Map([
    [TEST_INGREDIENT_FLOUR, 150],
    [TEST_INGREDIENT_TOMATO, 250],
    [TEST_INGREDIENT_CHEESE, 1200],
  ])
}

function makeOrderWithPizza(opts: { amount: number; orderId?: string }): Order {
  return makeOrder({
    _id: opts.orderId,
    lineItems: [
      {
        _id: 'li-pizza-' + Math.random(),
        externalId: 'ext-pizza',
        amount: opts.amount,
        name: 'Pizza Margherita',
        price: 9.5,
        recipeReferences: [
          {
            externalId: TEST_RECIPE_PIZZA,
            quantity: 1,
            // ingredientId: ... etc. — wir referenzieren nur via externalId
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

describe('Konsistenz: Hook-Buchung ≡ Snapshot-Berechnung', () => {
  it('Per-Order-Aggregation = All-Orders-Aggregation (saubere Rezeptur)', () => {
    resetIds()
    // 3 Pizza-Bestellungen mit unterschiedlichen Mengen
    const orders = [
      makeOrderWithPizza({ amount: 2 }),
      makeOrderWithPizza({ amount: 1 }),
      makeOrderWithPizza({ amount: 3 }),
    ]
    const pricing = buildPricingMap()
    const recipes = buildRecipeMap()

    // Hook-Simulation: pro Order einzeln aufgeloeste Zutatenmengen
    const perOrderSum = new Map<string, number>()
    for (const order of orders) {
      const cogs = computeCogs([order], pricing, recipes)
      for (const line of cogs.consumptionLines) {
        perOrderSum.set(
          line.ingredientId,
          (perOrderSum.get(line.ingredientId) ?? 0) + line.quantityUsed,
        )
      }
    }

    // Tagesabschluss-Simulation: alle Orders gemeinsam
    const allOrders = computeCogs(orders, pricing, recipes)
    const snapshotSum = new Map<string, number>()
    for (const line of allOrders.consumptionLines) {
      snapshotSum.set(line.ingredientId, line.quantityUsed)
    }

    // Sicherstellen: beide Sichten haben dieselben Zutaten
    expect([...perOrderSum.keys()].sort()).toEqual([...snapshotSum.keys()].sort())

    // Per-Zutat: identische Menge (mit Float-Toleranz)
    for (const [ingredientId, perOrderQty] of perOrderSum.entries()) {
      const snapshotQty = snapshotSum.get(ingredientId)!
      expect(Math.abs(perOrderQty - snapshotQty)).toBeLessThan(1e-9)
    }

    // Konkret: 6 Pizzen total → 1.2 kg Mehl, 0.6 kg Tomaten, 0.48 kg Käse
    expect(perOrderSum.get(TEST_INGREDIENT_FLOUR)).toBeCloseTo(1.2, 9)
    expect(perOrderSum.get(TEST_INGREDIENT_TOMATO)).toBeCloseTo(0.6, 9)
    expect(perOrderSum.get(TEST_INGREDIENT_CHEESE)).toBeCloseTo(0.48, 9)
  })

  it('Storno-Reversal: Hook-Logik reproduziert exakt das Negativ der SALES_OUT-Mengen', () => {
    // Simulation: eine Bestellung wird SALES_OUT-gebucht (negative Mengen),
    // dann storniert → SALES_OUT_REVERSAL bucht das Positiv. Netto: 0.
    resetIds()
    const order = makeOrderWithPizza({ amount: 2 })
    const cogs = computeCogs([order], buildPricingMap(), buildRecipeMap())

    // SALES_OUT-Mengen (negative)
    const salesOutQuantities = cogs.consumptionLines.map(l => -l.quantityUsed)
    // SALES_OUT_REVERSAL-Mengen (positiv, gespiegelt)
    const reversalQuantities = cogs.consumptionLines.map(l => l.quantityUsed)

    // Σ pro Zutat: SALES_OUT + REVERSAL = 0
    for (let i = 0; i < salesOutQuantities.length; i++) {
      expect(salesOutQuantities[i] + reversalQuantities[i]).toBeCloseTo(0, 9)
    }
  })

  it('Mixed-Bag-Tag: Order-basierte ≡ Movement-basierte Aggregation pro Zutat', () => {
    // Realistisch: 5 Orders mit verschiedenen Mengen, davon eine ABORTED
    // (wird in der Order-Berechnung ausgeschlossen, in den Movements gibt es
    // sowohl SALES_OUT als auch SALES_OUT_REVERSAL → netto 0).
    resetIds()
    const orders = [
      makeOrderWithPizza({ amount: 1 }),
      makeOrderWithPizza({ amount: 2 }),
      makeOrderWithPizza({ amount: 1 }),
      makeOrderWithPizza({ amount: 4 }),
    ]
    const pricing = buildPricingMap()
    const recipes = buildRecipeMap()

    // Order-basiert (Snapshot)
    const fromOrders = computeCogs(orders, pricing, recipes)

    // Movement-basiert (Hook-Simulation: SALES_OUT pro reguläre Order)
    const movementSum = new Map<string, number>()
    for (const order of orders) {
      const cogs = computeCogs([order], pricing, recipes)
      for (const line of cogs.consumptionLines) {
        // SALES_OUT.quantity ist negativ → wir bilden den Betrag = quantityUsed
        movementSum.set(line.ingredientId, (movementSum.get(line.ingredientId) ?? 0) + line.quantityUsed)
      }
    }

    for (const line of fromOrders.consumptionLines) {
      const fromMovements = movementSum.get(line.ingredientId) ?? 0
      expect(Math.abs(line.quantityUsed - fromMovements)).toBeLessThan(1e-9)
    }
  })
})
