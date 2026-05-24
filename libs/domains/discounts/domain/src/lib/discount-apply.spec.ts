import { describe, expect, it } from 'vitest'
import { Discount } from './discount.schema'
import {
  deriveDiscountDisplayStatus,
  DiscountDisplayStatus,
  discountAppliesToChannel,
  isDiscountApplicable,
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
