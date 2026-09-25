// Split-Konsistenz des Aggregators (#391).
//
// Der Split (#349, ADR 0049) laesst `lineItems` der Quelle unveraendert und
// haelt das Abgegebene in `splitOff` fest. Jede Mengen- oder Positionssumme
// muss deshalb ueber `effectiveLineItems` laufen — sonst zaehlt die gewanderte
// Menge bei Quelle UND Ziel. Die Invariante hier: Quelle + Ziel = Ursprung.
//
// Quelle und Ziel entstehen mit dem ECHTEN `planOrderSplit`, nicht mit einem
// von Hand gesetzten `splitOff` — sonst prueft die Spec ihre eigene Annahme
// darueber, wie ein Split aussieht.
//
// Mutationsprobe (2026-09-25, gemessen): In `explodeOrderConsumption`,
// `computeStats` und `getOrderGrossCents` je `effectiveLineItems(order)` zurueck
// auf `order.lineItems` gedreht -> jeweils die zugehoerigen Tests rot.

import { describe, expect, it } from 'vitest'

import { OrderStatus, planOrderSplit, type Order, type OrderLineItem } from '@panary/orders/domain'

import { explodeOrderConsumption, type ConsumptionLine } from './cogs'
import { makeOrder } from './fixtures/orders.fixtures'
import { getOrderGrossCents } from './order-total'
import { computeStats } from './stats'

const ING_FLOUR = '00000000-0000-7000-8000-00000000f001'
const ING_CHEESE = '00000000-0000-7000-8000-00000000f002'
const PRODUCT_ROLL = '00000000-0000-7000-8000-00000000a001'
const PRODUCT_PIZZA = '00000000-0000-7000-8000-00000000a002'
const PRODUCT_CHEESE = '00000000-0000-7000-8000-00000000a003'
const GROUP = '00000000-0000-7000-8000-00000000b001'

let idCounter = 0
const newId = () => `00000000-0000-7000-8000-${String(++idCounter).padStart(12, '0')}`

function ingredientRef(ingredientId: string, quantity: number) {
  return {
    externalId: ingredientId,
    version: 1,
    ingredientName: ingredientId === ING_FLOUR ? 'Mehl' : 'Kaese',
    initialQuantity: quantity,
    quantity,
    onlyOutsideConsumption: false,
    unit: 'g',
  }
}

function makeLine(
  externalId: string,
  name: string,
  price: number,
  amount: number,
  partial: Partial<OrderLineItem> = {},
): OrderLineItem {
  return {
    _id: newId(),
    externalId,
    amount,
    name,
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 7,
    taxOutside: 7,
    topic: '',
    productGroupExternalId: GROUP,
    bundleNumber: null,
    modifiers: [],
    ...partial,
  } as OrderLineItem
}

/**
 * Ursprung: 5 Broetchen (je 50 g Mehl) + 1 Pizza (200 g Mehl) mit Extra-Kaese
 * (30 g). Gesplittet werden 2 der 5 Broetchen (Teilmenge) und die ganze Pizza
 * samt Modifier — eine Zeile mit Modifier darf nur ganz wandern.
 */
function splitScenario() {
  idCounter = 0
  const roll = makeLine(PRODUCT_ROLL, 'Broetchen', 1, 5, { ingredientReferences: [ingredientRef(ING_FLOUR, 50)] })
  const cheese = {
    ...makeLine(PRODUCT_CHEESE, 'Extra Kaese', 0.5, 1, { ingredientReferences: [ingredientRef(ING_CHEESE, 30)] }),
  }
  const pizza = makeLine(PRODUCT_PIZZA, 'Pizza', 9, 1, {
    ingredientReferences: [ingredientRef(ING_FLOUR, 200)],
    modifiers: [cheese] as OrderLineItem['modifiers'],
  })

  const original = makeOrder({ status: OrderStatus.PRODUCED, lineItems: [roll, pizza] })
  const plan = planOrderSplit(original, [{ lineItemRowId: roll._id, amount: 2 }, { lineItemRowId: pizza._id }], {
    targetOrderId: newId(),
    splitAt: '2026-09-25T12:00:00.000Z',
    newId,
  })

  const source: Order = {
    ...original,
    splitOff: plan.splitOffEntries,
    appliedDiscounts: plan.sourceAppliedDiscounts,
    taxSnapshot: plan.sourceTaxSnapshot,
  }
  const target: Order = {
    ...original,
    _id: plan.splitOffEntries[0].targetOrderId,
    lineItems: plan.targetLineItems,
    appliedDiscounts: plan.targetAppliedDiscounts,
    taxSnapshot: plan.targetTaxSnapshot,
  }
  return { original, source, target }
}

/** Verbrauch je Zutat, fuer den Vergleich zweier Explosionen. */
function byIngredient(lines: ConsumptionLine[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of lines) out[l.ingredientId] = (out[l.ingredientId] ?? 0) + l.quantityUsed
  return out
}

describe('Split-Konsistenz — Quelle + Ziel = Ursprung (#391)', () => {
  it('Verbrauch: die Quelle zaehlt nur, was sie noch traegt', () => {
    const { source } = splitScenario()
    // 3 Broetchen × 50 g — die Pizza ist komplett gewandert, ihr Kaese mit ihr.
    expect(byIngredient(explodeOrderConsumption(source, new Map()).lines)).toEqual({ [ING_FLOUR]: 150 })
  })

  it('Verbrauch: Quelle + Ziel ergeben exakt den Ursprung — keine Doppelbuchung', () => {
    const { original, source, target } = splitScenario()
    const fromSource = byIngredient(explodeOrderConsumption(source, new Map()).lines)
    const fromTarget = byIngredient(explodeOrderConsumption(target, new Map()).lines)
    const fromOriginal = byIngredient(explodeOrderConsumption(original, new Map()).lines)

    expect(fromOriginal).toEqual({ [ING_FLOUR]: 450, [ING_CHEESE]: 30 })
    expect({
      [ING_FLOUR]: fromSource[ING_FLOUR] + fromTarget[ING_FLOUR],
      [ING_CHEESE]: (fromSource[ING_CHEESE] ?? 0) + fromTarget[ING_CHEESE],
    }).toEqual(fromOriginal)
  })

  it('Top-Produkte: gewanderte Menge zaehlt einmal — 5 Broetchen, 1 Pizza', () => {
    const { source, target } = splitScenario()
    const stats = computeStats([source, target])
    const qty = Object.fromEntries(stats.topProducts.map(p => [p.productExternalId, p.quantity]))
    expect(qty).toEqual({ [PRODUCT_ROLL]: 5, [PRODUCT_PIZZA]: 1 })
  })

  it('Warengruppe: Menge ueber Quelle + Ziel = Ursprung', () => {
    const { original, source, target } = splitScenario()
    const group = (orders: Order[]) => computeStats(orders).salesByProductGroup.find(g => g.groupId === GROUP)
    expect(group([source, target])?.quantity).toBe(group([original])?.quantity)
  })

  it('Brutto-Fallback ohne Payment und Snapshot: Quelle + Ziel = Ursprung', () => {
    const { original, source, target } = splitScenario()
    const bare = (o: Order): Order => ({ ...o, payment: null, taxSnapshot: null })
    const sum = getOrderGrossCents(bare(source)) + getOrderGrossCents(bare(target))
    // 5 × 1,00 + 9,00 + 0,50 = 14,50 €
    expect(getOrderGrossCents(bare(original))).toBe(1450)
    expect(sum).toBe(1450)
  })

  it('Bestellung ohne splitOff rechnet unveraendert (Bestandsverhalten)', () => {
    const { original } = splitScenario()
    expect(original.splitOff).toBeUndefined()
    expect(byIngredient(explodeOrderConsumption(original, new Map()).lines)).toEqual({
      [ING_FLOUR]: 450,
      [ING_CHEESE]: 30,
    })
  })
})
