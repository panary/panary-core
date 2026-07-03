import { describe, expect, it } from 'vitest'
import { GenericOrderLineItem, LineComponent, Order, OrderLineItem } from '../order.schema'
import { computeOrderTax } from './compute-order-tax'
import { fixedBundleMainWeight, withFixedBundleMainComponent } from './fixed-bundle-main'

function makeComponent(price: number, amount = 1, partial: Partial<LineComponent> = {}): LineComponent {
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
    ...(makeComponent(price, amount, { taxInside, taxOutside }) as GenericOrderLineItem),
    productGroupExternalId: '00000000-0000-0000-0000-000000000002',
    bundleNumber: null,
    modifiers: [],
    isMenu: false,
    menuDrink: null,
    menuSideDish: null,
    ...partial,
  } as OrderLineItem
}

function makeOrder(lineItems: OrderLineItem[]): Order {
  return { lineItems, dineLocation: 'dine-in', discount: null } as unknown as Order
}

const roundCents = (euro: number) => Math.round(euro * 100)

describe('fixedBundleMainWeight — Restbetrags-Gewicht', () => {
  it('Restbetrag: Festpreis 7,00 − Komponenten (2,30 + 0,90) → 3,80', () => {
    const w = fixedBundleMainWeight(7.0, undefined, [makeComponent(2.3), makeComponent(0.9)])
    expect(w).toBe(3.8)
  })

  it('explizites mainPrice hat Vorrang vor dem Restbetrag', () => {
    const w = fixedBundleMainWeight(7.0, 4.4, [makeComponent(2.3), makeComponent(0.9)])
    expect(w).toBe(4.4)
  })

  it('klemmt auf 0, wenn Σ Komponenten (8,00) > Festpreis (7,00)', () => {
    const w = fixedBundleMainWeight(7.0, undefined, [makeComponent(5.0), makeComponent(3.0)])
    expect(w).toBe(0)
  })

  it('skaliert Komponenten mit amount (2 × 2,30 → Rest 2,40)', () => {
    const w = fixedBundleMainWeight(7.0, undefined, [makeComponent(2.3, 2)])
    expect(w).toBe(2.4)
  })

  it('Float-Kante 0,1 + 0,2: Rest ist EXAKT 0 (kein -4.4e-17-Drift)', () => {
    // Naive Float-Arithmetik: 0.3 - (0.1 + 0.2) === -5.55e-17 — cents-intern exakt 0.
    expect(0.1 + 0.2).not.toBe(0.3)
    const w = fixedBundleMainWeight(0.3, undefined, [makeComponent(0.1), makeComponent(0.2)])
    expect(w).toBe(0)
  })

  it('Float-Kante 4,10 − 2,20: Rest ist EXAKT 1,90', () => {
    // Naive Float-Arithmetik: 4.1 - 2.2 === 1.9000000000000004 — cents-intern exakt 1.9.
    expect(4.1 - 2.2).not.toBe(1.9)
    const w = fixedBundleMainWeight(4.1, undefined, [makeComponent(2.2)])
    expect(w).toBe(1.9)
  })

  it('fehlender/leerer Festpreis → 0 (geklemmt)', () => {
    expect(fixedBundleMainWeight(undefined, undefined, [makeComponent(2.3)])).toBe(0)
    expect(fixedBundleMainWeight(0, undefined, [])).toBe(0)
  })
})

describe('withFixedBundleMainComponent — main-Komponente', () => {
  it('fügt main mit Restgewicht an ERSTER Stelle ein; Eingabe bleibt unmutiert', () => {
    const input = [makeComponent(2.3), makeComponent(0.9)]
    const result = withFixedBundleMainComponent(input, makeComponent(0, 1, { topic: 'main' }), 7.0, undefined)
    expect(result).toHaveLength(3)
    expect(result[0].role).toBe('main')
    expect(result[0].price).toBe(3.8)
    expect(input).toHaveLength(2)
  })

  it('Idempotenz: existierende role main → kein zweites Element, Inhalt unverändert', () => {
    const once = withFixedBundleMainComponent(
      [makeComponent(2.3), makeComponent(0.9)],
      makeComponent(0, 1, { topic: 'main' }),
      7.0,
      undefined,
    )
    const twice = withFixedBundleMainComponent(once, makeComponent(0, 1, { topic: 'main' }), 7.0, undefined)
    expect(twice).toHaveLength(3)
    expect(twice.filter(c => c.role === 'main')).toHaveLength(1)
    expect(twice).toEqual(once)
  })
})

describe('withFixedBundleMainComponent — Integration mit computeOrderTax (Writer-Output)', () => {
  it('Komponenten 2,30 + 0,90 bei Festpreis 7,00 → main 3,80 und Engine-Brutto == 7,00', () => {
    const components = withFixedBundleMainComponent(
      [
        makeComponent(2.3, 1, { taxInside: 19, taxOutside: 19 }), // Getränk 19 %
        makeComponent(0.9, 1, { taxInside: 7, taxOutside: 7 }), // Beilage 7 %
      ],
      makeComponent(0, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
      7.0,
      undefined,
    )
    expect(components[0].price).toBe(3.8)

    const line = makeLine(7.0, 1, 7, 7, { bundlePricingMode: 'FIXED_PROPORTIONAL', components })
    const r = computeOrderTax(makeOrder([line]))
    // Σ Gewichte (380+230+90) == Festpreis → jede Komponente zum Normalpreis, Brutto exakt Festpreis.
    expect(roundCents(r.brutto)).toBe(700)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, roundCents(t.amount + t.tax)]))
    expect(byRate[19]).toBe(230) // Getränk
    expect(byRate[7]).toBe(470) // main 3,80 + Beilage 0,90
    // Tax-Integrität: netto + steuer === brutto (cent-genau)
    const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
    expect(roundCents(r.netto) + taxCents).toBe(roundCents(r.brutto))
  })

  it('Σ Komponenten 8,00 > Festpreis 7,00 → main 0; Verteilung nur über die übrigen Komponenten', () => {
    const components = withFixedBundleMainComponent(
      [
        makeComponent(5.0, 1, { taxInside: 19, taxOutside: 19 }),
        makeComponent(3.0, 1, { taxInside: 7, taxOutside: 7 }),
      ],
      makeComponent(0, 1, { taxInside: 7, taxOutside: 7, topic: 'main' }),
      7.0,
      undefined,
    )
    expect(components[0].price).toBe(0)

    const line = makeLine(7.0, 1, 7, 7, { bundlePricingMode: 'FIXED_PROPORTIONAL', components })
    const r = computeOrderTax(makeOrder([line]))
    // Gelocktes Verhalten: die preislose main-Komponente fällt aus der Gewichtung
    // (Engine filtert !!price) → 700 verteilt über [500, 300] (largest-remainder,
    // Rest-Cent an Index 0) → 438 + 262. Das Hauptgericht trägt damit KEINEN
    // Steueranteil — die Verteilung kippt komplett auf Getränk/Beilage.
    expect(roundCents(r.brutto)).toBe(700)
    const byRate = Object.fromEntries(r.taxes.map(t => [t.taxRate, roundCents(t.amount + t.tax)]))
    expect(byRate[19]).toBe(438)
    expect(byRate[7]).toBe(262)
    const taxCents = r.taxes.reduce((s, t) => s + roundCents(t.tax), 0)
    expect(roundCents(r.netto) + taxCents).toBe(roundCents(r.brutto))
  })
})
