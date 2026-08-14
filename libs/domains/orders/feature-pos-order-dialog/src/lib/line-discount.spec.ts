import { describe, expect, it } from 'vitest'
import type { AppliedDiscount, Order, OrderLineItem } from '@panary/orders/domain'
import { computeOrderTax } from '@panary/orders/domain'
import type { Discount as ManagedDiscount } from '@panary/discounts/domain'
import {
  LINE_DISCOUNT_BLOCKED_AMBIGUOUS,
  LINE_DISCOUNT_BLOCKED_NO_SELECTION,
  LINE_DISCOUNT_BLOCKED_STAFF_MEAL,
  buildLineAppliedDiscount,
  buildLineAppliedDiscounts,
  evaluateLineDiscountGate,
  pruneLineDiscounts,
  removeLineDiscount,
  setLineDiscount,
} from './line-discount'

const LINE_A = '00000000-0000-0000-0000-00000000000a'
const LINE_B = '00000000-0000-0000-0000-00000000000b'

function managed(partial: Partial<ManagedDiscount> = {}): ManagedDiscount {
  return {
    _id: '00000000-0000-0000-0000-0000000000d1',
    name: 'Kulanz 20 %',
    valueType: 'percent',
    valuePercent: 20,
    valueCents: 0,
    isStaffMeal: false,
    target: 'line',
    ...partial,
  } as ManagedDiscount
}

describe('evaluateLineDiscountGate', () => {
  it('sperrt bei Personalessen — die Bestellung trägt genau den zugewiesenen Rabatt', () => {
    const gate = evaluateLineDiscountGate({
      isStaffMealOrder: true,
      selectedLineItemId: LINE_A,
      lineItemIds: [LINE_A],
    })
    expect(gate).toEqual({ allowed: false, message: LINE_DISCOUNT_BLOCKED_STAFF_MEAL })
  })

  it('sperrt ohne markierte Zeile', () => {
    const gate = evaluateLineDiscountGate({
      isStaffMealOrder: false,
      selectedLineItemId: null,
      lineItemIds: [LINE_A],
    })
    expect(gate).toEqual({ allowed: false, message: LINE_DISCOUNT_BLOCKED_NO_SELECTION })
  })

  // Der Fall, der sonst still falsch rechnet: zwei Bundle-Zeilen desselben
  // Produkts teilen sich die `_id`, und computeOrderTax zöge den Rabatt von
  // beiden ab.
  it('sperrt, wenn die Zeilen-ID mehrfach im Warenkorb vorkommt', () => {
    const gate = evaluateLineDiscountGate({
      isStaffMealOrder: false,
      selectedLineItemId: LINE_A,
      lineItemIds: [LINE_A, LINE_B, LINE_A],
    })
    expect(gate).toEqual({ allowed: false, message: LINE_DISCOUNT_BLOCKED_AMBIGUOUS })
  })

  it('lässt eindeutige Zeilen durch', () => {
    const gate = evaluateLineDiscountGate({
      isStaffMealOrder: false,
      selectedLineItemId: LINE_A,
      lineItemIds: [LINE_A, LINE_B],
    })
    expect(gate).toEqual({ allowed: true })
  })
})

describe('buildLineAppliedDiscount', () => {
  it('erzeugt einen LINE-Snapshot ohne eigenen Betrag (die Engine füllt ihn)', () => {
    const snapshot = buildLineAppliedDiscount(managed(), {
      id: '00000000-0000-0000-0000-0000000000s1',
      lineItemId: LINE_A,
      appliedBy: 'user-1',
      appliedAt: '2026-08-14T10:00:00.000Z',
    })
    expect(snapshot).toMatchObject({
      target: 'line',
      lineItemId: LINE_A,
      method: 'manual',
      valueType: 'percent',
      valuePercent: 20,
      valueCents: 0,
      computedAmountCents: 0,
      appliedBy: 'user-1',
    })
  })

  it('trägt Festbeträge in valueCents und lässt valuePercent bei 0', () => {
    const snapshot = buildLineAppliedDiscount(managed({ valueType: 'amount', valueCents: 150, valuePercent: 0 }), {
      id: '00000000-0000-0000-0000-0000000000s2',
      lineItemId: LINE_A,
    })
    expect(snapshot.valueCents).toBe(150)
    expect(snapshot.valuePercent).toBe(0)
  })

  // Ein Positionsrabatt mit isStaffMeal:true liesse findStaffMealDiscountConflict
  // einen zweiten Personalessen-Rabatt sehen und die Bestellung abweisen.
  it('setzt isStaffMeal immer auf false, auch wenn die Definition es trägt', () => {
    const snapshot = buildLineAppliedDiscount(managed({ isStaffMeal: true }), {
      id: '00000000-0000-0000-0000-0000000000s3',
      lineItemId: LINE_A,
    })
    expect(snapshot.isStaffMeal).toBe(false)
  })
})

describe('LineDiscountMap — einer je Zeile', () => {
  it('ersetzt einen bestehenden Rabatt derselben Zeile statt zu stapeln', () => {
    const first = setLineDiscount({}, LINE_A, managed({ name: 'Kulanz 20 %' }))
    const second = setLineDiscount(first, LINE_A, managed({ name: 'Kulanz 50 %', valuePercent: 50 }))
    expect(Object.keys(second)).toEqual([LINE_A])
    expect(second[LINE_A].name).toBe('Kulanz 50 %')
  })

  it('hält Rabatte verschiedener Zeilen auseinander', () => {
    const map = setLineDiscount(setLineDiscount({}, LINE_A, managed()), LINE_B, managed({ valuePercent: 10 }))
    expect(Object.keys(map).sort()).toEqual([LINE_A, LINE_B].sort())
  })

  it('entfernt gezielt eine Zeile', () => {
    const map = setLineDiscount(setLineDiscount({}, LINE_A, managed()), LINE_B, managed())
    expect(Object.keys(removeLineDiscount(map, LINE_A))).toEqual([LINE_B])
  })

  it('gibt dieselbe Map zurück, wenn nichts zu entfernen ist', () => {
    const map = setLineDiscount({}, LINE_A, managed())
    expect(removeLineDiscount(map, LINE_B)).toBe(map)
  })

  it('räumt Rabatte gelöschter Zeilen weg', () => {
    const map = setLineDiscount(setLineDiscount({}, LINE_A, managed()), LINE_B, managed())
    expect(Object.keys(pruneLineDiscounts(map, [LINE_B]))).toEqual([LINE_B])
  })

  it('lässt die Map unangetastet, wenn alle Zeilen noch da sind', () => {
    const map = setLineDiscount({}, LINE_A, managed())
    expect(pruneLineDiscounts(map, [LINE_A, LINE_B])).toBe(map)
  })

  it('baut die Snapshots in Warenkorb-Reihenfolge und nur für rabattierte Zeilen', () => {
    const map = setLineDiscount({}, LINE_B, managed())
    let seq = 0
    const applied = buildLineAppliedDiscounts(map, [LINE_A, LINE_B], { newId: () => `id-${++seq}` })
    expect(applied).toHaveLength(1)
    expect(applied[0].lineItemId).toBe(LINE_B)
  })
})

// ── Gegenprobe an der kanonischen Engine ────────────────────────────────────
// Die Vorschau im Dialog ruft dieselbe Funktion; diese Tests halten fest, was
// sie bei kombinierten Rabatten liefert.

function makeLine(id: string, price: number, amount: number, taxInside: number): OrderLineItem {
  return {
    _id: id,
    externalId: '00000000-0000-0000-0000-000000000001',
    amount,
    name: 'x',
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside,
    taxOutside: 7,
    topic: '',
    productGroupExternalId: '00000000-0000-0000-0000-000000000002',
    bundleNumber: null,
    modifiers: [],
    isMenu: false,
    menuDrink: null,
    menuSideDish: null,
  } as unknown as OrderLineItem
}

function makeOrder(lineItems: OrderLineItem[], appliedDiscounts: AppliedDiscount[]): Order {
  return { lineItems, dineLocation: 'dine-in', appliedDiscounts } as unknown as Order
}

describe('Positionsrabatt in computeOrderTax', () => {
  it('zieht nur von der markierten Zeile ab', () => {
    const applied = buildLineAppliedDiscounts(
      setLineDiscount({}, LINE_A, managed({ valuePercent: 50 })),
      [LINE_A, LINE_B],
      { newId: () => '00000000-0000-0000-0000-0000000000s1' },
    )
    const result = computeOrderTax(makeOrder([makeLine(LINE_A, 10, 1, 19), makeLine(LINE_B, 10, 1, 19)], applied))
    expect(result.brutto).toBeCloseTo(15, 5)
    expect(applied[0].computedAmountCents).toBe(500)
  })

  // LINE vor ORDER, und der Order-Rabatt greift auf die BEREITS reduzierte Summe:
  // 20 % auf Zeile A (10 → 8), Zwischensumme 16, davon 10 % → 14,40.
  // Die naheliegende Lesart „beide Rabatte auf die Ausgangssumme 18" ergäbe 14,20 —
  // 20 Cent Unterschied, die auf dem Bon niemandem auffallen.
  it('kombiniert Positions- und Order-Rabatt in Engine-Reihenfolge', () => {
    const lineApplied = buildLineAppliedDiscounts(
      setLineDiscount({}, LINE_A, managed({ valuePercent: 20 })),
      [LINE_A],
      {
        newId: () => '00000000-0000-0000-0000-0000000000s1',
      },
    )
    const orderApplied: AppliedDiscount = {
      ...lineApplied[0],
      _id: '00000000-0000-0000-0000-0000000000s2',
      target: 'order',
      lineItemId: null,
      valuePercent: 10,
    }
    const applied = [...lineApplied, orderApplied]
    const result = computeOrderTax(makeOrder([makeLine(LINE_A, 10, 1, 19), makeLine(LINE_B, 8, 1, 19)], applied))
    expect(result.brutto).toBeCloseTo(14.4, 5)
    expect(applied[0].computedAmountCents).toBe(200)
    expect(applied[1].computedAmountCents).toBe(160)
  })

  it('hält den MwSt-Split cent-genau, wenn die rabattierte Zeile einen eigenen Satz hat', () => {
    const applied = buildLineAppliedDiscounts(setLineDiscount({}, LINE_A, managed({ valuePercent: 50 })), [LINE_A], {
      newId: () => '00000000-0000-0000-0000-0000000000s1',
    })
    const result = computeOrderTax(makeOrder([makeLine(LINE_A, 10, 1, 19), makeLine(LINE_B, 10, 1, 7)], applied))
    const sum = result.taxes.reduce((acc, t) => acc + t.amount + t.tax, 0)
    expect(sum).toBeCloseTo(result.brutto, 5)
    // Nur der 19-%-Eimer sinkt; der 7-%-Eimer bleibt unberührt.
    expect(
      result.taxes.find(t => t.taxRate === 19)!.amount + result.taxes.find(t => t.taxRate === 19)!.tax,
    ).toBeCloseTo(5, 5)
    expect(result.taxes.find(t => t.taxRate === 7)!.amount + result.taxes.find(t => t.taxRate === 7)!.tax).toBeCloseTo(
      10,
      5,
    )
  })

  it('klemmt einen Festbetrag über dem Positionsbrutto auf die Zeile', () => {
    const applied = buildLineAppliedDiscounts(
      setLineDiscount({}, LINE_A, managed({ valueType: 'amount', valueCents: 5000, valuePercent: 0 })),
      [LINE_A],
      { newId: () => '00000000-0000-0000-0000-0000000000s1' },
    )
    const result = computeOrderTax(makeOrder([makeLine(LINE_A, 10, 1, 19), makeLine(LINE_B, 10, 1, 19)], applied))
    expect(result.brutto).toBeCloseTo(10, 5)
  })
})
