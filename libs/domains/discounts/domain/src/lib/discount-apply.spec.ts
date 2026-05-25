import { describe, expect, it } from 'vitest'
import { Discount } from './discount.schema'
import { DiscountCode } from './discount-code.schema'
import {
  CodeRedeemReason,
  deriveDiscountDisplayStatus,
  DiscountDisplayStatus,
  discountAppliesToChannel,
  evaluateAutomaticDiscounts,
  evaluateCodeRedeemability,
  isAutomaticDiscountApplicable,
  isDiscountApplicable,
  isEligibleCustomer,
  isWithinRecurringWindow,
  matchesScope,
  meetsMinRequirement,
  resolveDiscountAmountCents,
  validateDiscountConsistency,
} from './discount-apply'

function makeDiscount(partial: Partial<Discount> = {}): Discount {
  return {
    _id: '00000000-0000-0000-0000-000000000000',
    tenantId: '00000000-0000-0000-0000-000000000001',
    locationId: null,
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    name: 'Test',
    status: 'ACTIVE',
    method: 'manual',
    target: 'order',
    valueType: 'percent',
    valuePercent: 10,
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
    ...partial,
  } as Discount
}

describe('resolveDiscountAmountCents', () => {
  it('Prozent: 10% von 100,00€ → 1000 ct', () => {
    expect(resolveDiscountAmountCents(makeDiscount({ valueType: 'percent', valuePercent: 10 }), 10000)).toBe(1000)
  })
  it('Festbetrag: geklemmt auf Basis', () => {
    const d = makeDiscount({ valueType: 'amount', valueCents: 1500 })
    expect(resolveDiscountAmountCents(d, 10000)).toBe(1500)
    expect(resolveDiscountAmountCents(d, 1000)).toBe(1000)
  })
  it('Basis 0 → 0', () => {
    expect(resolveDiscountAmountCents(makeDiscount(), 0)).toBe(0)
  })
})

describe('discountAppliesToChannel', () => {
  it('leere Kanäle = alle', () => {
    expect(discountAppliesToChannel(makeDiscount({ channels: [] }), 'pos')).toBe(true)
  })
  it('eingeschränkt auf pos', () => {
    const d = makeDiscount({ channels: ['pos'] })
    expect(discountAppliesToChannel(d, 'pos')).toBe(true)
    expect(discountAppliesToChannel(d, 'online')).toBe(false)
  })
})

describe('deriveDiscountDisplayStatus', () => {
  const now = new Date('2026-05-25T12:00:00.000Z')
  it('DRAFT/ARCHIVED durchgereicht', () => {
    expect(deriveDiscountDisplayStatus(makeDiscount({ status: 'DRAFT' }), now)).toBe(DiscountDisplayStatus.DRAFT)
    expect(deriveDiscountDisplayStatus(makeDiscount({ status: 'ARCHIVED' }), now)).toBe(DiscountDisplayStatus.ARCHIVED)
  })
  it('SCHEDULED wenn activeFrom in der Zukunft', () => {
    const d = makeDiscount({ status: 'ACTIVE', activeFrom: '2026-06-01T00:00:00.000Z' })
    expect(deriveDiscountDisplayStatus(d, now)).toBe(DiscountDisplayStatus.SCHEDULED)
  })
  it('EXPIRED wenn activeUntil in der Vergangenheit', () => {
    const d = makeDiscount({ status: 'ACTIVE', activeUntil: '2026-05-01T00:00:00.000Z' })
    expect(deriveDiscountDisplayStatus(d, now)).toBe(DiscountDisplayStatus.EXPIRED)
  })
  it('ACTIVE im Fenster', () => {
    expect(deriveDiscountDisplayStatus(makeDiscount({ status: 'ACTIVE' }), now)).toBe(DiscountDisplayStatus.ACTIVE)
  })
})

describe('isDiscountApplicable', () => {
  it('nur ACTIVE + passender Kanal', () => {
    expect(isDiscountApplicable(makeDiscount({ status: 'ACTIVE', channels: ['pos'] }), { channel: 'pos' })).toBe(true)
    expect(isDiscountApplicable(makeDiscount({ status: 'DRAFT' }), { channel: 'pos' })).toBe(false)
    expect(isDiscountApplicable(makeDiscount({ status: 'ACTIVE', channels: ['online'] }), { channel: 'pos' })).toBe(
      false,
    )
  })
})

describe('validateDiscountConsistency', () => {
  it('gültiger MANUAL-Order-Prozentrabatt → keine Fehler', () => {
    expect(validateDiscountConsistency(makeDiscount())).toEqual([])
  })
  it('Prozentwert 0 → Fehler', () => {
    expect(validateDiscountConsistency(makeDiscount({ valuePercent: 0 })).length).toBeGreaterThan(0)
  })
  it('appliesTo=categories ohne categoryIds → Fehler', () => {
    expect(
      validateDiscountConsistency(makeDiscount({ appliesTo: 'categories', categoryIds: [] })).length,
    ).toBeGreaterThan(0)
  })
  it('eligibility=specific ohne customerIds → Fehler', () => {
    expect(
      validateDiscountConsistency(makeDiscount({ eligibility: 'specific', customerIds: [] })).length,
    ).toBeGreaterThan(0)
  })
})

describe('isWithinRecurringWindow', () => {
  // Mittwoch, 2026-05-27, 18:00 (getDay() === 3)
  const wed18 = new Date('2026-05-27T18:00:00')
  it('kein Fenster gesetzt → immer true', () => {
    expect(isWithinRecurringWindow(makeDiscount(), wed18)).toBe(true)
  })
  it('Happy Hour Mo-Fr 17-19 → Mi 18:00 greift', () => {
    const d = makeDiscount({ recurringWeekdays: [1, 2, 3, 4, 5], recurringStartTime: '17:00', recurringEndTime: '19:00' })
    expect(isWithinRecurringWindow(d, wed18)).toBe(true)
  })
  it('außerhalb der Uhrzeit → false', () => {
    const d = makeDiscount({ recurringWeekdays: [1, 2, 3, 4, 5], recurringStartTime: '11:00', recurringEndTime: '14:00' })
    expect(isWithinRecurringWindow(d, wed18)).toBe(false)
  })
  it('falscher Wochentag → false', () => {
    const sun = new Date('2026-05-24T18:00:00') // Sonntag (0)
    const d = makeDiscount({ recurringWeekdays: [1, 2, 3, 4, 5], recurringStartTime: '17:00', recurringEndTime: '19:00' })
    expect(isWithinRecurringWindow(d, sun)).toBe(false)
  })
})

describe('Bedingungen (Min/Eligibility/Scope)', () => {
  it('meetsMinRequirement Betrag', () => {
    const d = makeDiscount({ minRequirementType: 'amount', minAmountCents: 5000 })
    expect(meetsMinRequirement(d, { orderGrossCents: 6000 })).toBe(true)
    expect(meetsMinRequirement(d, { orderGrossCents: 4000 })).toBe(false)
  })
  it('meetsMinRequirement Menge', () => {
    const d = makeDiscount({ minRequirementType: 'quantity', minQuantity: 3 })
    expect(meetsMinRequirement(d, { itemCount: 3 })).toBe(true)
    expect(meetsMinRequirement(d, { itemCount: 2 })).toBe(false)
  })
  it('isEligibleCustomer specific', () => {
    const d = makeDiscount({ eligibility: 'specific', customerIds: ['c1'] })
    expect(isEligibleCustomer(d, { customerId: 'c1' })).toBe(true)
    expect(isEligibleCustomer(d, { customerId: 'c2' })).toBe(false)
    expect(isEligibleCustomer(d, {})).toBe(false)
  })
  it('matchesScope Kategorien', () => {
    const d = makeDiscount({ appliesTo: 'categories', categoryIds: ['cat1'] })
    expect(matchesScope(d, { categoryIds: ['cat1', 'cat2'] })).toBe(true)
    expect(matchesScope(d, { categoryIds: ['cat3'] })).toBe(false)
  })
})

describe('evaluateAutomaticDiscounts', () => {
  const wed18 = new Date('2026-05-27T18:00:00')
  it('greift bei erfüllten Bedingungen, ignoriert MANUAL/inaktive', () => {
    const happyHour = makeDiscount({
      _id: 'a1',
      method: 'automatic',
      status: 'ACTIVE',
      recurringWeekdays: [1, 2, 3, 4, 5],
      recurringStartTime: '17:00',
      recurringEndTime: '19:00',
      minRequirementType: 'amount',
      minAmountCents: 2000,
    })
    const manual = makeDiscount({ _id: 'a2', method: 'manual', status: 'ACTIVE' })
    const draftAuto = makeDiscount({ _id: 'a3', method: 'automatic', status: 'DRAFT' })
    const result = evaluateAutomaticDiscounts([happyHour, manual, draftAuto], {
      now: wed18,
      orderGrossCents: 3000,
      channel: 'pos',
    })
    expect(result.map(d => d._id)).toEqual(['a1'])
  })
  it('greift nicht, wenn Mindestbetrag unterschritten', () => {
    const d = makeDiscount({ method: 'automatic', minRequirementType: 'amount', minAmountCents: 5000 })
    expect(isAutomaticDiscountApplicable(d, { now: wed18, orderGrossCents: 1000 })).toBe(false)
  })
})

function makeCode(partial: Partial<DiscountCode> = {}): DiscountCode {
  return {
    _id: '00000000-0000-0000-0000-0000000000c0',
    tenantId: '00000000-0000-0000-0000-000000000001',
    locationId: null,
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    discountId: '00000000-0000-0000-0000-0000000000d0',
    code: 'WILLKOMMEN10',
    codeUpper: 'WILLKOMMEN10',
    isShared: true,
    usageCount: 0,
    ...partial,
  } as DiscountCode
}

describe('evaluateCodeRedeemability', () => {
  const active = makeDiscount({ status: 'ACTIVE' })

  it('einlösbar bei gültigem Code + aktivem Rabatt', () => {
    expect(evaluateCodeRedeemability(makeCode(), active).ok).toBe(true)
  })
  it('not_found bei fehlendem Code', () => {
    const r = evaluateCodeRedeemability(null, active)
    expect(r).toEqual({ ok: false, reason: CodeRedeemReason.NOT_FOUND })
  })
  it('deleted bei Tombstone', () => {
    const r = evaluateCodeRedeemability(makeCode({ _deletedAt: '2026-05-24T00:00:00.000Z' }), active)
    expect(r.reason).toBe(CodeRedeemReason.DELETED)
  })
  it('expired nach Ablaufdatum', () => {
    const code = makeCode({ expiresAt: '2026-05-01T00:00:00.000Z' })
    expect(evaluateCodeRedeemability(code, active, { now: new Date('2026-05-25T00:00:00Z') }).reason).toBe(
      CodeRedeemReason.EXPIRED,
    )
  })
  it('limit_reached anhand des autoritativen redemptionCount (nicht usageCount-Cache)', () => {
    const code = makeCode({ usageLimit: 3, usageCount: 0 })
    // Cache sagt 0, aber das append-only-Log zählt 3 → Limit erreicht.
    expect(evaluateCodeRedeemability(code, active, { redemptionCount: 3 }).reason).toBe(
      CodeRedeemReason.LIMIT_REACHED,
    )
    expect(evaluateCodeRedeemability(code, active, { redemptionCount: 2 }).ok).toBe(true)
  })
  it('wrong_customer bei kundengebundenem Code', () => {
    const code = makeCode({ assignedCustomerId: 'cust-1' })
    expect(evaluateCodeRedeemability(code, active, { customerId: 'cust-2' }).reason).toBe(
      CodeRedeemReason.WRONG_CUSTOMER,
    )
    expect(evaluateCodeRedeemability(code, active, { customerId: 'cust-1' }).ok).toBe(true)
  })
  it('discount_inactive wenn der Rabatt nicht ACTIVE ist', () => {
    const draft = makeDiscount({ status: 'DRAFT' })
    expect(evaluateCodeRedeemability(makeCode(), draft).reason).toBe(CodeRedeemReason.DISCOUNT_INACTIVE)
  })
})
