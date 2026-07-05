import { describe, expect, it } from 'vitest'
import {
  computeOrderTax,
  Discount,
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

// Diese Spec lockt den IST-Zustand der Float-basierten POS-Anzeige-Preislogik
// (Regressionsanker) und vergleicht sie cent-genau mit der kanonischen
// cents-internen Engine `computeOrderTax` (@panary/orders/domain). Echte
// Abweichungen sind unten im DRIFT-Block als `it.todo` dokumentiert — sie sind
// Input für das spätere Refactoring der Anzeige auf die Cents-Engine (Stufe 2).
// Die Anzeige-Logik selbst wird hier bewusst NICHT verändert.

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

function makeOrder(lineItems: OrderLineItem[], discount?: Discount): Order {
  return { lineItems, dineLocation: 'dine-in', discount: discount ?? null } as unknown as Order
}

const GENERAL_SIDE = 1.5
const GENERAL_DRINK = 1
const cents = (euro: number) => Math.round(euro * 100)

// FIXED_PROPORTIONAL-Menü 7,00 € — Komponenten wie im POS-Writer (main + Getränk),
// optional mit Ad-hoc-Modifier 0,50 (liegt laut Engine ON TOP des Festpreises).
function makeFixedBundle(amount: number, withModifier: boolean): OrderLineItem {
  return makeLine(7.0, amount, {
    bundlePricingMode: 'FIXED_PROPORTIONAL',
    modifiers: withModifier ? [makeGeneric(0.5, 1)] : [],
    components: [
      makeGeneric(4.4, 1, { topic: 'main' }),
      makeGeneric(2.3, 1),
    ],
  })
}

describe('calculateArticlePriceWithoutExtras — Regressionsanker', () => {
  it('einfacher Artikel: price × amount (3,50 × 2 → 7,00)', () => {
    expect(calculateArticlePriceWithoutExtras(makeLine(3.5, 2), GENERAL_SIDE, GENERAL_DRINK)).toBe(7.0)
  })

  it('Artikel ohne Preis → 0', () => {
    expect(calculateArticlePriceWithoutExtras(makeLine(0, 3), GENERAL_SIDE, GENERAL_DRINK)).toBe(0)
  })

  it('Menü ohne Beilage/Getränk-Objekt: General-Preise werden aufgeschlagen (5,00 + 1,50 + 1,00 → 7,50)', () => {
    const line = makeLine(5.0, 1, { isMenu: true })
    expect(calculateArticlePriceWithoutExtras(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(7.5)
  })

  it('Menü-Override: menuSideDish.price ≠ General-Preis nutzt den Positionspreis (2× (5,00 + 2,00 + 1,00) → 16,00)', () => {
    const line = makeLine(5.0, 2, { isMenu: true, menuSideDish: makeGeneric(2.0) })
    expect(calculateArticlePriceWithoutExtras(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(16.0)
  })

  it('Menü ohne Override: menuSideDish.price === General-Preis fällt auf den General-Preis zurück (→ 7,50)', () => {
    const line = makeLine(5.0, 1, { isMenu: true, menuSideDish: makeGeneric(GENERAL_SIDE) })
    expect(calculateArticlePriceWithoutExtras(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(7.5)
  })
})

describe('calculateArticlePrice — Regressionsanker', () => {
  it('Artikel + Modifier: 3,50×2 + 0,50×2 → 8,00', () => {
    const line = makeLine(3.5, 2, { modifiers: [makeGeneric(0.5, 2)] })
    expect(calculateArticlePrice(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(8.0)
  })

  it('Modifier mit amount 0 wird ignoriert', () => {
    const line = makeLine(3.5, 2, { modifiers: [makeGeneric(0.5, 0)] })
    expect(calculateArticlePrice(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(7.0)
  })

  it('FIXED_PROPORTIONAL: Festpreis × Menge (7,00 × 3 → 21,00)', () => {
    expect(calculateArticlePrice(makeFixedBundle(3, false), GENERAL_SIDE, GENERAL_DRINK)).toBe(21.0)
  })

  it('FIXED_PROPORTIONAL mit Ad-hoc-Modifier: Modifier wird aktuell IGNORIERT (Early-Return) → 21,00', () => {
    // IST-Zustand-Anker — Soll laut Engine wäre 22,50 (Modifier on top), siehe DRIFT-Block.
    expect(calculateArticlePrice(makeFixedBundle(3, true), GENERAL_SIDE, GENERAL_DRINK)).toBe(21.0)
  })
})

describe('calculateSumPrice / calculateSumPriceWithDiscountDetails — Regressionsanker', () => {
  it('summiert Positionen (3,50×2 + 2,00×1 → 9,00)', () => {
    const order = makeOrder([makeLine(3.5, 2), makeLine(2.0, 1)])
    expect(calculateSumPrice(order, GENERAL_SIDE, GENERAL_DRINK)).toBe(9.0)
  })

  it('ohne Rabatt bleibt die Summe unverändert', () => {
    const order = makeOrder([makeLine(3.5, 2)])
    expect(calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)).toBe(7.0)
  })

  it('Prozentrabatt: 33 % auf 3 × 3,33 → 6,69', () => {
    const order = makeOrder([makeLine(3.33, 3)], { discountType: DiscountType.PERCENT, discount: 33 })
    expect(calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)).toBe(6.69)
  })

  it('Festbetrag-Rabatt: 10,00 − 4,00 → 6,00', () => {
    const order = makeOrder([makeLine(5.0, 2)], { discountType: DiscountType.AMOUNT, discount: 4 })
    expect(calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)).toBe(6.0)
  })

  it('Festbetrag-Rabatt größer als Summe klemmt auf 0', () => {
    const order = makeOrder([makeLine(5.0, 2)], { discountType: DiscountType.AMOUNT, discount: 999 })
    expect(calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)).toBe(0)
  })
})

describe('calculateCombinationPrice / calculateSumPriceSeperated — Regressionsanker', () => {
  it('Kombination summiert die Artikelpreise (3,50×2 + 2,00×1 → 9,00)', () => {
    expect(calculateCombinationPrice([makeLine(3.5, 2), makeLine(2.0, 1)], GENERAL_SIDE, GENERAL_DRINK)).toBe(9.0)
  })

  it('sumPriceSeperated: Einzelartikel + Kombinationen (7,00 + 9,00 → 16,00)', () => {
    const articles = [makeLine(3.5, 2)]
    const combinations = [[makeLine(3.5, 2), makeLine(2.0, 1)]]
    expect(calculateSumPriceSeperated(articles, combinations, GENERAL_SIDE, GENERAL_DRINK)).toBe(16.0)
  })
})

describe('calculateTaxSummary — delegiert an computeOrderTax', () => {
  it('liefert exakt das Engine-Ergebnis (gleiches Order-Objekt)', () => {
    const order = makeOrder([makeLine(3.33, 3)], { discountType: DiscountType.PERCENT, discount: 33 })
    expect(calculateTaxSummary(order)).toEqual(computeOrderTax(order))
  })
})

describe('Anzeige ↔ Engine — cent-genaue Übereinstimmung', () => {
  it('Artikel + Modifier (legacy, ohne components): 8,00 == Engine-Brutto', () => {
    const line = makeLine(3.5, 2, { modifiers: [makeGeneric(0.5, 2)] })
    const display = calculateArticlePrice(line, GENERAL_SIDE, GENERAL_DRINK)
    const engine = computeOrderTax(makeOrder([line]))
    expect(display).toBe(8.0)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('FIXED_PROPORTIONAL ohne Ad-hoc-Modifier: 21,00 == Engine-Brutto', () => {
    const line = makeFixedBundle(3, false)
    const display = calculateArticlePrice(line, GENERAL_SIDE, GENERAL_DRINK)
    const engine = computeOrderTax(makeOrder([line]))
    expect(display).toBe(21.0)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('Prozentrabatt 33 % auf 3 × 3,33: 6,69 == Engine-Brutto', () => {
    const discount: Discount = { discountType: DiscountType.PERCENT, discount: 33 }
    const order = makeOrder([makeLine(3.33, 3)], discount)
    const display = calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)
    const engine = computeOrderTax(order)
    expect(display).toBe(6.69)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('Menü ×1 mit expliziter Beilage/Getränk: 8,50 == Engine-Brutto', () => {
    const line = makeLine(5.0, 1, { isMenu: true, menuSideDish: makeGeneric(1.5), menuDrink: makeGeneric(2.0) })
    const display = calculateArticlePrice(line, 1.5, 2.0)
    const engine = computeOrderTax(makeOrder([line]))
    expect(display).toBe(8.5)
    expect(cents(display)).toBe(cents(engine.brutto))
  })

  it('Fixture-Tabelle Preis/Menge/Prozentrabatt: Anzeige == Engine-Brutto (cent-genau)', () => {
    // Kombis ohne Halbcent-Kante — die abweichenden Fälle sind im DRIFT-Block dokumentiert.
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
      const discount: Discount = { discountType: DiscountType.PERCENT, discount: discountPercent }
      const order = makeOrder([makeLine(price, amount)], discount)
      const display = calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)
      const engine = computeOrderTax(order)
      expect(display, `${price}×${amount} −${discountPercent}%`).toBe(expected)
      expect(cents(display), `${price}×${amount} −${discountPercent}%`).toBe(cents(engine.brutto))
    }
  })
})

// Echte Abweichungen Anzeige ↔ Engine. Die `it.todo`-Einträge beschreiben den
// Soll-Zustand nach dem Stufe-2-Refactor; die Anker-Tests locken den heutigen
// Ist-Zustand BEIDER Seiten, damit jede Verschiebung sofort sichtbar wird.
describe('DRIFT Anzeige ↔ Engine — dokumentierter Ist-Zustand (Stufe-2-Input)', () => {
  it.todo(
    'DRIFT: FIXED_PROPORTIONAL mit Ad-hoc-Modifier — Anzeige ignoriert Modifier (Early-Return Z.71-73): ' +
      '7,00×3 + Modifier 0,50 → Anzeige 21,00 €, Engine-Brutto 22,50 € (Soll: 22,50)',
  )
  it('Anker: FIXED_PROPORTIONAL + Modifier — Anzeige 21,00 / Engine 22,50', () => {
    const line = makeFixedBundle(3, true)
    expect(calculateArticlePrice(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(21.0)
    expect(computeOrderTax(makeOrder([line])).brutto).toBeCloseTo(22.5, 5)
  })

  it.todo(
    'DRIFT: Prozentrabatt-Halbcent — Anzeige rundet den Endbetrag (toFixed), Engine rundet den Rabattbetrag ' +
      '(Math.round, half-up): 9,99 −50 % → 5,00 vs 4,99 · 1,25 −10 % → 1,13 vs 1,12 · 3×2,35 −30 % → 4,94 vs 4,93',
  )
  it('Anker: Halbcent-Rabattfälle — Anzeige und Engine liegen je 1 Cent auseinander', () => {
    const cases: Array<[number, number, number, number, number]> = [
      // [preis, menge, rabattProzent, anzeige, engineBrutto]
      [9.99, 1, 50, 5.0, 4.99],
      [1.25, 1, 10, 1.13, 1.12],
      [2.35, 3, 30, 4.94, 4.93],
    ]
    for (const [price, amount, discountPercent, expectedDisplay, expectedEngine] of cases) {
      const discount: Discount = { discountType: DiscountType.PERCENT, discount: discountPercent }
      const order = makeOrder([makeLine(price, amount)], discount)
      const display = calculateSumPriceWithDiscountDetails(order, GENERAL_SIDE, GENERAL_DRINK)
      expect(display, `${price}×${amount} −${discountPercent}%`).toBe(expectedDisplay)
      expect(computeOrderTax(order).brutto, `${price}×${amount} −${discountPercent}%`).toBeCloseTo(expectedEngine, 5)
    }
  })

  // AUFGELÖST (Engine-Fix, Entscheidung 2026-07-04): Beilage/Getränk zählen jetzt
  // auch in der Engine PRO Menü — Anzeige und Engine stimmen überein.
  it('Menü ×2 — Beilage/Getränk PRO Menü: Anzeige 17,00 == Engine 17,00', () => {
    const line = makeLine(5.0, 2, { isMenu: true, menuSideDish: makeGeneric(1.5), menuDrink: makeGeneric(2.0) })
    expect(calculateArticlePrice(line, 1.5, 2.0)).toBe(17.0)
    expect(computeOrderTax(makeOrder([line])).brutto).toBeCloseTo(17.0, 5)
  })

  it.todo(
    'DRIFT: Menü-General-Preis-Fallback — Anzeige schlägt generalMenuSideDish-/DrinkPrice auch OHNE ' +
      'Beilage/Getränk-Objekt auf (7,50 €); die Engine kennt keine General-Preise (Brutto 5,00 €)',
  )
  it('Anker: Menü ohne Beilage/Getränk-Objekt — Anzeige 7,50 / Engine 5,00', () => {
    const line = makeLine(5.0, 1, { isMenu: true })
    expect(calculateArticlePrice(line, GENERAL_SIDE, GENERAL_DRINK)).toBe(7.5)
    expect(computeOrderTax(makeOrder([line])).brutto).toBeCloseTo(5.0, 5)
  })
})
