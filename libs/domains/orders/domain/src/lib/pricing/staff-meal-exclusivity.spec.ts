import { describe, expect, it } from 'vitest'

import { assertStaffMealDiscountExclusivity, findStaffMealDiscountConflict } from './staff-meal-exclusivity'
import type { AppliedDiscount, StaffPaymentInfo } from '../order.schema'

const discount = (over: Partial<AppliedDiscount> = {}): AppliedDiscount => ({
  _id: '01920000-0000-7000-8000-000000000001',
  name: 'Stammgast',
  method: 'manual',
  target: 'order',
  valueType: 'percent',
  valuePercent: 10,
  valueCents: 0,
  computedAmountCents: 0,
  appliedAt: '2026-07-29T10:00:00.000Z',
  ...over,
})

const staffPaymentInfo: StaffPaymentInfo = {
  userId: '01920000-0000-7000-8000-0000000000ff',
  userName: 'Max Mustermann',
  isPaid: false,
}

describe('staff-meal-exclusivity', () => {
  describe('ohne Personalessen — normale Rabatte bleiben unberührt', () => {
    it('mehrere Fremdrabatte sind erlaubt, solange staffPaymentInfo fehlt', () => {
      const conflict = findStaffMealDiscountConflict({
        appliedDiscounts: [discount(), discount({ _id: 'x', name: 'Gutschein' })],
      })
      expect(conflict).toBeNull()
    })

    it('staffPaymentInfo: null zählt nicht als Personalessen', () => {
      const conflict = findStaffMealDiscountConflict({
        staffPaymentInfo: null,
        appliedDiscounts: [discount()],
      })
      expect(conflict).toBeNull()
    })
  })

  describe('mit Personalessen', () => {
    it('ohne Rabatte → kein Konflikt (Fallback „ohne Rabatt")', () => {
      expect(findStaffMealDiscountConflict({ staffPaymentInfo, appliedDiscounts: [] })).toBeNull()
    })

    it('appliedDiscounts fehlt/null → kein Konflikt', () => {
      expect(findStaffMealDiscountConflict({ staffPaymentInfo })).toBeNull()
      expect(findStaffMealDiscountConflict({ staffPaymentInfo, appliedDiscounts: null })).toBeNull()
    })

    it('genau ein Personalessen-Rabatt → kein Konflikt', () => {
      const conflict = findStaffMealDiscountConflict({
        staffPaymentInfo,
        appliedDiscounts: [discount({ name: 'Personalessen', isStaffMeal: true })],
      })
      expect(conflict).toBeNull()
    })

    it('Fremdrabatt zusätzlich → Konflikt, Name steht in der Meldung', () => {
      const conflict = findStaffMealDiscountConflict({
        staffPaymentInfo,
        appliedDiscounts: [discount({ name: 'Personalessen', isStaffMeal: true }), discount({ name: 'Gutschein' })],
      })
      expect(conflict).toContain('Gutschein')
    })

    it('nur ein Fremdrabatt (ohne Personalessen-Rabatt) → Konflikt', () => {
      expect(findStaffMealDiscountConflict({ staffPaymentInfo, appliedDiscounts: [discount()] })).toContain('Stammgast')
    })

    it('zwei Personalessen-Rabatte → Konflikt', () => {
      const conflict = findStaffMealDiscountConflict({
        staffPaymentInfo,
        appliedDiscounts: [
          discount({ name: 'Personalessen', isStaffMeal: true }),
          discount({ _id: 'y', name: 'Personalessen Azubi', isStaffMeal: true }),
        ],
      })
      expect(conflict).toContain('genau einen')
    })
  })

  describe('assert-Variante', () => {
    it('wirft bei Konflikt', () => {
      expect(() =>
        assertStaffMealDiscountExclusivity({ staffPaymentInfo, appliedDiscounts: [discount()] }),
      ).toThrowError(/keine zusaetzlichen Rabatte/)
    })

    it('wirft nicht ohne Konflikt', () => {
      expect(() => assertStaffMealDiscountExclusivity({ appliedDiscounts: [discount()] })).not.toThrow()
    })
  })
})
