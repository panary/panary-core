import { describe, expect, it } from 'vitest'
import { AppliedDiscount, GenericOrderLineItem, Order, OrderLineItem } from '../order.schema'
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

function makeOrder(lineItems: OrderLineItem[], dineLocation: 'dine-in' | 'take-out' = 'dine-in'): Order {
  return { lineItems, dineLocation } as unknown as Order
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

  it('Legacy-Menü ×2: Beilage/Getränk zählen PRO Menü (2× (5,00 + 1,50 + 2,00) → 17,00)', () => {
    // Entscheidung 2026-07-04: Menü-Aufpreise skalieren mit der Zeilen-Menge —
    // vorher zählten sie einmalig (13,50), der taxSnapshot war fiskal zu niedrig.
    const line = makeLine(5.0, 2, 19, 7, {
      isMenu: true,
      menuSideDish: makeGeneric(1.5, 1),
      menuDrink: makeGeneric(2.0, 1),
    })
    const result = computeOrderTax(makeOrder([line], 'dine-in'))
    expect(result.brutto).toBeCloseTo(17.0, 5)
    expect(result.taxes[0].amount + result.taxes[0].tax).toBeCloseTo(17.0, 5)
  })

  it('Legacy-Menü ×3 mit Beilagen-Menge 2: price × menge × Zeilen-Menge (5,00×3 + 1,50×2×3 → 24,00)', () => {
    // Komponenten-Menge wird mitskaliert — identisch zum Reporting-Fallback
    // `order-total.ts` (computeGenericGrossCents: price × amount × parentAmount).
    const line = makeLine(5.0, 3, 19, 7, { isMenu: true, menuSideDish: makeGeneric(1.5, 2) })
    expect(computeOrderTax(makeOrder([line], 'dine-in')).brutto).toBeCloseTo(24.0, 5)
  })
})

describe('computeOrderTax — Rabatte', () => {
  it('Festbetrag-Rabatt wird summen-exakt über Steuersätze verteilt', () => {
    const applied = [makeApplied({ target: 'order', valueType: 'amount', valueCents: 500 })]
    const result = computeOrderTax(makeOrderWithApplied([makeLine(60, 1, 19, 7), makeLine(40, 1, 7, 7)], applied))
    expect(result.brutto).toBeCloseTo(95, 5)
    const sumGross = result.taxes.reduce((s, t) => s + t.amount + t.tax, 0)
    expect(sumGross).toBeCloseTo(95, 5)
  })

  it('Rabatt größer als Brutto klemmt auf 0', () => {
    const applied = [makeApplied({ target: 'order', valueType: 'amount', valueCents: 99900 })]
    const result = computeOrderTax(makeOrderWithApplied([makeLine(10, 1, 19, 7)], applied))
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
  // Als Faktoren, nicht als Werte: `computeOrderTax` schreibt `computedAmountCents`
  // in die Eintraege zurueck — geteilte Objekte wuerden Zustand ueber die
  // Schleifendurchlaeufe tragen.
  const discountSets: Array<() => AppliedDiscount[]> = [
    () => [],
    () => [makeApplied({ target: 'order', valueType: 'percent', valuePercent: 10 })],
    () => [makeApplied({ target: 'order', valueType: 'percent', valuePercent: 33 })],
    () => [makeApplied({ target: 'order', valueType: 'amount', valueCents: 150 })],
    () => [makeApplied({ target: 'order', valueType: 'amount', valueCents: 700 })],
  ]

  it('netto + steuer === brutto (cent-genau) und brutto >= 0 für viele Kombinationen', () => {
    for (const dine of ['dine-in', 'take-out'] as const) {
      for (const [ti, to] of rates) {
        for (let n = 1; n <= 3; n++) {
          const lines = Array.from({ length: n }, (_, i) =>
            makeLine(prices[(i * 3) % prices.length], (i % 2) + 1, ti, to),
          )
          for (const buildDiscounts of discountSets) {
            const r = computeOrderTax(makeOrderWithApplied(lines, buildDiscounts(), dine))
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
    const discounted = computeOrderTax(
      makeOrderWithApplied(lines, [makeApplied({ target: 'order', valueType: 'amount', valueCents: 1234 })]),
    )
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

function makeOrderWithApplied(
  lineItems: OrderLineItem[],
  applied: AppliedDiscount[],
  dineLocation: 'dine-in' | 'take-out' = 'dine-in',
): Order {
  return { lineItems, dineLocation, appliedDiscounts: applied } as unknown as Order
}

describe('computeOrderTax — appliedDiscounts', () => {
  it('einzelner ORDER-Prozentrabatt reduziert das Brutto proportional', () => {
    const r = computeOrderTax(
      makeOrderWithApplied(
        [makeLine(100, 1, 19, 7)],
        [makeApplied({ target: 'order', valueType: 'percent', valuePercent: 10 })],
      ),
    )
    expect(roundCents(r.brutto)).toBe(toCents(90))
    expect(r.taxes[0].amount + r.taxes[0].tax).toBeCloseTo(90, 5)
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
      makeApplied({
        target: 'line',
        lineItemId: '00000000-0000-0000-0000-00000000000a',
        valueType: 'percent',
        valuePercent: 50,
      }),
    ]
    const r = computeOrderTax(makeOrderWithApplied([lineA, lineB], applied))
    // lineA 50€ -50% = 25€, lineB 50€ = 50€ → brutto 75€
    expect(roundCents(r.brutto)).toBe(toCents(75))
    expect(applied[0].computedAmountCents).toBe(toCents(25))
  })

  it('mehrere ORDER-Rabatte werden sequenziell angewandt', () => {
    const applied = [
      makeApplied({
        _id: '00000000-0000-0000-0000-0000000000a1',
        target: 'order',
        valueType: 'percent',
        valuePercent: 10,
      }),
      makeApplied({
        _id: '00000000-0000-0000-0000-0000000000a2',
        target: 'order',
        valueType: 'amount',
        valueCents: 500,
      }),
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
      makeApplied({
        target: 'line',
        lineItemId: '00000000-0000-0000-0000-00000000000a',
        valueType: 'amount',
        valueCents: 1000,
      }),
      makeApplied({
        _id: '00000000-0000-0000-0000-0000000000a2',
        target: 'order',
        valueType: 'percent',
        valuePercent: 10,
      }),
    ]
    const r = computeOrderTax(makeOrderWithApplied([lineA, lineB], applied))
    // lineA 60-10=50, lineB 40 → 90; -10% → 81
    expect(roundCents(r.brutto)).toBe(toCents(81))
    const netCents = roundCents(r.netto)
    const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
    expect(netCents + taxCents).toBe(roundCents(r.brutto))
  })
})

describe('computeOrderTax — components[] (neues Bundle-Modell)', () => {
  it('Komponenten tragen eigenen Steuersatz (mehrsatziger Split)', () => {
    const line = makeLine(7.0, 1, 7, 7, {
      components: [
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }), // Getränk 19 %
        makeGeneric(0.9, 1, { taxInside: 7, taxOutside: 7 }), // Beilage 7 %
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    expect(r.brutto).toBeCloseTo(10.2, 5)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, t.amount + t.tax]))
    expect(byRate[7]).toBeCloseTo(7.9, 5) // Hauptartikel 7,00 + Beilage 0,90
    expect(byRate[19]).toBeCloseTo(2.3, 5) // Getränk
  })

  it('Komponenten skalieren mit der Zeilen-Menge', () => {
    const line = makeLine(7.0, 2, 7, 7, {
      components: [
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        makeGeneric(0.9, 1, { taxInside: 7, taxOutside: 7 }),
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    // (7×2) + (2,30×2) + (0,90×2) = 14 + 4,60 + 1,80 = 20,40
    expect(r.brutto).toBeCloseTo(20.4, 5)
  })

  it('FIXED_PROPORTIONAL: Festpreis wird proportional über Komponenten-Normalpreise verteilt', () => {
    // Festpreis 7,00 €. Komponenten (Normalpreise, je eigener Satz):
    //   Hauptgericht 4,40 @7 %, Getränk 2,30 @19 %, Beilage 0,90 @7 %  → Σ 7,60
    const line = makeLine(7.0, 1, 7, 7, {
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      components: [
        makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        makeGeneric(0.9, 1, { taxInside: 7, taxOutside: 7 }),
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    // Brutto == Festpreis, kein Über-/Unterbetrag
    expect(r.brutto).toBeCloseTo(7.0, 5)
    expect(r.taxes.map(t => t.taxRate).sort((a, b) => a - b)).toEqual([7, 19])
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, t.amount + t.tax]))
    // 700 verteilt über [440,230,90] (largest-remainder) → 405,212,83
    //   19 %: 2,12 (Getränk) · 7 %: 4,88 (Haupt 4,05 + Beilage 0,83)
    expect(byRate[19]).toBeCloseTo(2.12, 5)
    expect(byRate[7]).toBeCloseTo(4.88, 5)
    // Tax-Integrität: netto + steuer === brutto (cent-genau)
    const netCents = roundCents(r.netto)
    const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
    expect(netCents + taxCents).toBe(roundCents(r.brutto))
  })

  it('FIXED_PROPORTIONAL: Restbetrags-Hauptgewicht (mainPrice unbekannt) bleibt summen-exakt', () => {
    // Writer-Fallback: Haupt = Festpreis − Σ übrige Komponenten = 7,00 − 3,20 = 3,80.
    // Σ Gewichte = Festpreis → Verteilung ist identisch (Komponenten zum Normalpreis).
    const line = makeLine(7.0, 1, 7, 7, {
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      components: [
        makeGeneric(3.8, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        makeGeneric(0.9, 1, { taxInside: 7, taxOutside: 7 }),
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    expect(r.brutto).toBeCloseTo(7.0, 5)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, t.amount + t.tax]))
    expect(byRate[19]).toBeCloseTo(2.3, 5) // Getränk zum vollen Normalpreis
    expect(byRate[7]).toBeCloseTo(4.7, 5) // Haupt 3,80 + Beilage 0,90
  })

  it('FIXED_PROPORTIONAL: Ad-hoc-Modifier liegt ON TOP des Festpreises', () => {
    const line = makeLine(7.0, 1, 7, 7, {
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      modifiers: [makeGeneric(0.5, 1, { taxInside: 7, taxOutside: 7 })], // Extra-Sauce on top
      components: [
        makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    // Festpreis 7,00 + Modifier 0,50 = 7,50
    expect(r.brutto).toBeCloseTo(7.5, 5)
  })

  it('FIXED_PROPORTIONAL skaliert mit der Zeilen-Menge', () => {
    const line = makeLine(7.0, 2, 7, 7, {
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      components: [
        makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        makeGeneric(0.9, 1, { taxInside: 7, taxOutside: 7 }),
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    expect(r.brutto).toBeCloseTo(14.0, 5) // 2× Festpreis
  })

  it('Legacy menuDrink/menuSideDish ohne components[] unverändert (Zeilensatz, ein Eimer)', () => {
    const line = makeLine(5.0, 1, 19, 7, {
      isMenu: true,
      menuDrink: makeGeneric(2.0, 1, { taxInside: 7, taxOutside: 7 }),
      menuSideDish: makeGeneric(1.5, 1, { taxInside: 7, taxOutside: 7 }),
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    // Legacy-Pfad besteuert alles am Zeilensatz (19 %) → ein Eimer, Brutto 8,50
    expect(r.brutto).toBeCloseTo(8.5, 5)
    expect(r.taxes).toHaveLength(1)
    expect(r.taxes[0].taxRate).toBe(19)
  })
})

describe('computeOrderTax — FIXED_PROPORTIONAL Randfälle (#39)', () => {
  const FIXED_LINE_ID = '00000000-0000-0000-0000-0000000000f1'

  // Hilfsfunktion: Standard-Festpreis-Menü 7,00 € mit Haupt 4,40 @7 %,
  // Getränk 2,30 @19 %, Beilage 0,90 @7 % → Atome [405, 212, 83] (largest remainder).
  function makeFixedLine(partial: Partial<OrderLineItem> = {}): OrderLineItem {
    return makeLine(7.0, 1, 7, 7, {
      _id: FIXED_LINE_ID,
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      components: [
        makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        makeGeneric(0.9, 1, { taxInside: 7, taxOutside: 7 }),
      ],
      ...partial,
    })
  }

  function integrityCents(r: ReturnType<typeof computeOrderTax>): void {
    const netCents = roundCents(r.netto)
    const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
    expect(netCents + taxCents).toBe(roundCents(r.brutto))
  }

  it('alle Komponenten price 0/null → Brutto == Festpreis, ein Eimer am ZEILENsatz', () => {
    // Gewichts-Summe 0 → keine Verteilung möglich; die Engine fällt bewusst auf
    // einen einzelnen Atom am Zeilensatz zurück, damit der Festpreis nicht verloren geht.
    const line = makeLine(7.0, 1, 7, 7, {
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      components: [
        makeGeneric(0, 1, { taxInside: 19, taxOutside: 19, topic: 'main' }),
        { ...makeGeneric(0, 1, { taxInside: 19, taxOutside: 19 }), price: null as unknown as number },
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'dine-in'))
    expect(r.brutto).toBeCloseTo(7.0, 5)
    expect(r.taxes).toHaveLength(1)
    expect(r.taxes[0].taxRate).toBe(7) // Zeilensatz, NICHT der Komponenten-Satz (19)
    integrityCents(r)
  })

  it('take-out: Komponenten-Steuersätze folgen taxOutside, netto + steuer == brutto', () => {
    // Identisches Bundle wie dine-in-Basistest, aber Sätze inside≠outside:
    // Haupt 19→7, Getränk 19→19, Beilage 19→7. Atome bleiben [405, 212, 83].
    const line = makeLine(7.0, 1, 19, 7, {
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      components: [
        makeGeneric(4.4, 1, { taxInside: 19, taxOutside: 7, topic: 'main' }),
        makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        makeGeneric(0.9, 1, { taxInside: 19, taxOutside: 7 }),
      ],
    })
    const r = computeOrderTax(makeOrder([line], 'take-out'))
    expect(r.brutto).toBeCloseTo(7.0, 5)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, t.amount + t.tax]))
    expect(byRate[19]).toBeCloseTo(2.12, 5) // Getränk (405+83 gehen auf 7 %)
    expect(byRate[7]).toBeCloseTo(4.88, 5)
    integrityCents(r)
  })

  it('LINE-Prozentrabatt auf FIXED-Zeile: cent-exakt über 7 %- und 19 %-Atome verteilt', () => {
    // 10 % von 700 ct = 70 ct über die Atome [405, 212, 83] → [41, 21, 8]
    // (largest remainder) → Eimer 7 %: 439 ct, 19 %: 191 ct.
    const applied = [makeApplied({ target: 'line', lineItemId: FIXED_LINE_ID, valueType: 'percent', valuePercent: 10 })]
    const r = computeOrderTax(makeOrderWithApplied([makeFixedLine()], applied))
    expect(roundCents(r.brutto)).toBe(630)
    expect(applied[0].computedAmountCents).toBe(70)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, roundCents(t.amount + t.tax)]))
    expect(byRate[7]).toBe(439)
    expect(byRate[19]).toBe(191)
    integrityCents(r)
  })

  it('LINE-Festbetrag-Rabatt auf FIXED-Zeile: cent-exakt über 7 %- und 19 %-Atome verteilt', () => {
    // 123 ct über [405, 212, 83] → [71, 37, 15] → Eimer 7 %: 402 ct, 19 %: 175 ct.
    const applied = [makeApplied({ target: 'line', lineItemId: FIXED_LINE_ID, valueType: 'amount', valueCents: 123 })]
    const r = computeOrderTax(makeOrderWithApplied([makeFixedLine()], applied))
    expect(roundCents(r.brutto)).toBe(577)
    expect(applied[0].computedAmountCents).toBe(123)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, roundCents(t.amount + t.tax)]))
    expect(byRate[7]).toBe(402)
    expect(byRate[19]).toBe(175)
    integrityCents(r)
  })

  it('Komponente mit amount 2 verdoppelt ihr Verteilungs-Gewicht', () => {
    const mkLine = (drinkAmount: number) =>
      makeLine(7.0, 1, 7, 7, {
        bundlePricingMode: 'FIXED_PROPORTIONAL',
        components: [
          makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
          makeGeneric(2.3, drinkAmount, { taxInside: 19, taxOutside: 19 }),
        ],
      })
    // amount 1: Gewichte [440, 230] → 700 verteilt als [460, 240]
    const single = computeOrderTax(makeOrder([mkLine(1)], 'dine-in'))
    const singleByRate = Object.fromEntries(single.taxes.map(t => [t.taxRate, roundCents(t.amount + t.tax)]))
    expect(singleByRate[19]).toBe(240)
    // amount 2: Gewichte [440, 460] → 700 verteilt als [342, 358] — Getränk-Anteil steigt
    const doubled = computeOrderTax(makeOrder([mkLine(2)], 'dine-in'))
    expect(doubled.brutto).toBeCloseTo(7.0, 5) // Festpreis bleibt (line.amount unverändert)
    const doubledByRate = Object.fromEntries(doubled.taxes.map(t => [t.taxRate, roundCents(t.amount + t.tax)]))
    expect(doubledByRate[19]).toBe(358)
    expect(doubledByRate[7]).toBe(342)
    integrityCents(doubled)
  })
})

describe('computeOrderTax — „OHNE"-Modifier (amount −1) sind preisneutral', () => {
  // Regression: `decreaseExtra()` im POS-Bestelldialog legt fuer „OHNE <Extra>"
  // einen Modifier mit amount −1 an. Wuerde dessen Preis mitgerechnet, zoege
  // „Margherita ohne Bacon" den Bacon-Aufpreis vom Zeilenpreis ab — waehrend der
  // Bon die OHNE-Zeile ohne Betrag druckt (order-receipt.renderer.ts).
  const ohne = (price: number) => makeGeneric(price, -1, { taxInside: 7, taxOutside: 7, topic: 'Extras' })
  const mit = (price: number) => makeGeneric(price, 1, { taxInside: 7, taxOutside: 7, topic: 'Extras' })

  it('legacy-Zeile: OHNE-Modifier mit Aufpreis aendert das Brutto nicht', () => {
    const r = computeOrderTax(makeOrder([makeLine(6.7, 1, 7, 7, { modifiers: [ohne(1.9)] })], 'take-out'))
    expect(r.brutto).toBeCloseTo(6.7, 5)
  })

  it('positive Modifier zaehlen weiterhin voll', () => {
    const r = computeOrderTax(makeOrder([makeLine(6.7, 1, 7, 7, { modifiers: [ohne(1.9), mit(1.9)] })], 'take-out'))
    expect(r.brutto).toBeCloseTo(8.6, 5)
  })

  it('Komponenten-Zeile (ROLLUP): OHNE-Modifier bleibt neutral', () => {
    const r = computeOrderTax(
      makeOrder(
        [
          makeLine(6.7, 2, 7, 7, {
            modifiers: [ohne(1.9)],
            components: [makeGeneric(2.0, 1, { taxInside: 19, taxOutside: 19 })],
          }),
        ],
        'take-out',
      ),
    )
    // 2 × 6,70 + 2 × 2,00 — der OHNE-Modifier traegt nichts bei.
    expect(r.brutto).toBeCloseTo(17.4, 5)
  })

  it('Festpreis-Menue (FIXED_PROPORTIONAL): OHNE-Modifier erzeugt kein negatives Atom', () => {
    const r = computeOrderTax(
      makeOrder(
        [
          makeLine(7.0, 1, 7, 7, {
            bundlePricingMode: 'FIXED_PROPORTIONAL',
            modifiers: [ohne(1.9)],
            components: [
              makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
              makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
            ],
          }),
        ],
        'dine-in',
      ),
    )
    expect(r.brutto).toBeCloseTo(7.0, 5)
  })
})

describe('computeOrderTax — entfernbare Zutat mit negativem priceAdjustment', () => {
  // `toggleRemovableIngredient()` legt einen Modifier mit amount 1 und
  // `price = ingredient.priceAdjustment` an. Das Admin-UI schlaegt dort einen
  // NEGATIVEN Wert vor ("-1.0") — Abzug fuers Weglassen einer Zutat.
  const ohneZutat = (price: number) =>
    makeGeneric(price, 1, { taxInside: 7, taxOutside: 7, topic: 'Extras', name: 'Ohne Zwiebeln' })

  it('zieht den konfigurierten Betrag vom Zeilenbrutto ab', () => {
    const r = computeOrderTax(makeOrder([makeLine(6.7, 1, 7, 7, { modifiers: [ohneZutat(-1)] })], 'take-out'))
    expect(r.brutto).toBeCloseTo(5.7, 5)
  })

  it('skaliert den Abzug mit der Zeilenmenge (Komponenten-Pfad)', () => {
    const r = computeOrderTax(
      makeOrder(
        [
          makeLine(6.7, 2, 7, 7, {
            modifiers: [ohneZutat(-1)],
            components: [makeGeneric(2.0, 1, { taxInside: 7, taxOutside: 7 })],
          }),
        ],
        'take-out',
      ),
    )
    // 2 × 6,70 − 2 × 1,00 + 2 × 2,00
    expect(r.brutto).toBeCloseTo(15.4, 5)
  })

  it('klemmt bei 0: ein zu grosser Abzug macht die Position nicht negativ', () => {
    // Sonst verwirft bucketize() den Eimer komplett (grossCents <= 0) und die
    // Position verschwaende samt ihres positiven Anteils aus dem Steuer-Split.
    const r = computeOrderTax(
      makeOrder([makeLine(6.7, 1, 7, 7, { modifiers: [ohneZutat(-99)] }), makeLine(3.0, 1, 7, 7)], 'take-out'),
    )
    expect(r.brutto).toBeCloseTo(3.0, 5)
  })

  it('Festpreis-Menue: Abzug wirkt on top und bleibt bei 0 geklemmt', () => {
    const mk = (adj: number) =>
      makeLine(7.0, 1, 7, 7, {
        bundlePricingMode: 'FIXED_PROPORTIONAL',
        modifiers: [ohneZutat(adj)],
        components: [
          makeGeneric(4.4, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
          makeGeneric(2.3, 1, { taxInside: 19, taxOutside: 19 }),
        ],
      })
    expect(computeOrderTax(makeOrder([mk(-1)], 'dine-in')).brutto).toBeCloseTo(6.0, 5)
    expect(computeOrderTax(makeOrder([mk(-99)], 'dine-in')).brutto).toBeCloseTo(0, 5)
  })

  it('positiver Modifier und Abzug verrechnen sich additiv', () => {
    const r = computeOrderTax(
      makeOrder(
        [
          makeLine(6.7, 1, 7, 7, {
            modifiers: [ohneZutat(-1), makeGeneric(1.9, 1, { taxInside: 7, taxOutside: 7, topic: 'Extras' })],
          }),
        ],
        'take-out',
      ),
    )
    expect(r.brutto).toBeCloseTo(7.6, 5)
  })
})
