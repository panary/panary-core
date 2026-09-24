import { describe, expect, it } from 'vitest'
import { effectiveLineItems, remainingLineAmount } from './effective-line-items'
import { OrderSplitError, OrderSplitErrorCode, isPartiallySplittable, planOrderSplit } from './order-split'
import type { AppliedDiscount, GenericOrderLineItem, Order, OrderLineItem, OrderSplitOff } from './order.schema'
import { OrderStatus } from './order.schema'
import { computeOrderTax } from './pricing/compute-order-tax'
import { toCents } from './pricing/money'

//#region Fixtures
let idCounter = 0
const newId = () => `aaaaaaaa-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`

function makeGeneric(price: number, amount = 1, partial: Partial<GenericOrderLineItem> = {}): GenericOrderLineItem {
  return {
    _id: newId(),
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
  partial: Partial<OrderLineItem> = {},
): OrderLineItem {
  return {
    ...makeGeneric(price, amount, { taxInside, taxOutside: taxInside }),
    productGroupExternalId: '00000000-0000-0000-0000-000000000002',
    bundleNumber: null,
    modifiers: [],
    isMenu: false,
    menuDrink: null,
    menuSideDish: null,
    ...partial,
  } as OrderLineItem
}

function makeOrder(lineItems: OrderLineItem[], partial: Partial<Order> = {}): Order {
  return {
    _id: 'source-order',
    status: OrderStatus.ACTIVE,
    dineLocation: 'dine-in',
    lineItems,
    ...partial,
  } as unknown as Order
}

function makeOrderDiscount(partial: Partial<AppliedDiscount> = {}): AppliedDiscount {
  return {
    _id: newId(),
    name: 'Rabatt',
    method: 'manual',
    target: 'order',
    valueType: 'percent',
    valuePercent: 0,
    valueCents: 0,
    computedAmountCents: 0,
    appliedAt: '2026-09-24T10:00:00.000Z',
    ...partial,
  } as AppliedDiscount
}

const PLAN = { targetOrderId: 'target-order', splitAt: '2026-09-24T12:00:00.000Z', newId }
const cents = (euro: number) => toCents(euro)
//#endregion

describe('effectiveLineItems — die einzige Fassung von „was traegt der Vorgang noch"', () => {
  it('gibt ohne splitOff das Original-Array unveraendert zurueck (Bestandsverhalten)', () => {
    const lines = [makeLine(1.19, 2, 19)]
    const order = makeOrder(lines)
    expect(effectiveLineItems(order)).toBe(lines)
  })

  it('zieht eine Teilmenge ab, ohne die Quellzeile zu veraendern (A5)', () => {
    const line = makeLine(2.0, 5, 19)
    const order = makeOrder([line], {
      splitOff: [{ _id: 's1', targetOrderId: 't', lineItemRowId: line._id, amount: 3, grossCents: 600, splitAt: 'x' }],
    })
    expect(effectiveLineItems(order)[0].amount).toBe(2)
    // Die Quellzeile selbst bleibt unangetastet — genau das verlangt A5.
    expect(order.lineItems[0].amount).toBe(5)
  })

  it('laesst eine vollstaendig abgegebene Zeile aus der Ableitung fallen, behaelt sie aber in lineItems', () => {
    const line = makeLine(2.0, 2, 19)
    const order = makeOrder([line], {
      splitOff: [{ _id: 's1', targetOrderId: 't', lineItemRowId: line._id, amount: 2, grossCents: 400, splitAt: 'x' }],
    })
    expect(effectiveLineItems(order)).toHaveLength(0)
    expect(order.lineItems).toHaveLength(1)
  })

  it('summiert mehrere Gegenbuchungen derselben Zeile', () => {
    const line = makeLine(1.0, 5, 19)
    const splitOff: OrderSplitOff[] = [
      { _id: 's1', targetOrderId: 't1', lineItemRowId: line._id, amount: 1, grossCents: 100, splitAt: 'x' },
      { _id: 's2', targetOrderId: 't2', lineItemRowId: line._id, amount: 2, grossCents: 200, splitAt: 'x' },
    ]
    const order = makeOrder([line], { splitOff })
    expect(effectiveLineItems(order)[0].amount).toBe(2)
    expect(remainingLineAmount(order, line._id)).toBe(2)
  })
})

describe('computeOrderTax nach einem Split', () => {
  it('weist nur noch den Rest aus — ohne diese Kopplung bliebe die volle Steuer stehen (A13)', () => {
    const line = makeLine(2.0, 5, 19)
    const before = computeOrderTax(makeOrder([line]))
    expect(cents(before.brutto)).toBe(1000)

    const after = computeOrderTax(
      makeOrder([line], {
        splitOff: [
          { _id: 's1', targetOrderId: 't', lineItemRowId: line._id, amount: 3, grossCents: 600, splitAt: 'x' },
        ],
      }),
    )
    expect(cents(after.brutto)).toBe(400)
  })
})

describe('planOrderSplit — Vorbedingungen (A6)', () => {
  it.each([
    [OrderStatus.COMPLETED, 'abgeschlossene'],
    [OrderStatus.ABORTED, 'stornierte'],
  ])('lehnt %s Bestellungen mit sprechendem Code ab', status => {
    const line = makeLine(1.19, 2, 19)
    const order = makeOrder([line, makeLine(1.19, 1, 19)], { status })
    expect(() => planOrderSplit(order, [{ lineItemRowId: line._id }], PLAN)).toThrow(OrderSplitError)
    try {
      planOrderSplit(order, [{ lineItemRowId: line._id }], PLAN)
    } catch (error) {
      expect((error as OrderSplitError).code).toBe(OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE)
    }
  })

  it('lehnt eine leere Auswahl ab', () => {
    const order = makeOrder([makeLine(1.19, 1, 19)])
    expect(() => planOrderSplit(order, [], PLAN)).toThrow(/Auswahl ist leer/)
  })

  it('lehnt eine unbekannte Zeile ab', () => {
    const order = makeOrder([makeLine(1.19, 1, 19)])
    try {
      planOrderSplit(order, [{ lineItemRowId: 'gibt-es-nicht' }], PLAN)
      expect.unreachable()
    } catch (error) {
      expect((error as OrderSplitError).code).toBe(OrderSplitErrorCode.UNKNOWN_LINE)
    }
  })

  it('lehnt mehr Menge ab, als die Zeile noch traegt', () => {
    const line = makeLine(1.19, 2, 19)
    const order = makeOrder([line, makeLine(1.07, 1, 7)])
    try {
      planOrderSplit(order, [{ lineItemRowId: line._id, amount: 3 }], PLAN)
      expect.unreachable()
    } catch (error) {
      expect((error as OrderSplitError).code).toBe(OrderSplitErrorCode.AMOUNT_EXCEEDS_REMAINDER)
    }
  })

  it('lehnt einen Split ab, der die Quelle leer zuruecklaesst — das waere eine Umbuchung', () => {
    const line = makeLine(1.19, 2, 19)
    const order = makeOrder([line])
    try {
      planOrderSplit(order, [{ lineItemRowId: line._id }], PLAN)
      expect.unreachable()
    } catch (error) {
      expect((error as OrderSplitError).code).toBe(OrderSplitErrorCode.NOTHING_REMAINS)
    }
  })

  it('lehnt dieselbe Zeile zweimal in einer Auswahl ab', () => {
    const line = makeLine(1.19, 4, 19)
    const order = makeOrder([line, makeLine(1.07, 1, 7)])
    try {
      planOrderSplit(
        order,
        [
          { lineItemRowId: line._id, amount: 1 },
          { lineItemRowId: line._id, amount: 1 },
        ],
        PLAN,
      )
      expect.unreachable()
    } catch (error) {
      expect((error as OrderSplitError).code).toBe(OrderSplitErrorCode.DUPLICATE_LINE)
    }
  })
})

describe('planOrderSplit — gemischte Steuersaetze', () => {
  it('teilt cent-genau und traegt je Satz den richtigen Eimer', () => {
    const speise = makeLine(10.7, 1, 7)
    const getraenk = makeLine(11.9, 1, 19)
    const zweiteSpeise = makeLine(5.35, 1, 7)
    const order = makeOrder([speise, getraenk, zweiteSpeise])
    const before = computeOrderTax(order)

    const plan = planOrderSplit(order, [{ lineItemRowId: getraenk._id }], PLAN)

    // Summenprobe: Quelle + Ziel === Ursprung.
    expect(cents(plan.sourceTaxSnapshot.brutto) + cents(plan.targetTaxSnapshot.brutto)).toBe(cents(before.brutto))
    expect(plan.roundingRemainderCents).toBe(0)

    // 🚨 Gegen die EIMER pruefen, nicht gegen die Summe: „Σ netto + Σ steuer ===
    // brutto" haelt auch bei falscher Formel und beweist die Methode nicht.
    expect(plan.targetTaxSnapshot.taxes).toHaveLength(1)
    expect(plan.targetTaxSnapshot.taxes[0].taxRate).toBe(19)
    expect(cents(plan.targetTaxSnapshot.taxes[0].tax)).toBe(190)

    expect(plan.sourceTaxSnapshot.taxes).toHaveLength(1)
    expect(plan.sourceTaxSnapshot.taxes[0].taxRate).toBe(7)
    expect(cents(plan.sourceTaxSnapshot.brutto)).toBe(cents(16.05))
  })

  it('gibt der Zielzeile eine neue _id, behaelt aber die Artikelidentitaet (ADR 0033)', () => {
    const a = makeLine(2.0, 5, 19)
    const order = makeOrder([a, makeLine(1.0, 1, 7)])
    const plan = planOrderSplit(order, [{ lineItemRowId: a._id, amount: 3 }], PLAN)

    expect(plan.targetLineItems).toHaveLength(1)
    expect(plan.targetLineItems[0]._id).not.toBe(a._id)
    expect(plan.targetLineItems[0].externalId).toBe(a.externalId)
    expect(plan.targetLineItems[0].amount).toBe(3)
    expect(plan.splitOffEntries[0].lineItemRowId).toBe(a._id)
    expect(plan.splitOffEntries[0].amount).toBe(3)
    expect(plan.splitOffEntries[0].grossCents).toBe(600)
  })
})

describe('planOrderSplit — Modifier', () => {
  const modifier = () => makeGeneric(0.5, 1, { name: 'Extra Kaese', taxInside: 19, taxOutside: 19 })

  it('verschiebt eine ganze Modifier-Zeile mit dem EIGENEN amount des Modifiers (nicht x Hauptmenge)', () => {
    const line = makeLine(4.0, 2, 19, { modifiers: [modifier()] })
    const order = makeOrder([line, makeLine(1.0, 1, 7)])
    const plan = planOrderSplit(order, [{ lineItemRowId: line._id }], PLAN)

    // 2 x 4,00 + 1 x 0,50 = 8,50 — NICHT 2 x (4,00 + 0,50) = 9,00.
    expect(cents(plan.targetTaxSnapshot.brutto)).toBe(850)
    expect(plan.targetLineItems[0].modifiers).toHaveLength(1)
  })

  it('lehnt die TEILmenge einer Modifier-Zeile ab — sonst erfaende der Split Umsatz', () => {
    const line = makeLine(4.0, 2, 19, { modifiers: [modifier()] })
    const order = makeOrder([line, makeLine(1.0, 1, 7)])
    expect(isPartiallySplittable(line)).toBe(false)
    try {
      planOrderSplit(order, [{ lineItemRowId: line._id, amount: 1 }], PLAN)
      expect.unreachable()
    } catch (error) {
      expect((error as OrderSplitError).code).toBe(OrderSplitErrorCode.PARTIAL_SPLIT_UNSUPPORTED)
    }
  })
})

describe('planOrderSplit — Rabatte (A12)', () => {
  it('teilt einen Prozent-Gesamtrabatt so, dass die Eimer beider Seiten je Satz stimmen', () => {
    const speise = makeLine(10.7, 1, 7)
    const getraenk = makeLine(11.9, 1, 19)
    const order = makeOrder([speise, getraenk, makeLine(5.35, 1, 7)], {
      appliedDiscounts: [makeOrderDiscount({ valueType: 'percent', valuePercent: 10 })],
    })
    const before = computeOrderTax(structuredClone(order))

    const plan = planOrderSplit(order, [{ lineItemRowId: getraenk._id }], PLAN)

    expect(plan.targetAppliedDiscounts).toHaveLength(1)
    expect(plan.targetAppliedDiscounts[0].valuePercent).toBe(10)
    // 11,90 − 10 % = 10,71 brutto @19 %
    expect(cents(plan.targetTaxSnapshot.brutto)).toBe(1071)
    expect(plan.targetTaxSnapshot.taxes[0].taxRate).toBe(19)
    // Rest: 16,05 − 10 % (= 161 ct, die Engine rundet den ABZUG) = 14,44
    expect(cents(plan.sourceTaxSnapshot.brutto)).toBe(1444)
    expect(plan.sourceTaxSnapshot.taxes[0].taxRate).toBe(7)

    // A14: Die Differenz wird AUSGEWIESEN, nicht geglaettet.
    const summe = cents(plan.sourceTaxSnapshot.brutto) + cents(plan.targetTaxSnapshot.brutto)
    expect(summe + plan.roundingRemainderCents).toBe(cents(before.brutto))
  })

  it('weist den Rundungsrest aus, statt ihn auf eine Teilbestellung zu schieben (A14)', () => {
    // 2 x 1,05 € mit 10 %: als GANZE Bestellung 210 ct − 21 ct = 189 ct. Getrennt
    // gerechnet 105 − 11 = 94 je Seite, zusammen 188 ct. Der fehlende Cent ist
    // kein Fehler, sondern die Folge davon, dass zweimal gerundet wird — und er
    // bleibt stehen, weil eine Glaettung im Nachhinein nicht mehr von einem
    // Rechenfehler zu unterscheiden waere.
    const a = makeLine(1.05, 1, 19)
    const b = makeLine(1.05, 1, 19)
    const order = makeOrder([a, b], {
      appliedDiscounts: [makeOrderDiscount({ valueType: 'percent', valuePercent: 10 })],
    })
    const before = computeOrderTax(structuredClone(order))
    expect(cents(before.brutto)).toBe(189)

    const plan = planOrderSplit(order, [{ lineItemRowId: b._id }], PLAN)

    expect(cents(plan.sourceTaxSnapshot.brutto)).toBe(94)
    expect(cents(plan.targetTaxSnapshot.brutto)).toBe(94)
    expect(plan.roundingRemainderCents).toBe(1)
  })

  it('teilt einen Festbetrags-Gesamtrabatt summen-exakt (largest remainder)', () => {
    const a = makeLine(10.0, 1, 19)
    const b = makeLine(5.0, 1, 7)
    const order = makeOrder([a, b], {
      appliedDiscounts: [makeOrderDiscount({ valueType: 'fixed', valueCents: 301 })],
    })
    const before = computeOrderTax(structuredClone(order))

    const plan = planOrderSplit(order, [{ lineItemRowId: b._id }], PLAN)

    const sourceCents = plan.sourceAppliedDiscounts[0].valueCents
    const targetCents = plan.targetAppliedDiscounts[0].valueCents
    expect(sourceCents + targetCents).toBe(301)
    expect(cents(plan.sourceTaxSnapshot.brutto) + cents(plan.targetTaxSnapshot.brutto)).toBe(cents(before.brutto))
    expect(plan.roundingRemainderCents).toBe(0)
  })

  it('nimmt einen Positionsrabatt mit, wenn die ganze Zeile wandert — sonst bliebe er ohne Position stehen', () => {
    const a = makeLine(10.0, 1, 19)
    const b = makeLine(5.0, 1, 7)
    const order = makeOrder([a, b], {
      appliedDiscounts: [
        makeOrderDiscount({ target: 'line', lineItemId: b._id, valueType: 'percent', valuePercent: 20 }),
      ],
    })

    const plan = planOrderSplit(order, [{ lineItemRowId: b._id }], PLAN)

    expect(plan.sourceAppliedDiscounts).toHaveLength(0)
    expect(plan.targetAppliedDiscounts).toHaveLength(1)
    expect(plan.targetAppliedDiscounts[0].lineItemId).toBe(plan.targetLineItems[0]._id)
    expect(cents(plan.targetTaxSnapshot.brutto)).toBe(400)
  })

  it('weist bei 100 % Nachlass (Personalessen) KEINE Steuer aus — die leere Liste ist das Ergebnis, nicht „kein Snapshot"', () => {
    const a = makeLine(10.0, 1, 19)
    const b = makeLine(5.0, 1, 7)
    const order = makeOrder([a, b], {
      appliedDiscounts: [makeOrderDiscount({ valueType: 'percent', valuePercent: 100, isStaffMeal: true })],
    })

    const plan = planOrderSplit(order, [{ lineItemRowId: b._id }], PLAN)

    expect(plan.targetTaxSnapshot.taxes).toEqual([])
    expect(plan.targetTaxSnapshot.brutto).toBe(0)
    expect(plan.sourceTaxSnapshot.taxes).toEqual([])
    expect(plan.sourceTaxSnapshot.brutto).toBe(0)
  })
})

describe('planOrderSplit — Reinheit', () => {
  it('mutiert die uebergebene Bestellung nicht (auch nicht ueber den computedAmountCents-Seiteneffekt)', () => {
    const a = makeLine(10.0, 1, 19)
    const b = makeLine(5.0, 1, 7)
    const order = makeOrder([a, b], {
      appliedDiscounts: [makeOrderDiscount({ valueType: 'percent', valuePercent: 10 })],
    })
    const snapshot = structuredClone(order)

    planOrderSplit(order, [{ lineItemRowId: b._id }], PLAN)

    expect(order).toEqual(snapshot)
  })
})
