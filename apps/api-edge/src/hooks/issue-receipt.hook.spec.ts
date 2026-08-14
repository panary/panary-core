import { computeOrderTax, type Order } from '@panary/orders/domain'
import { buildReceiptSnapshot, ReceiptKind } from '@panary/receipts/domain'
import { describe, expect, it } from 'vitest'

import { orderToInput } from './issue-receipt.hook'

// Geld-Pfad-Spec ohne Mocks: verankert die Invariante aus panary/panary-core#236 —
// die Positionssummen des Belegs stammen aus derselben Cents-Quelle
// (`lineItemGrossCents`) wie der fiskalische `taxSnapshot`. Vorher rechnete der
// Beleg `amount × price` und ließ Modifier, Menü-Komponenten und Festpreis-Menüs
// weg; Σ Positionen wich dann von „Gesamt" ab, ganz ohne Rabatt.

const LOCATION = { name: 'Bäckerei Test', defaultCurrency: 'EUR' }

function makeLineItem(overrides: Record<string, unknown> = {}): any {
  return {
    _id: 'li-1',
    externalId: 'p-1',
    productGroupExternalId: 'pg-1',
    name: 'Testprodukt',
    amount: 1,
    price: 10,
    modifiers: [],
    taxInside: 19,
    taxOutside: 7,
    ...overrides,
  }
}

/**
 * Baut die Order so, wie sie den `issueReceipt`-Hook erreicht: mit dem
 * `taxSnapshot`, den `calculateTaxDetails` beim create geschrieben hat. `payment`
 * bleibt bewusst weg — sonst prüfte der Test gegen eine im Test selbst gesetzte
 * Zahl statt gegen die Engine.
 */
function withSnapshot(lineItems: any[], overrides: Record<string, unknown> = {}): any {
  const order = {
    _id: 'order-1',
    tenantId: 't-1',
    locationId: 'loc-1',
    status: 'completed',
    dailySequenceNumber: 7,
    orderChannel: 'pos',
    dineLocation: 'dine-in',
    currency: 'EUR',
    lineItems,
    ...overrides,
  }
  order.taxSnapshot = computeOrderTax(order as unknown as Order)
  return order
}

function snapshotOf(order: any) {
  return buildReceiptSnapshot({
    order: orderToInput(order),
    location: LOCATION,
    kind: ReceiptKind.SALE,
    issuedAt: '2026-08-15T10:00:00.000Z',
  })
}

const sumPositions = (core: { lineItems: Array<{ lineTotal: number }> }): number =>
  Math.round(core.lineItems.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100

describe('issueReceipt — Positionssummen aus der kanonischen Cents-Quelle (#236)', () => {
  it('zählt kostenpflichtige Modifier in die Positionssumme', () => {
    const order = withSnapshot([
      makeLineItem({
        price: 8.5,
        amount: 1,
        modifiers: [{ _id: 'm-1', name: 'Extra Käse', price: 0.5, amount: 1 }],
      }),
    ])
    const core = snapshotOf(order)

    expect(core.lineItems[0].lineTotal).toBe(9)
    // Der Basispreis allein wäre 8,50 — genau die Differenz, die vorher fehlte.
    expect(core.lineItems[0].unitPrice).toBe(8.5)
    expect(sumPositions(core)).toBe(core.totalGross)
  })

  it('rechnet Menü-Komponenten PRO Menü ab (Menge 2 → Aufpreise doppelt)', () => {
    const order = withSnapshot([
      makeLineItem({
        name: 'Burger-Menü',
        price: 7,
        amount: 2,
        components: [
          { _id: 'c-1', name: 'Pommes', price: 0.5, amount: 1, taxInside: 19, taxOutside: 7 },
          { _id: 'c-2', name: 'Cola', price: 1, amount: 1, taxInside: 19, taxOutside: 7 },
        ],
      }),
    ])
    const core = snapshotOf(order)

    // 2 × 7,00 + 2 × 0,50 + 2 × 1,00 = 17,00
    expect(core.lineItems[0].lineTotal).toBe(17)
    expect(sumPositions(core)).toBe(core.totalGross)
  })

  it('bildet Festpreis-Menüs (FIXED_PROPORTIONAL) mit dem Festpreis ab', () => {
    const order = withSnapshot([
      makeLineItem({
        name: 'Kombi-Menü',
        price: 9.9,
        amount: 1,
        bundlePricingMode: 'FIXED_PROPORTIONAL',
        components: [
          { _id: 'c-1', name: 'Hauptgericht', price: 8.5, amount: 1, taxInside: 7, taxOutside: 7 },
          { _id: 'c-2', name: 'Getränk', price: 2.9, amount: 1, taxInside: 19, taxOutside: 19 },
        ],
      }),
    ])
    const core = snapshotOf(order)

    expect(core.lineItems[0].lineTotal).toBe(9.9)
    expect(sumPositions(core)).toBe(core.totalGross)
    // Das Menü splittet über zwei Sätze — die Summe bleibt trotzdem der Festpreis.
    expect(core.taxSummary.taxes).toHaveLength(2)
  })

  it('trägt Legacy-Zeilen ohne components[] unverändert (menuSideDish/menuDrink)', () => {
    const order = withSnapshot([
      makeLineItem({
        name: 'Menü (legacy)',
        price: 6,
        amount: 2,
        menuSideDish: { _id: 's-1', name: 'Salat', price: 0.8, amount: 1, taxInside: 19, taxOutside: 7 },
        menuDrink: { _id: 'd-1', name: 'Wasser', price: 0, amount: 1, taxInside: 19, taxOutside: 7 },
      }),
    ])
    const core = snapshotOf(order)

    // 2 × 6,00 + 2 × 0,80 = 13,60 (Wasser preisneutral)
    expect(core.lineItems[0].lineTotal).toBe(13.6)
    expect(sumPositions(core)).toBe(core.totalGross)
  })

  it('mehrere Zeilen mit gemischten Sätzen: Σ Positionen === Gesamt', () => {
    const order = withSnapshot([
      makeLineItem({
        _id: 'li-19',
        price: 2.9,
        amount: 3,
        taxInside: 19,
        modifiers: [{ _id: 'm-1', name: 'Sirup', price: 0.4, amount: 2 }],
      }),
      makeLineItem({
        _id: 'li-7',
        price: 4.5,
        amount: 2,
        taxInside: 7,
        components: [{ _id: 'c-1', name: 'Dip', price: 0.6, amount: 1, taxInside: 7, taxOutside: 7 }],
      }),
    ])
    const core = snapshotOf(order)

    // 3 × 2,90 + 2 × 0,40 = 9,50  |  2 × 4,50 + 2 × 0,60 = 10,20
    expect(core.lineItems.map(l => l.lineTotal)).toEqual([9.5, 10.2])
    expect(sumPositions(core)).toBe(core.totalGross)
  })

  it('rabattiert: Σ Positionen − Nachlass === Gesamt (Positionen bleiben unrabattiert)', () => {
    const order = withSnapshot(
      [
        makeLineItem({
          price: 8.5,
          amount: 1,
          taxInside: 7,
          modifiers: [{ _id: 'm-1', name: 'Extra Käse', price: 0.5, amount: 1 }],
        }),
      ],
      { appliedDiscounts: [{ name: '20 % Rabatt', target: 'order', valueType: 'percent', valuePercent: 20 }] },
    )
    const core = snapshotOf(order)

    expect(sumPositions(core)).toBe(9)
    expect(core.discounts).toEqual([{ name: '20 % Rabatt', amount: 1.8 }])
    expect(sumPositions(core) - (core.discounts ?? []).reduce((s, d) => s + d.amount, 0)).toBeCloseTo(
      core.totalGross,
      2,
    )
  })

  it('100 % Nachlass: Gesamt 0,00 € ohne erfundene Steuerzeile', () => {
    const order = withSnapshot(
      [makeLineItem({ price: 4.5, amount: 2, taxInside: 7 })],
      { appliedDiscounts: [{ name: 'Personalessen', target: 'order', valueType: 'percent', valuePercent: 100 }] },
    )
    const core = snapshotOf(order)

    // computeOrderTax verwirft Eimer <= 0 → taxes: [] bei brutto 0. Der Beleg muss
    // diesen Snapshot übernehmen, statt auf den Positions-Fallback zurückzufallen
    // und die volle Steuer auf das unrabattierte Brutto auszuweisen.
    expect(core.taxSummary.taxes).toEqual([])
    expect(core.totalGross).toBe(0)
    expect(sumPositions(core)).toBe(9)
    expect(core.discounts).toEqual([{ name: 'Personalessen', amount: 9 }])
  })
})
