import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequest } from '@feathersjs/errors'

// `@feathersjs/errors` bleibt echt (wir asserten auf den Fehlertyp). Die reine
// Invarianten-Funktion aus `@panary/orders/domain` wird gemockt — sie ist in
// `staff-meal-exclusivity.spec.ts` (Domain-Projekt) erschöpfend getestet. Hier
// interessiert die Hook-Orchestrierung: provider-Gate, Feld-Gate, der Merge aus
// Vorzustand + Patch-Body und das BadRequest-Wrapping. Über die Aufruf-Argumente
// des Mocks lässt sich der Merge exakt prüfen.
const assertStaffMealDiscountExclusivity = vi.fn()
vi.mock('@panary/orders/domain', () => ({
  assertStaffMealDiscountExclusivity: (...a: unknown[]) => assertStaffMealDiscountExclusivity(...a),
}))

import { validateStaffMealExclusivity } from './validate-staff-meal-exclusivity.hook'
import type { HookContext } from '@feathersjs/feathers'

const staff = { userId: 'u1', userName: 'Max', isPaid: false }
const foreignDiscount = { _id: 'd1', name: 'Gutschein', isStaffMeal: false }
const staffDiscount = { _id: 'd2', name: 'Personalessen', isStaffMeal: true }

const buildContext = (opts: {
  method?: string
  id?: string | null
  provider?: string
  data?: unknown
  before?: Record<string, unknown>
  getSpy?: ReturnType<typeof vi.fn>
}): HookContext => {
  const getSpy = opts.getSpy ?? vi.fn(async () => opts.before ?? {})
  return {
    method: opts.method ?? 'patch',
    id: opts.id === undefined ? '1' : opts.id,
    data: opts.data ?? {},
    params: { provider: opts.provider },
    service: { get: getSpy },
  } as unknown as HookContext
}

describe('validateStaffMealExclusivity (Edge)', () => {
  beforeEach(() => {
    assertStaffMealDiscountExclusivity.mockReset()
  })

  it('interne Aufrufe (kein provider) werden NIE geprüft — sonst wäre Sync-Apply terminal rejected', async () => {
    assertStaffMealDiscountExclusivity.mockImplementation(() => {
      throw new Error('Konflikt')
    })
    const ctx = buildContext({
      method: 'create',
      data: { staffPaymentInfo: staff, appliedDiscounts: [foreignDiscount] },
    })
    await expect(validateStaffMealExclusivity(ctx)).resolves.toBe(ctx)
    expect(assertStaffMealDiscountExclusivity).not.toHaveBeenCalled()
  })

  describe('create', () => {
    it('Konflikt → BadRequest (400)', async () => {
      assertStaffMealDiscountExclusivity.mockImplementation(() => {
        throw new Error('Personalessen-Bestellungen erlauben keine zusaetzlichen Rabatte')
      })
      const ctx = buildContext({
        method: 'create',
        provider: 'socketio',
        data: { staffPaymentInfo: staff, appliedDiscounts: [foreignDiscount] },
      })
      await expect(validateStaffMealExclusivity(ctx)).rejects.toBeInstanceOf(BadRequest)
    })

    it('ohne Konflikt → passiert', async () => {
      const ctx = buildContext({
        method: 'create',
        provider: 'socketio',
        data: { staffPaymentInfo: staff, appliedDiscounts: [staffDiscount] },
      })
      await expect(validateStaffMealExclusivity(ctx)).resolves.toBe(ctx)
      expect(assertStaffMealDiscountExclusivity).toHaveBeenCalledTimes(1)
    })

    it('Multi-Create prüft jeden Datensatz', async () => {
      const ctx = buildContext({
        method: 'create',
        provider: 'socketio',
        data: [{ staffPaymentInfo: staff }, { appliedDiscounts: [foreignDiscount] }],
      })
      await validateStaffMealExclusivity(ctx)
      expect(assertStaffMealDiscountExclusivity).toHaveBeenCalledTimes(2)
    })
  })

  describe('patch', () => {
    it('Patch ohne staffPaymentInfo/appliedDiscounts → Pass-Through ohne DB-Read', async () => {
      const getSpy = vi.fn()
      const ctx = buildContext({ provider: 'socketio', data: { status: 'completed' }, getSpy })
      await expect(validateStaffMealExclusivity(ctx)).resolves.toBe(ctx)
      expect(getSpy).not.toHaveBeenCalled()
      expect(assertStaffMealDiscountExclusivity).not.toHaveBeenCalled()
    })

    it('Personalessen im Body + Bestandsrabatt aus dem Vorzustand → gemergter Zielzustand wird geprüft', async () => {
      const getSpy = vi.fn(async () => ({ appliedDiscounts: [foreignDiscount] }))
      const ctx = buildContext({ provider: 'socketio', data: { staffPaymentInfo: staff }, getSpy })
      await validateStaffMealExclusivity(ctx)
      expect(getSpy).toHaveBeenCalledWith('1', { provider: undefined })
      expect(assertStaffMealDiscountExclusivity).toHaveBeenCalledWith({
        staffPaymentInfo: staff,
        appliedDiscounts: [foreignDiscount],
      })
    })

    it('Rabatt im Body + Personalessen aus dem Vorzustand → ebenfalls gemerged', async () => {
      const getSpy = vi.fn(async () => ({ staffPaymentInfo: staff }))
      const ctx = buildContext({
        provider: 'socketio',
        data: { appliedDiscounts: [foreignDiscount] },
        getSpy,
      })
      await validateStaffMealExclusivity(ctx)
      expect(assertStaffMealDiscountExclusivity).toHaveBeenCalledWith({
        staffPaymentInfo: staff,
        appliedDiscounts: [foreignDiscount],
      })
    })

    it('explizites Leeren im Body gewinnt gegen den Vorzustand', async () => {
      const getSpy = vi.fn(async () => ({ staffPaymentInfo: staff, appliedDiscounts: [staffDiscount] }))
      const ctx = buildContext({ provider: 'socketio', data: { staffPaymentInfo: null }, getSpy })
      await validateStaffMealExclusivity(ctx)
      expect(assertStaffMealDiscountExclusivity).toHaveBeenCalledWith({
        staffPaymentInfo: null,
        appliedDiscounts: [staffDiscount],
      })
    })

    it('Multi-Patch ohne id → nicht geprüft (kein eindeutiger Vorzustand)', async () => {
      const getSpy = vi.fn()
      const ctx = buildContext({ provider: 'socketio', id: null, data: { staffPaymentInfo: staff }, getSpy })
      await expect(validateStaffMealExclusivity(ctx)).resolves.toBe(ctx)
      expect(getSpy).not.toHaveBeenCalled()
    })
  })
})
