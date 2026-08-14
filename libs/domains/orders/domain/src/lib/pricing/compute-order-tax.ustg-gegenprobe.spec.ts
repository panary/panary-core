import { describe, expect, it } from 'vitest'
import { AppliedDiscount, GenericOrderLineItem, Order, OrderLineItem } from '../order.schema'
import { computeOrderTax } from './compute-order-tax'

// Unabhängige Gegenprobe der MwSt-Extraktion (panary/panary-core#182).
//
// WARUM SEPARAT von `compute-order-tax.spec.ts`: Jene Datei prüft das Verhalten der Engine
// gegen Erwartungen, die beim Bau der Engine entstanden sind. Ein Vorzeichen- oder
// Methodenfehler bliebe darin unsichtbar, weil Erwartung und Implementierung derselben
// Herleitung entstammen. Die Werte HIER sind stattdessen von Hand nach der gesetzlichen
// Divisor-Methode gerechnet und als Rechenweg mitgeschrieben — jede Zeile ist ohne Blick in
// `money.ts` nachprüfbar.
//
// Rechtsgrundlage: § 10 Abs. 1 Satz 2 UStG — das Entgelt ist alles, was der Leistungs-
// empfänger aufwendet, ABZÜGLICH der darin enthaltenen Umsatzsteuer. Bei einem Bruttopreis B
// und Steuersatz p gilt deshalb
//
//     netto  = B / (1 + p/100)        (19 % → Divisor 1,19;  7 % → Divisor 1,07)
//     steuer = B − netto
//
// Der Bruttobetrag ist der maßgebliche, vom Gast gezahlte Betrag und bleibt unangetastet;
// `steuer = B − netto` (statt eigener Rundung) hält `netto + steuer === brutto` je Steuersatz.
// Das ist zugleich die KassenSichV-relevante Eigenschaft: Ein Bon, dessen Summen sich nicht
// aufrechnen, ist nicht belegbar.
//
// Gerundet wird JE STEUERSATZ, nicht je Position — der Steuerausweis erfolgt nach
// § 14 Abs. 4 Nr. 8 UStG gesammelt nach Sätzen. Drei 19-%-Positionen ergeben deshalb EINEN
// Rundungsschritt, nicht drei.

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
  appliedDiscounts?: AppliedDiscount[],
): Order {
  return { lineItems, dineLocation, appliedDiscounts } as unknown as Order
}

/** Euro-Ausgabewert → Cents. Vergleiche laufen cent-exakt, nicht über Float-Toleranzen. */
const ct = (euro: number) => Math.round(euro * 100)

/** Steuer-Eimer eines Satzes, cent-genau. */
function bucket(result: ReturnType<typeof computeOrderTax>, taxRate: number) {
  const found = result.taxes.find(t => t.taxRate === taxRate)
  if (!found) throw new Error(`kein Steuer-Eimer für ${taxRate}%`)
  return { netto: ct(found.amount), steuer: ct(found.tax) }
}

describe('MwSt-Gegenprobe nach § 10 UStG — Einzelsätze', () => {
  // Rechenweg 19 % (Divisor 1,19), von Hand:
  //   11,90 € → 1190 / 1,19 = 1000,000  → netto 1000 ct, steuer 1190 − 1000 = 190 ct
  //    9,99 € →  999 / 1,19 =  839,4958 → netto  839 ct, steuer  999 −  839 = 160 ct
  //    1,00 € →  100 / 1,19 =   84,0336 → netto   84 ct, steuer  100 −   84 =  16 ct
  //    2,90 € →  290 / 1,19 =  243,6975 → netto  244 ct, steuer  290 −  244 =  46 ct
  it.each([
    { brutto: 11.9, netto: 1000, steuer: 190 },
    { brutto: 9.99, netto: 839, steuer: 160 },
    { brutto: 1.0, netto: 84, steuer: 16 },
    { brutto: 2.9, netto: 244, steuer: 46 },
  ])('19 Prozent: $brutto € brutto → netto $netto ct / steuer $steuer ct', ({ brutto, netto, steuer }) => {
    const result = computeOrderTax(makeOrder([makeLine(brutto, 1, 19, 7)], 'dine-in'))
    expect(bucket(result, 19)).toEqual({ netto, steuer })
    expect(ct(result.brutto)).toBe(netto + steuer)
  })

  // Rechenweg 7 % (Divisor 1,07), von Hand:
  //   10,70 € → 1070 / 1,07 = 1000,000  → netto 1000 ct, steuer 1070 − 1000 = 70 ct
  //    3,20 € →  320 / 1,07 =  299,0654 → netto  299 ct, steuer  320 −  299 = 21 ct
  //    2,50 € →  250 / 1,07 =  233,6449 → netto  234 ct, steuer  250 −  234 = 16 ct
  //    6,40 € →  640 / 1,07 =  598,1308 → netto  598 ct, steuer  640 −  598 = 42 ct
  it.each([
    { brutto: 10.7, netto: 1000, steuer: 70 },
    { brutto: 3.2, netto: 299, steuer: 21 },
    { brutto: 2.5, netto: 234, steuer: 16 },
    { brutto: 6.4, netto: 598, steuer: 42 },
  ])('7 Prozent: $brutto € brutto → netto $netto ct / steuer $steuer ct', ({ brutto, netto, steuer }) => {
    const result = computeOrderTax(makeOrder([makeLine(brutto, 1, 7, 7)], 'dine-in'))
    expect(bucket(result, 7)).toEqual({ netto, steuer })
    expect(ct(result.brutto)).toBe(netto + steuer)
  })

  it('rechnet NICHT mit Aufschlag — die Differenz ist bei 11,90 € bereits 36 ct Steuer', () => {
    const result = computeOrderTax(makeOrder([makeLine(11.9, 1, 19, 7)], 'dine-in'))
    // Falsche Methode 1 (Aufschlag):        steuer = 1190 × 0,19       = 226 ct
    // Falsche Methode 2 (Abschlag v. Brutto): netto = 1190 × 0,81      = 964 ct → steuer 226 ct
    // Korrekt (Herausrechnung):              netto = 1190 / 1,19 = 1000 → steuer 190 ct
    expect(bucket(result, 19).steuer).toBe(190)
    expect(bucket(result, 19).steuer).not.toBe(226)
    expect(bucket(result, 19).netto).not.toBe(964)
  })
})

describe('MwSt-Gegenprobe nach § 10 UStG — gemischter Bon', () => {
  // Realistischer Gastro-Bon, Außer-Haus (take-out → taxOutside greift):
  //   2 × Brötchen à 3,20 € = 6,40 € @ 7 %
  //   1 × Kaffee     2,90 €          @ 19 %
  //
  // Von Hand, je Steuersatz gesammelt:
  //   7 %-Eimer:  640 ct → 640 / 1,07 = 598,1308 → netto 598, steuer 42
  //   19 %-Eimer: 290 ct → 290 / 1,19 = 243,6975 → netto 244, steuer 46
  //   Summen:     brutto 930, netto 842, steuer 88   (842 + 88 = 930 ✓)
  const bonLines = () => [makeLine(3.2, 2, 19, 7), makeLine(2.9, 1, 19, 19)]

  it('weist beide Sätze getrennt und cent-genau aus', () => {
    const result = computeOrderTax(makeOrder(bonLines(), 'take-out'))
    expect(bucket(result, 7)).toEqual({ netto: 598, steuer: 42 })
    expect(bucket(result, 19)).toEqual({ netto: 244, steuer: 46 })
    expect(ct(result.brutto)).toBe(930)
    expect(ct(result.netto)).toBe(842)
  })

  it('der Bon rechnet sich auf: Σ netto + Σ steuer === brutto', () => {
    // Die eigentliche KassenSichV-Eigenschaft. Sie ist NICHT selbstverständlich: Würde je
    // Position statt je Steuersatz gerundet, liefen hier Cents auseinander (2 × Brötchen
    // einzeln: 2 × round(320/1,07) = 2 × 299 = 598 — hier zufällig gleich, bei drei
    // Positionen à 3,33 € aber nicht mehr).
    const result = computeOrderTax(makeOrder(bonLines(), 'take-out'))
    const summeNetto = result.taxes.reduce((s, t) => s + ct(t.amount), 0)
    const summeSteuer = result.taxes.reduce((s, t) => s + ct(t.tax), 0)
    expect(summeNetto).toBe(ct(result.netto))
    expect(summeNetto + summeSteuer).toBe(ct(result.brutto))
  })

  it('rundet je Steuersatz, nicht je Position (3 × 3,33 € @19 %)', () => {
    // Von Hand: 3 × 3,33 € = 9,99 € → EIN Eimer 999 ct → 999 / 1,19 = 839,4958 → netto 839.
    // Je Position gerundet wäre: 3 × round(333/1,19) = 3 × 280 = 840 — ein Cent mehr Netto
    // und damit ein Cent weniger Steuer, ohne dass sich der Bon aufrechnet.
    const result = computeOrderTax(makeOrder([makeLine(3.33, 3, 19, 19)], 'dine-in'))
    expect(bucket(result, 19)).toEqual({ netto: 839, steuer: 160 })
    expect(ct(result.brutto)).toBe(999)
  })
})

describe('MwSt-Gegenprobe nach § 10 UStG — mit Rabatt', () => {
  const orderDiscount = (partial: Partial<AppliedDiscount>): AppliedDiscount =>
    ({
      discountId: '00000000-0000-0000-0000-0000000000d1',
      target: 'order',
      valueType: 'percent',
      valuePercent: 0,
      valueCents: 0,
      ...partial,
    }) as AppliedDiscount

  it('10 % auf den gemischten Bon — Rabatt mindert BRUTTO, Steuer wird danach neu extrahiert', () => {
    // Von Hand:
    //   Brutto gesamt 930 ct, Rabatt = round(930 × 10/100) = 93 ct
    //   Verteilung proportional über die Eimer (Reihenfolge der Zeilen: 7 % zuerst):
    //     7 %:  93 × 640/930 = 64,0 exakt → 64 ct
    //     19 %: 93 × 290/930 = 29,0 exakt → 29 ct   (Σ 93 ✓, kein Rest zu vergeben)
    //   Neue Eimer: 7 % → 576 ct,  19 % → 261 ct
    //     576 / 1,07 = 538,3178 → netto 538, steuer 38
    //     261 / 1,19 = 219,3277 → netto 219, steuer 42
    //   Summen: brutto 837, netto 757, steuer 80    (757 + 80 = 837 ✓)
    const applied = [orderDiscount({ valuePercent: 10 })]
    const result = computeOrderTax(makeOrder([makeLine(3.2, 2, 19, 7), makeLine(2.9, 1, 19, 19)], 'take-out', applied))
    expect(bucket(result, 7)).toEqual({ netto: 538, steuer: 38 })
    expect(bucket(result, 19)).toEqual({ netto: 219, steuer: 42 })
    expect(ct(result.brutto)).toBe(837)
    expect(ct(result.netto)).toBe(757)
    // Die Engine schreibt den tatsächlich abgezogenen Brutto-Betrag zurück — das ist der
    // Wert, den Bon und Z-Bon als Nachlass ausweisen.
    expect(applied[0].computedAmountCents).toBe(93)
  })

  it('verteilt einen unteilbaren Rest deterministisch (Largest-Remainder)', () => {
    // Von Hand: 19 % 3,33 € + 7 % 6,67 € = 10,00 €, Rabatt 10 % = 100 ct
    //   exakt:   19 %: 100 × 333/1000 = 33,3   |  7 %: 100 × 667/1000 = 66,7
    //   floor:   33 + 66 = 99 → 1 ct Rest an den GRÖSSTEN Nachkommarest (0,7 → 7 %)
    //   Abzug:   19 % → 33,  7 % → 67
    //   Neue Eimer: 19 % → 300 ct,  7 % → 600 ct
    //     300 / 1,19 = 252,1008 → netto 252, steuer 48
    //     600 / 1,07 = 560,7477 → netto 561, steuer 39
    //   Summen: brutto 900, netto 813, steuer 87    (813 + 87 = 900 ✓)
    const applied = [orderDiscount({ valuePercent: 10 })]
    const result = computeOrderTax(makeOrder([makeLine(3.33, 1, 19, 19), makeLine(6.67, 1, 7, 7)], 'dine-in', applied))
    expect(bucket(result, 19)).toEqual({ netto: 252, steuer: 48 })
    expect(bucket(result, 7)).toEqual({ netto: 561, steuer: 39 })
    expect(ct(result.brutto)).toBe(900)
    expect(applied[0].computedAmountCents).toBe(100)
  })

  it('Festbetrag-Gutschein 5,00 € — summen-exakt über beide Sätze', () => {
    // Von Hand: 19 % 12,00 € + 7 % 8,00 € = 20,00 €, Rabatt 500 ct
    //   19 %: 500 × 1200/2000 = 300 exakt  |  7 %: 500 × 800/2000 = 200 exakt
    //   Neue Eimer: 19 % → 900 ct,  7 % → 600 ct
    //     900 / 1,19 = 756,3025 → netto 756, steuer 144
    //     600 / 1,07 = 560,7477 → netto 561, steuer  39
    //   Summen: brutto 1500, netto 1317, steuer 183  (1317 + 183 = 1500 ✓)
    const applied = [orderDiscount({ valueType: 'amount', valueCents: 500 })]
    const result = computeOrderTax(makeOrder([makeLine(12.0, 1, 19, 19), makeLine(8.0, 1, 7, 7)], 'dine-in', applied))
    expect(bucket(result, 19)).toEqual({ netto: 756, steuer: 144 })
    expect(bucket(result, 7)).toEqual({ netto: 561, steuer: 39 })
    expect(ct(result.brutto)).toBe(1500)
    expect(ct(result.netto)).toBe(1317)
    expect(applied[0].computedAmountCents).toBe(500)
  })
})
