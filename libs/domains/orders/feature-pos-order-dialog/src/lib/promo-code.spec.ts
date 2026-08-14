import { describe, expect, it } from 'vitest'

import {
  PROMO_CODE_BLOCKED_MANUAL,
  PROMO_CODE_BLOCKED_STAFF_MEAL,
  buildCodeAppliedDiscount,
  evaluatePromoCodeGate,
} from './promo-code'

describe('evaluatePromoCodeGate', () => {
  it('erlaubt die Eingabe bei einer gewoehnlichen Bestellung', () => {
    expect(evaluatePromoCodeGate({ isStaffMealOrder: false, hasManualDiscount: false })).toEqual({ allowed: true })
  })

  it('sperrt bei Personalessen — sonst scheitert die Bestellung serverseitig mit 400', () => {
    const gate = evaluatePromoCodeGate({ isStaffMealOrder: true, hasManualDiscount: false })
    expect(gate.allowed).toBe(false)
    expect(gate.message).toBe(PROMO_CODE_BLOCKED_STAFF_MEAL)
  })

  it('sperrt, wenn bereits ein manueller Rabatt gewaehlt ist', () => {
    const gate = evaluatePromoCodeGate({ isStaffMealOrder: false, hasManualDiscount: true })
    expect(gate.allowed).toBe(false)
    expect(gate.message).toBe(PROMO_CODE_BLOCKED_MANUAL)
  })

  it('Personalessen gewinnt gegen den manuellen Rabatt (praezisere Meldung)', () => {
    const gate = evaluatePromoCodeGate({ isStaffMealOrder: true, hasManualDiscount: true })
    expect(gate.message).toBe(PROMO_CODE_BLOCKED_STAFF_MEAL)
  })
})

describe('buildCodeAppliedDiscount', () => {
  const ctx = { id: 'snap-1', appliedBy: 'user-1', appliedAt: '2026-08-14T10:00:00.000Z' }

  it('uebernimmt Prozent-Rabatte und laesst valueCents leer', () => {
    const snapshot = buildCodeAppliedDiscount(
      {
        ok: true,
        reason: 'ok',
        code: 'WILLKOMMEN10',
        discountCodeId: 'code-1',
        discount: {
          discountId: 'disc-1',
          name: 'Willkommen 10%',
          valueType: 'PERCENT',
          valuePercent: 10,
          valueCents: 0,
          isStaffMeal: false,
        },
      },
      ctx,
    )

    expect(snapshot).toEqual({
      _id: 'snap-1',
      discountId: 'disc-1',
      discountCodeId: 'code-1',
      code: 'WILLKOMMEN10',
      name: 'Willkommen 10%',
      method: 'code',
      target: 'order',
      valueType: 'percent',
      valuePercent: 10,
      valueCents: 0,
      computedAmountCents: 0,
      appliedBy: 'user-1',
      appliedAt: '2026-08-14T10:00:00.000Z',
      isStaffMeal: false,
    })
  })

  it('uebernimmt Betrags-Rabatte und laesst valuePercent leer', () => {
    const snapshot = buildCodeAppliedDiscount(
      {
        ok: true,
        reason: 'ok',
        code: 'FUENFEURO',
        discount: {
          discountId: 'disc-2',
          name: '5 € Gutschein',
          valueType: 'amount',
          valuePercent: 0,
          valueCents: 500,
          isStaffMeal: false,
        },
      },
      ctx,
    )

    expect(snapshot.valueType).toBe('amount')
    expect(snapshot.valueCents).toBe(500)
    expect(snapshot.valuePercent).toBe(0)
    expect(snapshot.discountCodeId).toBeNull()
  })

  it('rechnet den Rabattbetrag NICHT selbst aus — das macht computeOrderTax', () => {
    // Ein hier gefuellter Betrag waere eine zweite Wahrheit neben der Engine und
    // liefe bei jeder Mengenaenderung aus dem Ruder.
    const snapshot = buildCodeAppliedDiscount(
      {
        ok: true,
        reason: 'ok',
        code: 'X',
        discount: {
          discountId: 'd',
          name: 'n',
          valueType: 'percent',
          valuePercent: 50,
          valueCents: 0,
          isStaffMeal: false,
        },
      },
      ctx,
    )
    expect(snapshot.computedAmountCents).toBe(0)
  })

  it('ein per Code gewaehrter Rabatt ist nie Personalessen', () => {
    // Sonst stempelte die Bestellung staffPaymentInfo und liefe in die
    // Exklusivitaetspruefung — mit einem Rabatt, den kein Mitarbeiter gewaehlt hat.
    const snapshot = buildCodeAppliedDiscount(
      {
        ok: true,
        reason: 'ok',
        code: 'X',
        discount: {
          discountId: 'd',
          name: 'n',
          valueType: 'percent',
          valuePercent: 10,
          valueCents: 0,
          isStaffMeal: true,
        },
      },
      ctx,
    )
    expect(snapshot.isStaffMeal).toBe(false)
  })

  it('haelt auch eine Antwort ohne Rabattdetails aus (defensiv, kein Absturz an der Kasse)', () => {
    const snapshot = buildCodeAppliedDiscount({ ok: true, reason: 'ok', code: 'X' }, ctx)
    expect(snapshot.name).toBe('Rabattcode')
    expect(snapshot.discountId).toBeNull()
    expect(snapshot.valueType).toBe('amount')
    expect(snapshot.valueCents).toBe(0)
  })
})
