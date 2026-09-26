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
//
// Das Brutto hat neben den Positionen eine zweite Quelle, die der Split NICHT
// ableitet: `payment.totalAmount`, gelesen VOR dem `taxSnapshot`. Der letzte
// Block prueft deshalb, dass eine Quelle mit Zahlungsergebnis gar nicht erst
// gesplittet wird (#394).

import { describe, expect, it } from 'vitest'

import {
  OrderSplitError,
  OrderSplitErrorCode,
  OrderStatus,
  PaymentState,
  TransactionMethod,
  computeOrderTax,
  planOrderSplit,
  type Order,
  type OrderLineItem,
} from '@panary/orders/domain'

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

/** Platzhalter, den `orders.split` dem Ziel und `pre-orders.convert` jeder Bestellung mitgibt. */
const PAYMENT_PLACEHOLDER: Order['payment'] = {
  state: PaymentState.PENDING,
  totalAmount: 0,
  tipAmount: 0,
  transactions: [],
}

/**
 * Ursprung: 5 Broetchen (je 50 g Mehl) + 1 Pizza (200 g Mehl) mit Extra-Kaese
 * (30 g). Gesplittet werden 2 der 5 Broetchen (Teilmenge) und die ganze Pizza
 * samt Modifier — eine Zeile mit Modifier darf nur ganz wandern.
 *
 * `payment` ist per Default `null`: So steht eine offene POS-Bestellung vor dem
 * Kassieren in der Datenbank — gestempelt wird erst in `finalizeOrder()`,
 * zusammen mit `COMPLETED`. Der Fixture-Default (`paid` mit vollem Betrag) waere
 * bei `PRODUCED` genau der Zustand, den der Split seit #394 ablehnt. Der
 * Snapshot kommt aus der Engine, wie `calculateTaxDetails` ihn beim Anlegen
 * schreibt — nicht der synthetische Fixture-Wert.
 *
 * Quelle und Ziel sind nachgebaut wie `orders.split` sie hinterlaesst: Die Quelle
 * bekommt `splitOff`, die aufgeteilten Rabatte und den neu gerechneten Snapshot,
 * ihr `payment` bleibt, wie es war. Das Ziel entsteht mit dem Platzhalter.
 */
function splitScenario(payment: Order['payment'] = null) {
  idCounter = 0
  const roll = makeLine(PRODUCT_ROLL, 'Broetchen', 1, 5, { ingredientReferences: [ingredientRef(ING_FLOUR, 50)] })
  const cheese = {
    ...makeLine(PRODUCT_CHEESE, 'Extra Kaese', 0.5, 1, { ingredientReferences: [ingredientRef(ING_CHEESE, 30)] }),
  }
  const pizza = makeLine(PRODUCT_PIZZA, 'Pizza', 9, 1, {
    ingredientReferences: [ingredientRef(ING_FLOUR, 200)],
    modifiers: [cheese] as OrderLineItem['modifiers'],
  })

  const draft: Order = { ...makeOrder({ status: OrderStatus.PRODUCED, lineItems: [roll, pizza] }), payment }
  const original: Order = { ...draft, taxSnapshot: computeOrderTax(structuredClone(draft)) }
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
    payment: PAYMENT_PLACEHOLDER,
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

describe('Split-Konsistenz — Brutto mit Zahlungsergebnis an der Quelle (#394)', () => {
  // `getOrderGrossCents` liest `payment.totalAmount` VOR dem `taxSnapshot`, und
  // der Split laesst `payment` der Quelle stehen. Eine Quelle mit
  // Zahlungsergebnis zaehlte nach dem Split mit dem vollen Vor-Split-Betrag, das
  // Ziel mit seinem Anteil noch einmal.
  //
  // Gemessen auf `origin/main` @ 83ef248a, bevor die Sperre existierte — die
  // Faelle unten liefen dort durch den Split und lieferten:
  //   bezahlt / Anzahlung / Betrag bei pending:  Quelle 1450 + Ziel 1150 = 2600 ct, Ursprung 1450
  //   Transaktion ohne Betrag:                   Quelle    0 + Ziel 1150 = 1150 ct, Ursprung    0
  // Im Kassenbetrieb scheitert der Tagesabschluss daran (`financials.tax_split_mismatch`,
  // Diff 1150 ct); im Bestellbetrieb und in `computeStats` bleibt es still.
  //
  // Die Erwartung ist deshalb fuer jede Form ausdruecklich — kein „entweder
  // lehnt er ab oder die Summe stimmt": Ein Split, der ALLES ablehnte, bestuende
  // so einen Test ebenfalls.

  const TX_ID = '00000000-0000-7000-8000-0000000000c1'
  const cash = (amount: number) => ({
    _id: TX_ID,
    method: TransactionMethod.CASH,
    amount,
    currency: 'EUR',
    timestamp: '2026-09-25T11:00:00.000Z',
  })

  /** Was der Aggregator nach einem Split wie am Edge zaehlt — oder der Code, mit dem der Split ablehnt. */
  function grossAfterSplit(payment: Order['payment']) {
    let scenario: ReturnType<typeof splitScenario>
    try {
      scenario = splitScenario(payment)
    } catch (error) {
      if (error instanceof OrderSplitError) return { rejected: error.code }
      throw error
    }
    const { original, source, target } = scenario
    const sourceCents = getOrderGrossCents(source)
    const targetCents = getOrderGrossCents(target)
    return {
      grossCents: {
        original: getOrderGrossCents(original),
        source: sourceCents,
        target: targetCents,
        sum: sourceCents + targetCents,
      },
    }
  }

  it.each<[string, Order['payment']]>([
    ['ohne payment (offene POS-Bestellung)', null],
    ['Platzhalter (pre-orders.convert, Split-Ziel)', PAYMENT_PLACEHOLDER],
  ])('%s: der Split laeuft, Quelle + Ziel = Ursprung', (_label, payment) => {
    // 3 Broetchen bleiben (3,00 €); 2 Broetchen + Pizza mit Kaese wandern (11,50 €).
    expect(grossAfterSplit(payment)).toEqual({ grossCents: { original: 1450, source: 300, target: 1150, sum: 1450 } })
  })

  it.each<[string, Order['payment']]>([
    [
      'bezahlt, noch nicht abgeschlossen',
      { state: PaymentState.PAID, totalAmount: 14.5, tipAmount: 0, transactions: [cash(14.5)] },
    ],
    [
      'Anzahlung (partially_paid)',
      { state: PaymentState.PARTIALLY_PAID, totalAmount: 14.5, tipAmount: 0, transactions: [cash(5)] },
    ],
    [
      'Betrag gestempelt, Status pending',
      { state: PaymentState.PENDING, totalAmount: 14.5, tipAmount: 0, transactions: [] },
    ],
    [
      'Transaktion erfasst, Betrag 0',
      { state: PaymentState.PENDING, totalAmount: 0, tipAmount: 0, transactions: [cash(5)] },
    ],
  ])('%s: der Split lehnt ab, bevor der Aggregator doppelt zaehlen kann', (_label, payment) => {
    expect(grossAfterSplit(payment)).toEqual({ rejected: OrderSplitErrorCode.SOURCE_ALREADY_PAID })
  })
})
