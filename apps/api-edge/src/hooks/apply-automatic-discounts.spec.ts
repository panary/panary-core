import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyAutomaticDiscounts } from './apply-automatic-discounts'
import { calculateTaxDetails } from './calculate-tax-details'

// Geld-Pfad-Spec: bewusst OHNE Domain-Mocks — die Kombinationsregel (höchstens
// EIN Automatik-Rabatt, der für den Kunden günstigste) und die Klemmung von
// Festbeträgen sind nur gegen die echte Engine (`resolveDiscountAmountCents`,
// `computeOrderTax`) fiskalisch belastbar verankert.

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
    locationId: 'loc-1',
    orderChannel: 'pos',
    dineLocation: 'dine-in',
    lineItems: [makeLineItem()],
    ...overrides,
  }
}

// Defaults decken alle Bedingungs-Prüfungen der Engine ab (ACTIVE, kein Fenster,
// alle Kanäle/Kunden/Produkte, keine Mindestanforderung) — greift also immer.
function makeDiscount(overrides: Record<string, unknown> = {}): any {
  return {
    _id: 'd-1',
    tenantId: 't-1',
    locationId: null,
    name: 'Testrabatt',
    status: 'ACTIVE',
    method: 'automatic',
    target: 'order',
    valueType: 'percent',
    valuePercent: 0,
    valueCents: 0,
    appliesTo: 'all',
    categoryIds: [],
    productExternalIds: [],
    eligibility: 'all',
    customerIds: [],
    minRequirementType: 'none',
    recurringWeekdays: [],
    channels: [],
    combinable: false,
    isStaffMeal: false,
    onePerCustomer: false,
    ...overrides,
  }
}

function makeContext(order: any, discounts: any[] = []): { ctx: any; find: ReturnType<typeof vi.fn> } {
  const find = vi.fn().mockResolvedValue(discounts)
  const ctx = {
    app: { service: (path: string) => (path === 'discounts' ? { find } : undefined) },
    params: { user: { tenantId: 't-1' } },
    data: order,
  }
  return { ctx, find }
}

const pct10 = () => makeDiscount({ _id: 'd-pct10', valueType: 'percent', valuePercent: 10 })
const amt5 = () => makeDiscount({ _id: 'd-amt5', valueType: 'amount', valueCents: 500 })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyAutomaticDiscounts — Kombinationsregel (günstigster Rabatt, kein Stacking)', () => {
  it('wendet bei zwei greifenden Rabatten NUR den für den Kunden günstigeren an (Festbetrag > Prozent)', async () => {
    // 40€-Order: 10% = 400 Cents < 5€-Festbetrag = 500 Cents → Festbetrag gewinnt.
    const order = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })] })
    const { ctx, find } = makeContext(order, [pct10(), amt5()])

    await applyAutomaticDiscounts(ctx)

    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0][0].query).toMatchObject({ tenantId: 't-1', method: 'automatic', status: 'ACTIVE' })
    expect(order.appliedDiscounts).toHaveLength(1)
    expect(order.appliedDiscounts[0]).toMatchObject({
      discountId: 'd-amt5',
      method: 'automatic',
      target: 'order',
      valueType: 'amount',
      valueCents: 500,
      valuePercent: 0,
    })

    // Downstream-Hook (Registrierungsreihenfolge im orders-Service): die Engine
    // zieht den injizierten Rabatt cent-genau ab und schreibt computedAmountCents.
    await calculateTaxDetails(ctx)
    expect(ctx.data.taxSnapshot.brutto).toBeCloseTo(35.0, 5)
    expect(ctx.data.taxSnapshot.netto).toBeCloseTo(29.41, 5)
    expect(ctx.data.taxSnapshot.taxes[0].tax).toBeCloseTo(5.59, 5)
    expect(order.appliedDiscounts[0].computedAmountCents).toBe(500)
  })

  it('wählt den Prozent-Rabatt, wenn er den höheren Abzug ergibt (kein "erster gewinnt")', async () => {
    // 60€-Order: 10% = 600 Cents > 5€-Festbetrag = 500 Cents → Prozent gewinnt.
    const order = makeOrder({ lineItems: [makeLineItem({ price: 30, amount: 2 })] })
    const { ctx } = makeContext(order, [amt5(), pct10()])

    await applyAutomaticDiscounts(ctx)

    expect(order.appliedDiscounts).toHaveLength(1)
    expect(order.appliedDiscounts[0].discountId).toBe('d-pct10')
  })

  it('klemmt einen Festbetrag über Brutto auf das Order-Brutto (nie negativer Bon)', async () => {
    // 3€-Order mit 5€-Festbetrag: Auswahl rechnet mit geklemmten 300 Cents,
    // die Engine zieht ebenfalls maximal das Brutto ab → Snapshot exakt 0.
    const order = makeOrder({ lineItems: [makeLineItem({ price: 3, amount: 1 })] })
    const { ctx } = makeContext(order, [amt5()])

    await applyAutomaticDiscounts(ctx)

    expect(order.appliedDiscounts).toHaveLength(1)
    expect(order.appliedDiscounts[0].valueCents).toBe(500)

    await calculateTaxDetails(ctx)
    expect(ctx.data.taxSnapshot.brutto).toBe(0)
    expect(ctx.data.taxSnapshot.netto).toBe(0)
    expect(ctx.data.taxSnapshot.taxes).toEqual([])
    // Tatsächlich abgezogen wurde nur das Brutto (300), nicht der Nominalwert (500).
    expect(order.appliedDiscounts[0].computedAmountCents).toBe(300)
  })
})

describe('applyAutomaticDiscounts — Guards', () => {
  it('lässt die Order unverändert, wenn kein Rabatt greift (Mindestbetrag nicht erreicht)', async () => {
    const order = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })] })
    const notReached = makeDiscount({ valueType: 'percent', valuePercent: 10, minRequirementType: 'amount', minAmountCents: 10000 })
    const { ctx, find } = makeContext(order, [notReached])

    await applyAutomaticDiscounts(ctx)

    expect(find).toHaveBeenCalledTimes(1)
    expect(order.appliedDiscounts).toBeUndefined()
  })

  it('greift NICHT, wenn bereits ein manueller Rabatt in appliedDiscounts liegt (keine Discounts-Abfrage)', async () => {
    const manual = { _id: 'ad-1', name: 'Kulanz', method: 'manual', target: 'order', valueType: 'percent', valuePercent: 5, valueCents: 0 }
    const order = makeOrder({ appliedDiscounts: [manual] })
    const { ctx, find } = makeContext(order, [amt5()])

    await applyAutomaticDiscounts(ctx)

    expect(find).not.toHaveBeenCalled()
    expect(order.appliedDiscounts).toEqual([manual])
  })

  it('greift NICHT, wenn der Legacy-Order-Rabatt (order.discount) gesetzt ist', async () => {
    const order = makeOrder({ discount: { discountType: 'percent', discount: 10 } })
    const { ctx, find } = makeContext(order, [amt5()])

    await applyAutomaticDiscounts(ctx)

    expect(find).not.toHaveBeenCalled()
    expect(order.appliedDiscounts).toBeUndefined()
  })

  it('scopet auf die Filiale: fremd-lokalisierter Rabatt wird verworfen, globaler (locationId null) gewinnt', async () => {
    const order = makeOrder({ lineItems: [makeLineItem({ price: 20, amount: 2 })], locationId: 'loc-1' })
    // Der fremde Rabatt wäre nominal höher — darf aber nie in die Auswahl gelangen.
    const foreign = makeDiscount({ _id: 'd-foreign', locationId: 'loc-2', valueType: 'amount', valueCents: 99900 })
    const { ctx } = makeContext(order, [foreign, pct10()])

    await applyAutomaticDiscounts(ctx)

    expect(order.appliedDiscounts).toHaveLength(1)
    expect(order.appliedDiscounts[0].discountId).toBe('d-pct10')
  })

  it('ist ohne auflösbare tenantId ein No-Op (kein tenant-loser Discounts-Read)', async () => {
    const order = makeOrder({ tenantId: undefined })
    const { ctx, find } = makeContext(order, [amt5()])
    ctx.params.user = undefined

    await applyAutomaticDiscounts(ctx)

    expect(find).not.toHaveBeenCalled()
    expect(order.appliedDiscounts).toBeUndefined()
  })
})
