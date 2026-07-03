import { beforeEach, describe, expect, it, vi } from 'vitest'

import { calculateTaxDetails, calculateTaxDetailsOnPatch } from './calculate-tax-details'

// Geld-Pfad-Spec: OHNE Domain-Mocks — der Hook delegiert vollständig an die
// kanonische Engine `computeOrderTax`; verankert wird hier die cent-genaue
// Snapshot-Erzeugung (fiskalische MwSt-EXTRAKTION aus Brutto) am Hook-Rand.

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

function makeOrder(overrides: Record<string, unknown> = {}): any {
  return {
    _id: 'order-1',
    tenantId: 't-1',
    orderChannel: 'pos',
    dineLocation: 'dine-in',
    lineItems: [makeLineItem()],
    ...overrides,
  }
}

// 19%-Zeile (2 × 10,00€) + 7%-Zeile (3,50€ + 0,50€-Modifier) → Brutto 24,00€.
function makeMixedRateOrder(overrides: Record<string, unknown> = {}): any {
  return makeOrder({
    lineItems: [
      makeLineItem({ _id: 'li-19', price: 10, amount: 2, taxInside: 19, taxOutside: 7 }),
      makeLineItem({
        _id: 'li-7',
        price: 3.5,
        amount: 1,
        taxInside: 7,
        taxOutside: 7,
        modifiers: [{ _id: 'mod-1', name: 'Extra', price: 0.5, amount: 1 }],
      }),
    ],
    ...overrides,
  })
}

function makePatchContext(opts: { id?: string | null; data: any; storedOrder?: any }): {
  ctx: any
  get: ReturnType<typeof vi.fn>
} {
  const get = vi.fn().mockResolvedValue(opts.storedOrder)
  const ctx = {
    app: { service: (path: string) => (path === 'orders' ? { get } : undefined) },
    id: opts.id ?? null,
    data: opts.data,
    params: {},
  }
  return { ctx, get }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('calculateTaxDetails (create)', () => {
  it('setzt den taxSnapshot cent-korrekt für gemischte Sätze (7% + 19%, dine-in)', async () => {
    const ctx: any = { data: makeMixedRateOrder() }

    await calculateTaxDetails(ctx)

    const snap = ctx.data.taxSnapshot
    expect(snap.brutto).toBeCloseTo(24.0, 5)
    // 19%-Eimer: 2000 Cents Brutto → Netto round(2000·100/119) = 1681, Steuer 319.
    // 7%-Eimer: 400 Cents Brutto → Netto round(400·100/107) = 374, Steuer 26.
    expect(snap.netto).toBeCloseTo(20.55, 5)
    expect(snap.taxes).toHaveLength(2)
    const t19 = snap.taxes.find((t: any) => t.taxRate === 19)
    const t7 = snap.taxes.find((t: any) => t.taxRate === 7)
    expect(t19.amount).toBeCloseTo(16.81, 5)
    expect(t19.tax).toBeCloseTo(3.19, 5)
    expect(t7.amount).toBeCloseTo(3.74, 5)
    expect(t7.tax).toBeCloseTo(0.26, 5)
    // Fiskalische Invariante pro Satz: Netto + Steuer = Brutto (cent-genau).
    expect(Math.round((t19.amount + t19.tax) * 100)).toBe(2000)
    expect(Math.round((t7.amount + t7.tax) * 100)).toBe(400)
  })

  it('nutzt bei take-out die taxOutside-Sätze (alles im 7%-Eimer)', async () => {
    const ctx: any = { data: makeMixedRateOrder({ dineLocation: 'take-out' }) }

    await calculateTaxDetails(ctx)

    const snap = ctx.data.taxSnapshot
    expect(snap.taxes).toHaveLength(1)
    expect(snap.taxes[0].taxRate).toBe(7)
    expect(snap.brutto).toBeCloseTo(24.0, 5)
    // 2400 Cents Brutto → Netto round(2400·100/107) = 2243, Steuer 157.
    expect(snap.netto).toBeCloseTo(22.43, 5)
    expect(snap.taxes[0].tax).toBeCloseTo(1.57, 5)
  })

  it('überschreibt einen client-gelieferten taxSnapshot (Server ist autoritativ)', async () => {
    const bogus = { taxes: [], netto: 999, brutto: 999 }
    const ctx: any = { data: makeMixedRateOrder({ taxSnapshot: bogus }) }

    await calculateTaxDetails(ctx)

    expect(ctx.data.taxSnapshot.brutto).toBeCloseTo(24.0, 5)
    expect(ctx.data.taxSnapshot).not.toEqual(bogus)
  })
})

describe('calculateTaxDetailsOnPatch', () => {
  it('berechnet den Snapshot neu, wenn der Patch einen Rabatt setzt (percent)', async () => {
    // Gespeicherte Order: 40€ @19% dine-in. Patch: 50%-Rabatt → Brutto 20,00€.
    const stored = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })] })
    const { ctx, get } = makePatchContext({
      id: 'order-1',
      data: { discount: { discountType: 'percent', discount: 50 } },
      storedOrder: stored,
    })

    await calculateTaxDetailsOnPatch(ctx)

    expect(get).toHaveBeenCalledWith('order-1')
    const snap = ctx.data.taxSnapshot
    expect(snap.brutto).toBeCloseTo(20.0, 5)
    expect(snap.netto).toBeCloseTo(16.81, 5)
    expect(snap.taxes[0].tax).toBeCloseTo(3.19, 5)
  })

  it('interpretiert den Legacy-Festbetrag in EURO (discount 5 → 5,00€ Abzug)', async () => {
    const stored = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })] })
    const { ctx } = makePatchContext({
      id: 'order-1',
      data: { discount: { discountType: 'amount', discount: 5 } },
      storedOrder: stored,
    })

    await calculateTaxDetailsOnPatch(ctx)

    expect(ctx.data.taxSnapshot.brutto).toBeCloseTo(35.0, 5)
    expect(ctx.data.taxSnapshot.netto).toBeCloseTo(29.41, 5)
  })

  it('berechnet den Snapshot auch beim ENTFERNEN eines Rabatts neu (discount: null)', async () => {
    // Gespeicherte Order: 40€ @19% mit gesetztem 50%-Rabatt. Patch entfernt ihn
    // → Snapshot muss zurück auf den vollen Preis (fiskalischer Zielzustand).
    const stored = makeOrder({
      lineItems: [makeLineItem({ price: 20, amount: 2 })],
      discount: { discountType: 'percent', discount: 50 },
    })
    const { ctx } = makePatchContext({ id: 'order-1', data: { discount: null }, storedOrder: stored })

    await calculateTaxDetailsOnPatch(ctx)

    expect(ctx.data.taxSnapshot.brutto).toBeCloseTo(40.0, 5)
    expect(ctx.data.taxSnapshot.netto).toBeCloseTo(33.61, 5)
  })

  it('berechnet den Snapshot bei einem appliedDiscounts-Patch (führend vor Legacy-discount)', async () => {
    const stored = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })] })
    const applied = {
      _id: 'ad-1',
      name: 'Aktion',
      method: 'manual',
      target: 'order',
      valueType: 'percent',
      valuePercent: 25,
      valueCents: 0,
      computedAmountCents: 0,
      appliedAt: '2026-07-03T12:00:00.000Z',
    }
    const { ctx } = makePatchContext({ id: 'order-1', data: { appliedDiscounts: [applied] }, storedOrder: stored })

    await calculateTaxDetailsOnPatch(ctx)

    // 4000 Cents − 25% = 3000 Cents Brutto; Engine schreibt den real abgezogenen
    // Betrag in den Patch-Eintrag zurück (Bon führt die echten Beträge).
    expect(ctx.data.taxSnapshot.brutto).toBeCloseTo(30.0, 5)
    expect(ctx.data.appliedDiscounts[0].computedAmountCents).toBe(1000)
  })

  it('berechnet den Snapshot bei einem dineLocation-Wechsel neu (19% → 7%)', async () => {
    const stored = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })] })
    const { ctx } = makePatchContext({ id: 'order-1', data: { dineLocation: 'take-out' }, storedOrder: stored })

    await calculateTaxDetailsOnPatch(ctx)

    const snap = ctx.data.taxSnapshot
    expect(snap.taxes).toHaveLength(1)
    expect(snap.taxes[0].taxRate).toBe(7)
    expect(snap.brutto).toBeCloseTo(40.0, 5)
  })

  it('lässt den Snapshot bei einem preis-irrelevanten Patch unangetastet und liest keine Order', async () => {
    const stored = makeOrder()
    const { ctx, get } = makePatchContext({ id: 'order-1', data: { status: 'completed' }, storedOrder: stored })

    await calculateTaxDetailsOnPatch(ctx)

    expect(ctx.data.taxSnapshot).toBeUndefined()
    expect(get).not.toHaveBeenCalled()
  })

  it('ist ohne id (Multi-Patch) ein No-Op und liest keine Order', async () => {
    const { ctx, get } = makePatchContext({ id: null, data: { discount: { discountType: 'percent', discount: 50 } } })

    await calculateTaxDetailsOnPatch(ctx)

    expect(get).not.toHaveBeenCalled()
    expect(ctx.data.taxSnapshot).toBeUndefined()
  })
})
