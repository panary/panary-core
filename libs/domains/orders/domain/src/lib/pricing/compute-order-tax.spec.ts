import { describe, expect, it } from 'vitest'
import { AppliedDiscount, Discount, GenericOrderLineItem, Order, OrderLineItem } from '../order.schema'
import { computeOrderTax } from './compute-order-tax'
import { toCents } from './money'

function makeGeneric(price: number, amount = 1, partial: Partial<GenericOrderLineItem> = {}): GenericOrderLineItem {
  return {
    _id: '00000000-0000-0000-0000-000000000000',
    externalId: '00000000-0000-0000-0000-000000000001',
    amount,
    name: 'x',
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 0,
    taxOutside: 0,
    topic: '',
    ...partial,
  }
}

function makeLine(
  price: number,
  amount: number,
  taxInside: number,
  taxOutside: number,
  partial: Partial<OrderLineItem> = {},
): OrderLineItem {
  return {
    ...makeGeneric(price, amount, { taxInside, taxOutside }),
    productGroupExternalId: '00000000-0000-0000-0000-000000000002',
    bundleNumber: null,
    modifiers: [],
    isMenu: false,
    menuDrink: null,
    menuSideDish: null,
    ...partial,
  } as OrderLineItem
}

function makeOrder(
  lineItems: OrderLineItem[],
  dineLocation: 'dine-in' | 'take-out' = 'dine-in',
  discount?: Discount,
): Order {
  return { lineItems, dineLocation, discount: discount ?? null } as unknown as Order
}

const roundCents = (euro: number) => Math.round(euro * 100)

describe('computeOrderTax — MwSt-Extraktion (korrekt)', () => {
  it('extrahiert eingebettete MwSt aus dem Bruttopreis (1,19€ @19% → netto 1,00 / steuer 0,19)', () => {
    const result = computeOrderTax(makeOrder([makeLine(1.19, 1, 19, 7)], 'dine-in'))
    expect(result.brutto).toBeCloseTo(1.19, 5)
    expect(result.netto).toBeCloseTo(1.0, 5)
    expect(result.taxes).toHaveLength(1)
    expect(result.taxes[0].taxRate).toBe(19)
    expect(result.taxes[0].tax).toBeCloseTo(0.19, 5)
    expect(result.taxes[0].amount).toBeCloseTo(1.0, 5)
  })

  it('nutzt taxOutside bei take-out', () => {
    const result = computeOrderTax(makeOrder([makeLine(1.07, 1, 19, 7)], 'take-out'))
    expect(result.brutto).toBeCloseTo(1.07, 5)
    expect(result.taxes[0].taxRate).toBe(7)
    expect(result.taxes[0].tax).toBeCloseTo(0.07, 5)
    expect(result.taxes[0].amount).toBeCloseTo(1.0, 5)
  })

  it('führt mehrere Positionen mit gleichem Satz zusammen', () => {
    const result = computeOrderTax(makeOrder([makeLine(1.19, 2, 19, 7), makeLine(1.19, 1, 19, 7)], 'dine-in'))
    expect(result.brutto).toBeCloseTo(3.57, 5)
    expect(result.taxes).toHaveLength(1)
    expect(result.taxes[0].tax).toBeCloseTo(0.57, 5)
  })

  it('trennt mehrere Steuersätze', () => {
    const result = computeOrderTax(makeOrder([makeLine(1.19, 1, 19, 7), makeLine(1.07, 1, 7, 7)], 'dine-in'))
    expect(result.brutto).toBeCloseTo(2.26, 5)
    const rates = result.taxes.map(t => t.taxRate).sort((a, b) => a - b)
    expect(rates).toEqual([7, 19])
  })

  it('bezieht Modifier und Menü-Bestandteile ein', () => {
    const line = makeLine(5.0, 1, 19, 7, {
      isMenu: true,
      modifiers: [makeGeneric(0.5, 1)],
      menuDrink: makeGeneric(2.0, 1),
      menuSideDish: makeGeneric(1.5, 1),
    })
    const result = computeOrderTax(makeOrder([line], 'dine-in'))
    expect(result.brutto).toBeCloseTo(9.0, 5)
  })
})

describe('computeOrderTax — Rabatte', () => {
  it('Prozentrabatt reduziert Brutto proportional, Tax-Integrität bleibt', () => {
    const discount: Discount = { discountType: 'percent', discount: 10 }
    const result = computeOrderTax(makeOrder([makeLine(100, 1, 19, 7)], 'dine-in', discount))
    expect(result.brutto).toBeCloseTo(90, 5)
    expect(result.taxes[0].amount + result.taxes[0].tax).toBeCloseTo(90, 5)
  })

  it('Festbetrag-Rabatt wird summen-exakt über Steuersätze verteilt', () => {
    const discount: Discount = { discountType: 'amount', discount: 5 }
    const result = computeOrderTax(
      makeOrder([makeLine(60, 1, 19, 7), makeLine(40, 1, 7, 7)], 'dine-in', discount),
    )
    expect(result.brutto).toBeCloseTo(95, 5)
    const sumGross = result.taxes.reduce((s, t) => s + t.amount + t.tax, 0)
    expect(sumGross).toBeCloseTo(95, 5)
  })

  it('Rabatt größer als Brutto klemmt auf 0', () => {
    const discount: Discount = { discountType: 'amount', discount: 999 }
    const result = computeOrderTax(makeOrder([makeLine(10, 1, 19, 7)], 'dine-in', discount))
    expect(result.brutto).toBeCloseTo(0, 5)
    expect(result.netto).toBeCloseTo(0, 5)
    expect(result.taxes).toHaveLength(0)
  })
})

describe('computeOrderTax — Invarianten (property-style)', () => {
  const prices = [0.99, 1.19, 2.5, 3.33, 4.75, 9.9, 12.49]
  const rates: Array<[number, number]> = [
    [19, 7],
    [7, 7],
    [19, 19],
  ]
  const discounts: Array<Discount | undefined> = [
    undefined,
    { discountType: 'percent', discount: 10 },
    { discountType: 'percent', discount: 33 },
    { discountType: 'amount', discount: 1.5 },
    { discountType: 'amount', discount: 7 },
  ]

  it('netto + steuer === brutto (cent-genau) und brutto >= 0 für viele Kombinationen', () => {
    for (const dine of ['dine-in', 'take-out'] as const) {
      for (const [ti, to] of rates) {
        for (let n = 1; n <= 3; n++) {
          const lines = Array.from({ length: n }, (_, i) => makeLine(prices[(i * 3) % prices.length], (i % 2) + 1, ti, to))
          for (const d of discounts) {
            const r = computeOrderTax(makeOrder(lines, dine, d))
            expect(r.brutto).toBeGreaterThanOrEqual(0)
            const netCents = roundCents(r.netto)
            const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
            const grossCents = roundCents(r.brutto)
            expect(netCents + taxCents).toBe(grossCents)
            // Pro Satz: amount + tax === Eimer-Brutto
            for (const t of r.taxes) {
              expect(roundCents(t.amount) + roundCents(t.tax)).toBe(roundCents(t.amount + t.tax))
            }
          }
        }
      }
    }
  })

  it('Festbetrag-Rabatt senkt Brutto um exakt den Rabattbetrag (geklemmt)', () => {
    const lines = [makeLine(60, 1, 19, 7), makeLine(40, 1, 7, 7)]
    const base = computeOrderTax(makeOrder(lines, 'dine-in'))
    const discounted = computeOrderTax(makeOrder(lines, 'dine-in', { discountType: 'amount', discount: 12.34 }))
    expect(roundCents(base.brutto) - roundCents(discounted.brutto)).toBe(toCents(12.34))
  })
})

function makeApplied(partial: Partial<AppliedDiscount>): AppliedDiscount {
  return {
    _id: '00000000-0000-0000-0000-0000000000aa',
    name: 'Rabatt',
    method: 'manual',
    target: 'order',
    valueType: 'percent',
    valuePercent: 10,
    valueCents: 0,
    computedAmountCents: 0,
    appliedAt: '2026-05-25T00:00:00.000Z',
    ...partial,
  } as AppliedDiscount
}

function makeOrderWithApplied(lineItems: OrderLineItem[], applied: AppliedDiscount[], dineLocation: 'dine-in' | 'take-out' = 'dine-in'): Order {
  return { lineItems, dineLocation, discount: null, appliedDiscounts: applied } as unknown as Order
}

describe('computeOrderTax — appliedDiscounts', () => {
  it('einzelner ORDER-Prozentrabatt = Legacy-Verhalten', () => {
    const lines = [makeLine(100, 1, 19, 7)]
    const viaApplied = computeOrderTax(makeOrderWithApplied(lines, [makeApplied({ target: 'order', valueType: 'percent', valuePercent: 10 })]))
    const viaLegacy = computeOrderTax(makeOrder([makeLine(100, 1, 19, 7)], 'dine-in', { discountType: 'percent', discount: 10 }))
    expect(roundCents(viaApplied.brutto)).toBe(roundCents(viaLegacy.brutto))
  })

  it('schreibt computedAmountCents zurück', () => {
    const applied = [makeApplied({ target: 'order', valueType: 'percent', valuePercent: 10 })]
    computeOrderTax(makeOrderWithApplied([makeLine(100, 1, 19, 7)], applied))
    expect(applied[0].computedAmountCents).toBe(1000)
  })

  it('LINE-Rabatt reduziert nur die betroffene Position', () => {
    const lineA = makeLine(50, 1, 19, 7, { _id: '00000000-0000-0000-0000-00000000000a' })
    const lineB = makeLine(50, 1, 19, 7, { _id: '00000000-0000-0000-0000-00000000000b' })
    const applied = [
      makeApplied({ target: 'line', lineItemId: '00000000-0000-0000-0000-00000000000a', valueType: 'percent', valuePercent: 50 }),
    ]
    const r = computeOrderTax(makeOrderWithApplied([lineA, lineB], applied))
    // lineA 50€ -50% = 25€, lineB 50€ = 50€ → brutto 75€
    expect(roundCents(r.brutto)).toBe(toCents(75))
    expect(applied[0].computedAmountCents).toBe(toCents(25))
  })

  it('mehrere ORDER-Rabatte werden sequenziell angewandt', () => {
    const applied = [
      makeApplied({ _id: '00000000-0000-0000-0000-0000000000a1', target: 'order', valueType: 'percent', valuePercent: 10 }),
      makeApplied({ _id: '00000000-0000-0000-0000-0000000000a2', target: 'order', valueType: 'amount', valueCents: 500 }),
    ]
    const r = computeOrderTax(makeOrderWithApplied([makeLine(100, 1, 19, 7)], applied))
    // 100€ -10% = 90€, dann -5€ = 85€
    expect(roundCents(r.brutto)).toBe(toCents(85))
    expect(applied[0].computedAmountCents).toBe(1000)
    expect(applied[1].computedAmountCents).toBe(500)
  })

  it('LINE zuerst, dann ORDER; Tax-Integrität bleibt', () => {
    const lineA = makeLine(60, 1, 19, 7, { _id: '00000000-0000-0000-0000-00000000000a' })
    const lineB = makeLine(40, 1, 7, 7, { _id: '00000000-0000-0000-0000-00000000000b' })
    const applied = [
      makeApplied({ target: 'line', lineItemId: '00000000-0000-0000-0000-00000000000a', valueType: 'amount', valueCents: 1000 }),
      makeApplied({ _id: '00000000-0000-0000-0000-0000000000a2', target: 'order', valueType: 'percent', valuePercent: 10 }),
    ]
    const r = computeOrderTax(makeOrderWithApplied([lineA, lineB], applied))
    // lineA 60-10=50, lineB 40 → 90; -10% → 81
    expect(roundCents(r.brutto)).toBe(toCents(81))
    const netCents = roundCents(r.netto)
    const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
    expect(netCents + taxCents).toBe(roundCents(r.brutto))
  })
})
