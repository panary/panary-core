import { describe, expect, it } from 'vitest'
import {
  AppliedDiscount,
  computeOrderTax,
  DiscountType,
  GenericOrderLineItem,
  Order,
  OrderLineItem,
} from '@panary/orders/domain'
import {
  calculateArticlePrice,
  calculateArticlePriceWithoutExtras,
  calculateCombinationPrice,
  calculateSumPrice,
  calculateSumPriceSeperated,
  calculateSumPriceWithDiscountDetails,
  calculateTaxSummary,
} from './prices-and-taxes'

// Die POS-Anzeige delegiert seit dem Stufe-2-Refactor vollständig an die
// kanonische Cents-Engine (`lineItemGrossCents`/`computeOrderTax`,
// @panary/orders/domain). Diese Spec lockt: Anzeige == Engine cent-genau.
// Die früher hier dokumentierten DRIFT-Fälle (Float-Anzeige vs. Engine) sind
// per User-Entscheidung 2026-07-04 aufgelöst — Engine überall führend; die
// Ist-Anker der alten Float-Logik wurden bewusst auf Engine-Werte aktualisiert.

// Fixture-Helfer analog zur Engine-Spec (compute-order-tax.spec.ts). Steuersatz
// einheitlich 19/19 — für Brutto-Vergleiche ist nur die Brutto-Summe relevant.
function makeGeneric(price: number, amount = 1, partial: Partial<GenericOrderLineItem> = {}): GenericOrderLineItem {
  return {
    _id: '00000000-0000-0000-0000-000000000000',
    externalId: '00000000-0000-0000-0000-000000000001',
    amount,
    name: 'x',
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 19,
    taxOutside: 19,
    topic: '',
    ...partial,
  }
}

function makeLine(price: number, amount: number, partial: Partial<OrderLineItem> = {}): OrderLineItem {
  return {
    ...makeGeneric(price, amount),
    productGroupExternalId: '00000000-0000-0000-0000-000000000002',
    bundleNumber: null,
    modifiers: [],
    isMenu: false,
    menuDrink: null,
    menuSideDish: null,
    ...partial,
  } as OrderLineItem
}

// Rabatte kommen ausschliesslich ueber `appliedDiscounts` (ADR 0030) — das
// Legacy-Feld `order.discount` gibt es nicht mehr.
function makeOrder(lineItems: OrderLineItem[], appliedDiscounts?: AppliedDiscount[]): Order {
  return { lineItems, dineLocation: 'dine-in', appliedDiscounts: appliedDiscounts ?? null } as unknown as Order
}

function orderDiscount(partial: Partial<AppliedDiscount>): AppliedDiscount {
  return {
    _id: '00000000-0000-0000-0000-0000000000aa',
    name: 'Rabatt',
    method: 'manual',
    target: 'order',
    valueType: DiscountType.PERCENT,
    valuePercent: 0,
    valueCents: 0,
    computedAmountCents: 0,
    appliedAt: '2026-08-13T12:00:00.000Z',
    ...partial,
  } as AppliedDiscount
}

const cents = (euro: number) => Math.round(euro * 100)

// FIXED_PROPORTIONAL-Menü 7,00 € — Komponenten wie im POS-Writer (main + Getränk),
// optional mit Ad-hoc-Modifier 0,50 (liegt laut Engine ON TOP des Festpreises).
function makeFixedBundle(amount: number, withModifier: boolean): OrderLineItem {
  return makeLine(7.0, amount, {
    bundlePricingMode: 'FIXED_PROPORTIONAL',
    modifiers: withModifier ? [makeGeneric(0.5, 1)] : [],
    components: [makeGeneric(4.4, 1, { topic: 'main' }), makeGeneric(2.3, 1)],
  })
}

describe('calculateArticlePriceWithoutExtras — Engine-Semantik', () => {
  it('einfacher Artikel: price × amount (3,50 × 2 → 7,00)', () => {
    expect(calculateArticlePriceWithoutExtras(makeLine(3.5, 2))).toBe(7.0)
  })

  it('Artikel ohne Preis → 0', () => {
    expect(calculateArticlePriceWithoutExtras(makeLine(0, 3))).toBe(0)
  })

  it('Menü-Beilage/Getränk zählen PRO Menü (2× (5,00 + 2,00) → 14,00; kein General-Aufschlag)', () => {
    // Früher (Float-Logik): 16,00 — inkl. generalDrinkPrice 1,00 ×2 trotz fehlendem
    // menuDrink-Objekt. Engine kennt keine General-Preise (Entscheidung 2026-07-04).
    const line = makeLine(5.0, 2, { isMenu: true, menuSideDish: makeGeneric(2.0) })
    expect(calculateArticlePriceWithoutExtras(line)).toBe(14.0)
  })

  it('Menü mit Beilage zum General-Preis: Positionspreis zählt (5,00 + 1,50 → 6,50)', () => {
    const line = makeLine(5.0, 1, { isMenu: true, menuSideDish: makeGeneric(1.5) })
    expect(calculateArticlePriceWithoutExtras(line)).toBe(6.5)
  })

  it('FIXED_PROPORTIONAL mit Ad-hoc-Modifier: ohne Extras = Festpreis × Menge (21,00)', () => {
    expect(calculateArticlePriceWithoutExtras(makeFixedBundle(3, true))).toBe(21.0)
  })
})

describe('calculateArticlePrice — Engine-Semantik', () => {
  it('Artikel + Modifier: 3,50×2 + 0,50×2 → 8,00', () => {
    const line = makeLine(3.5, 2, { modifiers: [makeGeneric(0.5, 2)] })
    expect(calculateArticlePrice(line)).toBe(8.0)
  })

  it('Modifier mit amount 0 wird ignoriert', () => {
    const line = makeLine(3.5, 2, { modifiers: [makeGeneric(0.5, 0)] })
    expect(calculateArticlePrice(line)).toBe(7.0)
  })

  it('FIXED_PROPORTIONAL: Festpreis × Menge (7,00 × 3 → 21,00)', () => {
    expect(calculateArticlePrice(makeFixedBundle(3, false))).toBe(21.0)
  })
})

describe('calculateSumPrice / calculateSumPriceWithDiscountDetails — Engine-Semantik', () => {
  it('summiert Positionen (3,50×2 + 2,00×1 → 9,00)', () => {
    const order = makeOrder([makeLine(3.5, 2), makeLine(2.0, 1)])
    expect(calculateSumPrice(order)).toBe(9.0)
  })

  it('ohne Rabatt bleibt die Summe unverändert', () => {
    const order = makeOrder([makeLine(3.5, 2)])
    expect(calculateSumPriceWithDiscountDetails(order)).toBe(7.0)
  })

  it('Prozentrabatt: 33 % auf 3 × 3,33 → 6,69', () => {
    const order = makeOrder([makeLine(3.33, 3)], [orderDiscount({ valueType: DiscountType.PERCENT, valuePercent: 33 })])
    expect(calculateSumPriceWithDiscountDetails(order)).toBe(6.69)
  })

  it('Festbetrag-Rabatt: 10,00 − 4,00 → 6,00', () => {
    const order = makeOrder([makeLine(5.0, 2)], [orderDiscount({ valueType: DiscountType.AMOUNT, valueCents: 400 })])
    expect(calculateSumPriceWithDiscountDetails(order)).toBe(6.0)
  })

  it('Festbetrag-Rabatt größer als Summe klemmt auf 0', () => {
    const order = makeOrder([makeLine(5.0, 2)], [orderDiscount({ valueType: DiscountType.AMOUNT, valueCents: 99900 })])
    expect(calculateSumPriceWithDiscountDetails(order)).toBe(0)
  })
})

describe('calculateCombinationPrice / calculateSumPriceSeperated — Engine-Semantik', () => {
  it('Kombination summiert die Artikelpreise (3,50×2 + 2,00×1 → 9,00)', () => {
    expect(calculateCombinationPrice([makeLine(3.5, 2), makeLine(2.0, 1)])).toBe(9.0)
  })

  it('sumPriceSeperated: Einzelartikel + Kombinationen (7,00 + 9,00 → 16,00)', () => {
    const articles = [makeLine(3.5, 2)]
    const combinations = [[makeLine(3.5, 2), makeLine(2.0, 1)]]
    expect(calculateSumPriceSeperated(articles, combinations)).toBe(16.0)
  })
})

describe('calculateTaxSummary — delegiert an computeOrderTax', () => {
  it('liefert exakt das Engine-Ergebnis (gleiches Order-Objekt)', () => {
    const order = makeOrder([makeLine(3.33, 3)], [orderDiscount({ valueType: DiscountType.PERCENT, valuePercent: 33 })])
    expect(calculateTaxSummary(order)).toEqual(computeOrderTax(order))
  })
})

describe('Anzeige ↔ Engine — cent-genaue Übereinstimmung', () => {
  it('Artikel + Modifier (legacy, ohne components): 8,00 == Engine-Brutto', () => {
    const line = makeLine(3.5, 2, { modifiers: [makeGeneric(0.5, 2)] })
    const display = calculateArticlePrice(line)
    const engine = computeOrderTax(makeOrder([line]))
    expect(display).toBe(8.0)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('FIXED_PROPORTIONAL ohne Ad-hoc-Modifier: 21,00 == Engine-Brutto', () => {
    const line = makeFixedBundle(3, false)
    const display = calculateArticlePrice(line)
    const engine = computeOrderTax(makeOrder([line]))
    expect(display).toBe(21.0)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('Prozentrabatt 33 % auf 3 × 3,33: 6,69 == Engine-Brutto', () => {
    const order = makeOrder([makeLine(3.33, 3)], [orderDiscount({ valuePercent: 33 })])
    const display = calculateSumPriceWithDiscountDetails(order)
    const engine = computeOrderTax(order)
    expect(display).toBe(6.69)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('Menü ×1 mit expliziter Beilage/Getränk: 8,50 == Engine-Brutto', () => {
    const line = makeLine(5.0, 1, { isMenu: true, menuSideDish: makeGeneric(1.5), menuDrink: makeGeneric(2.0) })
    const display = calculateArticlePrice(line)
    const engine = computeOrderTax(makeOrder([line]))
    expect(display).toBe(8.5)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('Fixture-Tabelle Preis/Menge/Prozentrabatt: Anzeige == Engine-Brutto (cent-genau)', () => {
    const cases: Array<[number, number, number, number]> = [
      // [preis, menge, rabattProzent, erwartet]
      [1.19, 1, 10, 1.07],
      [2.5, 2, 25, 3.75],
      [3.33, 3, 33, 6.69],
      [4.75, 2, 15, 8.07],
      [12.49, 3, 20, 29.98],
      [0.99, 5, 5, 4.7],
      [1.5, 1, 15, 1.27],
      [7.77, 2, 12, 13.68],
    ]
    for (const [price, amount, discountPercent, expected] of cases) {
      const order = makeOrder([makeLine(price, amount)], [orderDiscount({ valuePercent: discountPercent })])
      const display = calculateSumPriceWithDiscountDetails(order)
      const engine = computeOrderTax(order)
      expect(display, `${price}×${amount} −${discountPercent}%`).toBe(expected)
      expect(cents(display), `${price}×${amount} −${discountPercent}%`).toBe(cents(engine.brutto))
    }
  })
})

// Die vier früher dokumentierten DRIFT-Fälle (Float-Anzeige ≠ Engine) — jetzt
// grüne Tests: Anzeige == Engine cent-genau (Entscheidung 2026-07-04, Engine
// führend; Fall 3 zusätzlich über den Engine-Fix „Beilage/Getränk PRO Menü").
describe('Aufgelöste Drift-Fälle Anzeige ↔ Engine', () => {
  it('1. FIXED_PROPORTIONAL + Ad-hoc-Modifier: Modifier zählt on top (21,00 + 3× 0,50 → 22,50)', () => {
    // Früher ignorierte die Anzeige den Modifier (Early-Return) → 21,00.
    const line = makeFixedBundle(3, true)
    const display = calculateArticlePrice(line)
    expect(display).toBe(22.5)
    expect(cents(display)).toBe(cents(computeOrderTax(makeOrder([line])).brutto))
  })

  it('2. Prozentrabatt-Halbcents runden wie die Engine (Rabattbetrag half-up)', () => {
    // Früher rundete die Anzeige den Endbetrag (toFixed) → je 1 Cent mehr.
    const cases: Array<[number, number, number, number]> = [
      // [preis, menge, rabattProzent, erwartet == Engine]
      [9.99, 1, 50, 4.99],
      [1.25, 1, 10, 1.12],
      [2.35, 3, 30, 4.93],
    ]
    for (const [price, amount, discountPercent, expected] of cases) {
      const order = makeOrder([makeLine(price, amount)], [orderDiscount({ valuePercent: discountPercent })])
      const display = calculateSumPriceWithDiscountDetails(order)
      expect(display, `${price}×${amount} −${discountPercent}%`).toBe(expected)
      expect(cents(display), `${price}×${amount} −${discountPercent}%`).toBe(cents(computeOrderTax(order).brutto))
    }
  })

  it('3. Menü ×2 — Beilage/Getränk PRO Menü: Anzeige 17,00 == Engine 17,00', () => {
    const line = makeLine(5.0, 2, { isMenu: true, menuSideDish: makeGeneric(1.5), menuDrink: makeGeneric(2.0) })
    const display = calculateArticlePrice(line)
    expect(display).toBe(17.0)
    expect(cents(display)).toBe(cents(computeOrderTax(makeOrder([line])).brutto))
  })

  it('4. Menü ohne Beilage/Getränk-Objekt: KEIN General-Preis-Aufschlag mehr (5,00 == Engine)', () => {
    // Früher schlug die Anzeige generalSideDish-/generalDrinkPrice auf (7,50) —
    // der fakturierte Betrag (taxSnapshot/payment) enthielt sie nie.
    const line = makeLine(5.0, 1, { isMenu: true })
    const display = calculateArticlePrice(line)
    expect(display).toBe(5.0)
    expect(cents(display)).toBe(cents(computeOrderTax(makeOrder([line])).brutto))
  })
})
