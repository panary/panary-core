import { describe, it, expect, beforeEach } from 'vitest'

import type { Order, OrderLineItem } from '@panary/orders/domain'
import { DineLocation, OrderStatus, PaymentState } from '@panary/orders/domain'
import {
  computeCogs,
  explodeOrderConsumption,
  priceConsumptionLines,
  versionedRecipeKey,
  type IngredientPricingMap,
  type RecipeIngredientMap,
  type RecipeIngredientResolution,
} from './cogs'
import { makeOrder, resetIds } from './fixtures/orders.fixtures'

/**
 * Verbrauchsmathematik (COGS) — die Single-Source-of-Truth fuer
 * "ein Verkauf verbraucht welche Zutaten in welcher Menge".
 *
 * Sowohl der Live-Stock-Buchungs-Hook als auch der Tagesabschluss-Report
 * rufen `computeCogs()` auf — diese Spec sperrt die Mathematik fest.
 *
 * Konvention der Tests (an cogs-versioning.spec.ts angelehnt):
 *   - LineItems werden teilweise mit `as never` gecastet, weil nur die von
 *     computeCogs gelesenen Felder relevant sind (amount, modifiers,
 *     menuDrink, menuSideDish, ingredientReferences, recipeReferences).
 *   - IDs sind feste uuid-aehnliche Strings, damit die deterministische
 *     Sortierung von `pricedLines` testbar ist.
 */

// Feste IDs — bewusst so gewaehlt, dass die alphabetische Sortierung
// (pricedLines) bekannt ist: A01 < A02 < A03 < B01.
const ING_FLOUR = '00000000-0000-7000-8000-aaaaaaaaaa01'
const ING_TOMATO = '00000000-0000-7000-8000-aaaaaaaaaa02'
const ING_CHEESE = '00000000-0000-7000-8000-aaaaaaaaaa03'
const ING_SAUCE = '00000000-0000-7000-8000-aaaaaaaaaa04'
const ING_SYRUP = '00000000-0000-7000-8000-aaaaaaaaaa05'
const RECIPE_PIZZA = '00000000-0000-7000-8000-bbbbbbbbbb01'
const RECIPE_DRINK = '00000000-0000-7000-8000-bbbbbbbbbb02'
const RECIPE_MISSING = '00000000-0000-7000-8000-bbbbbbbbbb99'

// Helper: baut ein vollstaendiges LineItem; ueberschreibbare Felder werden
// gemerged. Nur die von computeCogs gelesenen Felder sind hier relevant.
function makeLineItem(partial: Partial<OrderLineItem> & { amount: number }): OrderLineItem {
  return {
    _id: '00000000-0000-7000-8000-cccccccccc01',
    externalId: '00000000-0000-7000-8000-dddddddddd01',
    name: 'Artikel',
    price: 1,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 0,
    taxOutside: 0,
    topic: '',
    productGroupExternalId: '00000000-0000-7000-8000-eeeeeeeeee01',
    bundleNumber: null,
    modifiers: [],
    isMenu: false,
    menuDrink: null,
    menuSideDish: null,
    ...partial,
  } as OrderLineItem
}

// Helper: direkte Zutatenreferenz im Shape, den accumulateLineItem liest
// (ingredientId | externalId, quantity, unit, name).
function directIngredient(ingredientId: string, quantity: number, unit = 'g', name = 'Zutat') {
  return { ingredientId, quantity, unit, name } as never
}

// Helper: Rezeptreferenz im Shape, den accumulateLineItem liest
// (externalId | recipeId, quantity?, version?).
function recipeRef(externalId: string, opts: { quantity?: number; version?: number } = {}) {
  return { externalId, quantity: opts.quantity, version: opts.version } as never
}

function makeRegularOrder(lineItems: OrderLineItem[]): Order {
  return makeOrder({ lineItems })
}

describe('computeCogs — Verbrauchsmathematik', () => {
  beforeEach(resetIds)

  describe('Direkte Zutatenreferenzen (ingredientReferences)', () => {
    it('Einzelposten: amount × quantity (2 × 50 g = 100 g) korrekt bepreist', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 2, ingredientReferences: [directIngredient(ING_FLOUR, 50)] }),
      ])
      // Preis 3 ct/g
      const pricing: IngredientPricingMap = new Map([[ING_FLOUR, 3]])
      const cogs = computeCogs([order], pricing, new Map())

      expect(cogs.consumptionLines).toHaveLength(1)
      expect(cogs.consumptionLines[0].ingredientId).toBe(ING_FLOUR)
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(100, 9)
      // 3 ct × 100 = 300 ct
      expect(cogs.pricedLines[0].totalCostCents).toBe(300)
      expect(cogs.totalFoodCostCents).toBe(300)
    })

    it('Mehrere direkte Zutaten in einem LineItem werden alle erfasst', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 1,
          ingredientReferences: [directIngredient(ING_FLOUR, 200), directIngredient(ING_CHEESE, 80)],
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      const byId = new Map(cogs.consumptionLines.map(l => [l.ingredientId, l.quantityUsed]))
      expect(byId.get(ING_FLOUR)).toBeCloseTo(200, 9)
      expect(byId.get(ING_CHEESE)).toBeCloseTo(80, 9)
    })

    it('Referenz ohne id (weder ingredientId noch externalId) wird uebersprungen', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 1, ingredientReferences: [{ quantity: 99, unit: 'g', name: 'X' } as never] }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })

    it('Referenz nur mit externalId (kein ingredientId) nutzt externalId als Key', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 3, ingredientReferences: [{ externalId: ING_TOMATO, quantity: 10, unit: 'g' } as never] }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines[0].ingredientId).toBe(ING_TOMATO)
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(30, 9)
    })
  })

  describe('Rezeptreferenzen (recipeReferences)', () => {
    function pizzaRecipeMap(quantityPerOutputUnit = 0.05): RecipeIngredientMap {
      const ings: RecipeIngredientResolution[] = [
        { ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit, unit: 'kg' },
      ]
      return new Map([[RECIPE_PIZZA, ings]])
    }

    it('quantityPerOutputUnit × refQuantity × amount (Normalisierung steckt in der Map)', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 4, recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 1 })] }),
      ])
      const cogs = computeCogs([order], new Map(), pizzaRecipeMap(0.05))
      // 0.05 × 1 × 4 = 0.2
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.2, 9)
    })

    it('refQuantity > 1 multipliziert zusaetzlich', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 2, recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 3 })] }),
      ])
      const cogs = computeCogs([order], new Map(), pizzaRecipeMap(0.05))
      // 0.05 × 3 × 2 = 0.3
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.3, 9)
    })

    it('refQuantity fehlt → default 1', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 5, recipeReferences: [recipeRef(RECIPE_PIZZA)] }),
      ])
      const cogs = computeCogs([order], new Map(), pizzaRecipeMap(0.05))
      // 0.05 × 1 (default) × 5 = 0.25
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.25, 9)
    })

    it('Versionierter Lookup: version=2 nutzt r1:v2, ohne version faellt auf r1 zurueck', () => {
      const v2: RecipeIngredientResolution[] = [
        { ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.3, unit: 'kg' },
      ]
      const current: RecipeIngredientResolution[] = [
        { ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.2, unit: 'kg' },
      ]
      const map: RecipeIngredientMap = new Map([
        [RECIPE_PIZZA, current],
        [versionedRecipeKey(RECIPE_PIZZA, 2), v2],
      ])

      const versioned = computeCogs(
        [makeRegularOrder([makeLineItem({ amount: 1, recipeReferences: [recipeRef(RECIPE_PIZZA, { version: 2 })] })])],
        new Map(),
        map,
      )
      expect(versioned.consumptionLines[0].quantityUsed).toBeCloseTo(0.3, 9)

      const fallback = computeCogs(
        [makeRegularOrder([makeLineItem({ amount: 1, recipeReferences: [recipeRef(RECIPE_PIZZA)] })])],
        new Map(),
        map,
      )
      expect(fallback.consumptionLines[0].quantityUsed).toBeCloseTo(0.2, 9)
    })

    it('VERHALTEN: fehlendes Rezept liefert "stillen 0"-Verbrauch (kein Throw, Zutat fehlt)', () => {
      // Dokumentiert bewusst die Silent-Skip-Semantik: ist ein referenziertes
      // Rezept nicht in der Map (auch nicht versioniert), traegt es NICHTS bei.
      // Das ist eine scharfe Kante — ein fehlerhafter Recipe-Snapshot wuerde
      // den Materialverbrauch lautlos unterschaetzen.
      const order = makeRegularOrder([
        makeLineItem({ amount: 10, recipeReferences: [recipeRef(RECIPE_MISSING)] }),
      ])
      const cogs = computeCogs([order], new Map(), pizzaRecipeMap())
      expect(cogs.consumptionLines).toHaveLength(0)
      expect(cogs.totalFoodCostCents).toBe(0)
    })

    it('Rezeptreferenz ohne id (weder externalId noch recipeId) wird uebersprungen', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 1, recipeReferences: [{ quantity: 1 } as never] }),
      ])
      const cogs = computeCogs([order], new Map(), pizzaRecipeMap())
      expect(cogs.consumptionLines).toHaveLength(0)
    })
  })

  describe('Modifier / Extras (multiplikativ)', () => {
    it('item.amount 2 × modifier.amount 3 × ingredient qty 10 = 60', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 2,
          modifiers: [
            makeLineItem({ amount: 3, ingredientReferences: [directIngredient(ING_SAUCE, 10)] }),
          ],
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines[0].ingredientId).toBe(ING_SAUCE)
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(60, 9)
    })

    it('Modifier kann selbst eine Rezeptreferenz tragen (aufgeloest ueber den Modifier)', () => {
      const map: RecipeIngredientMap = new Map([
        [RECIPE_PIZZA, [{ ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.1, unit: 'kg' }]],
      ])
      const order = makeRegularOrder([
        makeLineItem({
          amount: 2,
          modifiers: [makeLineItem({ amount: 3, recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 1 })] })],
        }),
      ])
      const cogs = computeCogs([order], new Map(), map)
      // 0.1 × 1 × (2 × 3) = 0.6
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.6, 9)
    })
  })

  describe('Menue-Bestandteile (menuDrink / menuSideDish)', () => {
    it('menuDrink traegt via item.amount × menuDrink.amount bei', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 2,
          menuDrink: makeLineItem({ amount: 1, ingredientReferences: [directIngredient(ING_SYRUP, 25)] }),
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      // 25 × (2 × 1) = 50
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(50, 9)
    })

    it('menuSideDish traegt via item.amount × menuSideDish.amount bei', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 3,
          menuSideDish: makeLineItem({ amount: 2, ingredientReferences: [directIngredient(ING_TOMATO, 5)] }),
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      // 5 × (3 × 2) = 30
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(30, 9)
    })
  })

  describe('Verschachtelte Kombination (direkt + Rezept + Modifier(Rezept) + menuDrink)', () => {
    it('aggregiert die Mengen pro Zutat ueber alle Pfade korrekt', () => {
      const map: RecipeIngredientMap = new Map([
        // Rezept des LineItems → Mehl
        [RECIPE_PIZZA, [{ ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.1, unit: 'kg' }]],
        // Rezept des Modifiers → Tomate
        [RECIPE_DRINK, [{ ingredientId: ING_TOMATO, ingredientName: 'Tomate', quantityPerOutputUnit: 0.02, unit: 'kg' }]],
      ])
      const order = makeRegularOrder([
        makeLineItem({
          amount: 2,
          // direkte Zutat: 30 × 2 = 60 (Kaese)
          ingredientReferences: [directIngredient(ING_CHEESE, 30)],
          // LineItem-Rezept: 0.1 × 1 × 2 = 0.2 (Mehl)
          recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 1 })],
          modifiers: [
            // Modifier-Rezept: 0.02 × 1 × (2 × 3) = 0.12 (Tomate)
            makeLineItem({ amount: 3, recipeReferences: [recipeRef(RECIPE_DRINK, { quantity: 1 })] }),
          ],
          // menuDrink direkte Zutat: 5 × (2 × 1) = 10 (Sirup)
          menuDrink: makeLineItem({ amount: 1, ingredientReferences: [directIngredient(ING_SYRUP, 5)] }),
        }),
      ])
      const cogs = computeCogs([order], new Map(), map)
      const byId = new Map(cogs.consumptionLines.map(l => [l.ingredientId, l.quantityUsed]))
      expect(byId.get(ING_CHEESE)).toBeCloseTo(60, 9)
      expect(byId.get(ING_FLOUR)).toBeCloseTo(0.2, 9)
      expect(byId.get(ING_TOMATO)).toBeCloseTo(0.12, 9)
      expect(byId.get(ING_SYRUP)).toBeCloseTo(10, 9)
    })
  })

  describe('Ausschluss nicht-regulaerer Bestellungen (isRegularSale)', () => {
    it('Storno (cancellation:true) traegt nichts bei', () => {
      const order = makeOrder({
        cancellation: true,
        lineItems: [makeLineItem({ amount: 5, ingredientReferences: [directIngredient(ING_FLOUR, 100)] })],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })

    it('Storno via Status ABORTED traegt nichts bei', () => {
      const order = makeOrder({
        status: OrderStatus.ABORTED,
        lineItems: [makeLineItem({ amount: 5, ingredientReferences: [directIngredient(ING_FLOUR, 100)] })],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })

    it('VERHALTEN: Personalessen (staffPaymentInfo) wird NICHT mitgezaehlt', () => {
      // Dokumentiert: Mitarbeiter-Verpflegung fliesst nicht in COGS — der
      // dafuer verbrauchte Wareneinsatz muss separat als Write-Off erfasst
      // werden, sonst fehlt er in der Bestandsbilanz.
      const order = makeOrder({
        staffPaymentInfo: { paid: false },
        lineItems: [makeLineItem({ amount: 5, ingredientReferences: [directIngredient(ING_FLOUR, 100)] })],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })

    it('VERHALTEN: Firmenkundenessen (customerPaymentInfo) wird NICHT mitgezaehlt', () => {
      const order = makeOrder({
        customerPaymentInfo: { paid: true },
        lineItems: [makeLineItem({ amount: 5, ingredientReferences: [directIngredient(ING_FLOUR, 100)] })],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })

    it('Refund (payment.state REFUNDED) traegt nichts bei', () => {
      const order = makeOrder({
        paymentState: PaymentState.REFUNDED,
        lineItems: [makeLineItem({ amount: 5, ingredientReferences: [directIngredient(ING_FLOUR, 100)] })],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })
  })

  describe('Aggregation & Pricing', () => {
    it('Mehrere Orders summieren dieselbe Zutat', () => {
      const orders = [
        makeRegularOrder([makeLineItem({ amount: 2, ingredientReferences: [directIngredient(ING_FLOUR, 50)] })]),
        makeRegularOrder([makeLineItem({ amount: 1, ingredientReferences: [directIngredient(ING_FLOUR, 30)] })]),
      ]
      const cogs = computeCogs(orders, new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(1)
      // 2×50 + 1×30 = 130
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(130, 9)
    })

    it('pricedLines sind nach ingredientId aufsteigend sortiert (Determinismus)', () => {
      // Reihenfolge im LineItem absichtlich verkehrt herum.
      const order = makeRegularOrder([
        makeLineItem({
          amount: 1,
          ingredientReferences: [
            directIngredient(ING_CHEESE, 1),
            directIngredient(ING_FLOUR, 1),
            directIngredient(ING_TOMATO, 1),
          ],
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      const ids = cogs.pricedLines.map(l => l.ingredientId)
      expect(ids).toEqual([...ids].sort())
      expect(ids).toEqual([ING_FLOUR, ING_TOMATO, ING_CHEESE])
    })

    it('Fehlender Preis → priceCents 0, Menge wird gezaehlt, totalCost 0', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 2, ingredientReferences: [directIngredient(ING_FLOUR, 40)] }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.pricedLines[0].quantityUsed).toBeCloseTo(80, 9)
      expect(cogs.pricedLines[0].baseUnitPriceCents).toBe(0)
      expect(cogs.pricedLines[0].totalCostCents).toBe(0)
      expect(cogs.totalFoodCostCents).toBe(0)
    })

    it('totalFoodCostCents = Σ totalCostCents ueber alle Zutaten', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 1,
          ingredientReferences: [directIngredient(ING_FLOUR, 100), directIngredient(ING_CHEESE, 10)],
        }),
      ])
      const pricing: IngredientPricingMap = new Map([
        [ING_FLOUR, 2], // 2 × 100 = 200
        [ING_CHEESE, 5], // 5 × 10 = 50
      ])
      const cogs = computeCogs([order], pricing, new Map())
      expect(cogs.totalFoodCostCents).toBe(250)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Embedded-Snapshot-Explosion (Weg B): Verbrauch aus dem in der Order
  // gespeicherten `recipeReference.recipeIngredients[]` + `recipeBaseQuantity`.
  // RAW-Konvention: quantity ist roh; Faktor = refQuantity / recipeBaseQuantity.
  // ────────────────────────────────────────────────────────────────────────
  describe('Embedded-Snapshot-Explosion (recipeReference.recipeIngredients)', () => {
    // Helper: Rezept-Referenz MIT eingebettetem Snapshot.
    function embeddedRecipeRef(opts: {
      externalId: string
      quantity: number
      recipeBaseQuantity: number
      recipeIngredients: Array<{
        externalId?: string
        ingredientId?: string
        quantity: number
        unit?: string
        version?: number
        onlyOutsideConsumption?: boolean
        ingredientName?: string
      }>
      version?: number
    }) {
      return {
        externalId: opts.externalId,
        version: opts.version,
        quantity: opts.quantity,
        recipeBaseQuantity: opts.recipeBaseQuantity,
        recipeIngredients: opts.recipeIngredients,
      } as never
    }

    it('Faktor = refQuantity / recipeBaseQuantity auf rohe Zutatenmenge', () => {
      // Rezept "Teig": baseQuantity 10 (kg Output), Zutat Mehl roh 6000 g.
      // Produkt nutzt refQuantity 0.5 kg davon, amount 2.
      // → 6000 × (0.5/10) × 2 = 600
      const order = makeRegularOrder([
        makeLineItem({
          amount: 2,
          recipeReferences: [
            embeddedRecipeRef({
              externalId: RECIPE_PIZZA,
              quantity: 0.5,
              recipeBaseQuantity: 10,
              recipeIngredients: [{ externalId: ING_FLOUR, quantity: 6000, unit: 'g' }],
            }),
          ],
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines[0].ingredientId).toBe(ING_FLOUR)
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(600, 9)
      expect(cogs.unresolvedRecipes).toHaveLength(0)
    })

    it('Embedded-Snapshot hat Vorrang vor der externen Map', () => {
      // Map sagt 0.2/Output, Embedded sagt 5 roh bei baseQuantity 10 → 0.5/Output.
      const map: RecipeIngredientMap = new Map([
        [RECIPE_PIZZA, [{ ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.2, unit: 'kg' }]],
      ])
      const order = makeRegularOrder([
        makeLineItem({
          amount: 1,
          recipeReferences: [
            embeddedRecipeRef({
              externalId: RECIPE_PIZZA,
              quantity: 1,
              recipeBaseQuantity: 10,
              recipeIngredients: [{ externalId: ING_FLOUR, quantity: 5, unit: 'kg' }],
            }),
          ],
        }),
      ])
      const cogs = computeCogs([order], new Map(), map)
      // Embedded: 5 × (1/10) × 1 = 0.5 (NICHT 0.2 aus der Map)
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.5, 9)
    })

    it('recipeBaseQuantity 0/fehlend → Faktor = refQuantity (Division durch 1)', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 1,
          recipeReferences: [
            embeddedRecipeRef({
              externalId: RECIPE_PIZZA,
              quantity: 3,
              recipeBaseQuantity: 0,
              recipeIngredients: [{ externalId: ING_FLOUR, quantity: 2, unit: 'kg' }],
            }),
          ],
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      // 2 × (3/1) × 1 = 6
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(6, 9)
    })

    it('mehrere Zutaten im eingebetteten Snapshot werden alle aufgelöst', () => {
      const order = makeRegularOrder([
        makeLineItem({
          amount: 1,
          recipeReferences: [
            embeddedRecipeRef({
              externalId: RECIPE_PIZZA,
              quantity: 2,
              recipeBaseQuantity: 4,
              recipeIngredients: [
                { externalId: ING_FLOUR, quantity: 8, unit: 'kg' },
                { externalId: ING_CHEESE, quantity: 2, unit: 'kg' },
              ],
            }),
          ],
        }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      const byId = new Map(cogs.consumptionLines.map(l => [l.ingredientId, l.quantityUsed]))
      // Faktor 2/4 = 0.5: Mehl 8×0.5=4, Käse 2×0.5=1
      expect(byId.get(ING_FLOUR)).toBeCloseTo(4, 9)
      expect(byId.get(ING_CHEESE)).toBeCloseTo(1, 9)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // onlyOutsideConsumption: Zutat zählt nur Außer-Haus (dineLocation ≠ DINE_IN)
  // ────────────────────────────────────────────────────────────────────────
  describe('onlyOutsideConsumption (Außer-Haus-only Zutaten)', () => {
    it('direkte Zutat mit Flag wird bei DINE_IN übersprungen', () => {
      const order = makeOrder({
        dineLocation: DineLocation.DINE_IN,
        lineItems: [
          makeLineItem({
            amount: 1,
            ingredientReferences: [
              { externalId: ING_FLOUR, quantity: 100, unit: 'g', onlyOutsideConsumption: true } as never,
            ],
          }),
        ],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
    })

    it('direkte Zutat mit Flag wird bei TAKE_OUT gezählt', () => {
      const order = makeOrder({
        dineLocation: DineLocation.TAKE_OUT,
        lineItems: [
          makeLineItem({
            amount: 2,
            ingredientReferences: [
              { externalId: ING_FLOUR, quantity: 100, unit: 'g', onlyOutsideConsumption: true } as never,
            ],
          }),
        ],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(200, 9)
    })

    it('eingebettete Rezept-Zutat mit Flag wird bei DINE_IN übersprungen', () => {
      const order = makeOrder({
        dineLocation: DineLocation.DINE_IN,
        lineItems: [
          makeLineItem({
            amount: 1,
            recipeReferences: [
              {
                externalId: RECIPE_PIZZA,
                quantity: 1,
                recipeBaseQuantity: 1,
                recipeIngredients: [
                  { externalId: ING_FLOUR, quantity: 5, unit: 'kg' },
                  { externalId: ING_SAUCE, quantity: 1, unit: 'kg', onlyOutsideConsumption: true },
                ],
              } as never,
            ],
          }),
        ],
      })
      const cogs = computeCogs([order], new Map(), new Map())
      const byId = new Map(cogs.consumptionLines.map(l => [l.ingredientId, l.quantityUsed]))
      expect(byId.get(ING_FLOUR)).toBeCloseTo(5, 9)
      expect(byId.has(ING_SAUCE)).toBe(false)
    })

    it('Map-Resolution mit Flag wird bei DINE_IN übersprungen', () => {
      const map: RecipeIngredientMap = new Map([
        [
          RECIPE_PIZZA,
          [
            { ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.1, unit: 'kg' },
            { ingredientId: ING_SAUCE, ingredientName: 'Tüte', quantityPerOutputUnit: 1, unit: 'piece', onlyOutsideConsumption: true },
          ],
        ],
      ])
      const order = makeOrder({
        dineLocation: DineLocation.DINE_IN,
        lineItems: [makeLineItem({ amount: 1, recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 1 })] })],
      })
      const cogs = computeCogs([order], new Map(), map)
      const byId = new Map(cogs.consumptionLines.map(l => [l.ingredientId, l.quantityUsed]))
      expect(byId.get(ING_FLOUR)).toBeCloseTo(0.1, 9)
      expect(byId.has(ING_SAUCE)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // unresolvedRecipes statt stillem 0
  // ────────────────────────────────────────────────────────────────────────
  describe('unresolvedRecipes (lautes Fehlersignal)', () => {
    it('fehlendes Rezept landet in unresolvedRecipes (mit Version)', () => {
      const order = makeRegularOrder([
        makeLineItem({ amount: 1, recipeReferences: [recipeRef(RECIPE_MISSING, { quantity: 1, version: 3 })] }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines).toHaveLength(0)
      expect(cogs.unresolvedRecipes).toEqual([{ recipeExternalId: RECIPE_MISSING, version: 3 }])
    })

    it('aufgelöstes (Map) Rezept erzeugt keinen unresolved-Eintrag', () => {
      const map: RecipeIngredientMap = new Map([
        [RECIPE_PIZZA, [{ ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.1, unit: 'kg' }]],
      ])
      const order = makeRegularOrder([
        makeLineItem({ amount: 1, recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 1 })] }),
      ])
      const cogs = computeCogs([order], new Map(), map)
      expect(cogs.unresolvedRecipes).toHaveLength(0)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // explodeOrderConsumption: Primitive OHNE Klassifizierungs-Filter (für Hook)
  // ────────────────────────────────────────────────────────────────────────
  describe('explodeOrderConsumption (ohne isRegularSale-Filter)', () => {
    it('zerlegt auch Personalessen (das computeCogs ausschließt)', () => {
      const order = makeOrder({
        staffPaymentInfo: { paid: false },
        lineItems: [makeLineItem({ amount: 3, ingredientReferences: [directIngredient(ING_FLOUR, 100)] })],
      })
      // computeCogs schließt es aus …
      expect(computeCogs([order], new Map(), new Map()).consumptionLines).toHaveLength(0)
      // … explodeOrderConsumption nicht (Material verlässt das Lager).
      const { lines } = explodeOrderConsumption(order, new Map())
      expect(lines).toHaveLength(1)
      expect(lines[0].quantityUsed).toBeCloseTo(300, 9)
    })

    it('aggregiert pro Order, meldet unresolvedRecipes', () => {
      const order = makeOrder({
        lineItems: [makeLineItem({ amount: 1, recipeReferences: [recipeRef(RECIPE_MISSING)] })],
      })
      const { lines, unresolvedRecipes } = explodeOrderConsumption(order, new Map())
      expect(lines).toHaveLength(0)
      expect(unresolvedRecipes[0].recipeExternalId).toBe(RECIPE_MISSING)
    })
  })

  describe('priceConsumptionLines', () => {
    it('aggregiert gleiche ingredientId, sortiert nach id, bewertet mit multiplyCents', () => {
      const { pricedLines, totalFoodCostCents } = priceConsumptionLines(
        [
          { ingredientId: ING_TOMATO, ingredientName: 'Tomate', unit: 'g', quantityUsed: 10 },
          { ingredientId: ING_FLOUR, ingredientName: 'Mehl', unit: 'g', quantityUsed: 100 },
          { ingredientId: ING_FLOUR, ingredientName: 'Mehl', unit: 'g', quantityUsed: 50 },
        ],
        new Map([
          [ING_FLOUR, 2],
          [ING_TOMATO, 5],
        ]),
      )
      // Mehl aggregiert 150 × 2 = 300, Tomate 10 × 5 = 50; Sortierung A01<A02
      expect(pricedLines.map(l => l.ingredientId)).toEqual([ING_FLOUR, ING_TOMATO])
      expect(pricedLines[0].quantityUsed).toBeCloseTo(150, 9)
      expect(pricedLines[0].totalCostCents).toBe(300)
      expect(totalFoodCostCents).toBe(350)
    })
  })

  describe('CHARAKTERISIERUNG: keine Einheiten-/Mengen-Umrechnung', () => {
    it('Rezept-Zutat in kg (qpou 0.05) wird NICHT konvertiert — rohe Multiplikation', () => {
      // ACHTUNG (bewusst gelockt): computeCogs wendet NIRGENDWO einen
      // conversionFactor an. quantityUsed ist exakt
      //   quantityPerOutputUnit × refQuantity × effectiveAmount.
      // Konsequenz fuer Aufrufer: Rezeptmengen MUESSEN bereits in der
      // Bestands-/Pricing-Basiseinheit der Zutat ausgedrueckt sein. Wer hier
      // z. B. 0.05 kg eintraegt, aber gegen einen Preis pro Gramm bepreist,
      // erhaelt einen um Faktor 1000 falschen Wert — die Lib korrigiert das
      // nicht. Dieser Test macht die Gefahr sichtbar und sperrt das Verhalten.
      const map: RecipeIngredientMap = new Map([
        [RECIPE_PIZZA, [{ ingredientId: ING_FLOUR, ingredientName: 'Mehl', quantityPerOutputUnit: 0.05, unit: 'kg' }]],
      ])
      const order = makeRegularOrder([
        makeLineItem({ amount: 7, recipeReferences: [recipeRef(RECIPE_PIZZA, { quantity: 1 })] }),
      ])
      const cogs = computeCogs([order], new Map(), map)
      // exakt 0.05 × 1 × 7 = 0.35 — kein g↔kg-Faktor
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(0.35, 9)
      expect(cogs.consumptionLines[0].unit).toBe('kg')
    })

    it('Direkte Zutat: usedQuantity ist exakt quantity × effectiveAmount (keine unit-Konvertierung)', () => {
      const order = makeRegularOrder([
        // unit 'kg' deklariert, aber quantity 250 — die Lib mischt das nicht,
        // sie multipliziert nur stumpf: 250 × 4 = 1000.
        makeLineItem({ amount: 4, ingredientReferences: [directIngredient(ING_FLOUR, 250, 'kg')] }),
      ])
      const cogs = computeCogs([order], new Map(), new Map())
      expect(cogs.consumptionLines[0].quantityUsed).toBeCloseTo(1000, 9)
      expect(cogs.consumptionLines[0].unit).toBe('kg')
    })
  })
})
