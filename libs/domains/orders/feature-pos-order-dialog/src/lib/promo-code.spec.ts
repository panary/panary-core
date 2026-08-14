import { describe, expect, it } from 'vitest'

import type { CodeCheckResult } from '@panary/discounts/data-access'

import {
  PROMO_CODE_BLOCKED_MANUAL,
  PROMO_CODE_BLOCKED_STAFF_MEAL,
  buildCodeAppliedDiscount,
  evaluatePromoCodeGate,
  redeemCodeForOrder,
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

describe('redeemCodeForOrder', () => {
  /** Zeichnet auf, was die Einloesung zu sehen bekam — je Test eine eigene Instanz. */
  const makeDeps = (result: CodeCheckResult) => {
    const seen: Array<{ code: string; orderId: string }> = []
    const issued: string[] = []
    let seq = 0
    return {
      seen,
      issued,
      deps: {
        redeem: async (input: { code: string; orderId: string }) => {
          seen.push(input)
          return result
        },
        newOrderId: () => {
          const id = `order-${++seq}`
          issued.push(id)
          return id
        },
      },
    }
  }

  it('ohne Code passiert nichts — keine ID, kein Aufruf', async () => {
    const { deps, seen, issued } = makeDeps({ ok: true, reason: 'ok' })
    expect(await redeemCodeForOrder(null, deps)).toEqual({ status: 'skipped' })
    expect(seen).toHaveLength(0)
    expect(issued).toHaveLength(0)
  })

  it('ein nur geprüfter, aber abgelehnter Code loest nichts aus', async () => {
    const { deps, seen } = makeDeps({ ok: true, reason: 'ok' })
    const out = await redeemCodeForOrder({ ok: false, reason: 'expired' }, deps)
    expect(out).toEqual({ status: 'skipped' })
    expect(seen).toHaveLength(0)
  })

  it('die Einloesung bekommt GENAU die ID, die zurueckgegeben wird', async () => {
    // Das ist die Invariante des Fixes: Waeren es zwei verschiedene IDs, zeigte
    // die Einloesung ins Leere — genau der Zustand vor diesem Fix (orderId: null).
    const { deps, seen } = makeDeps({ ok: true, reason: 'ok', redemptionId: 'r-1' })
    const out = await redeemCodeForOrder({ ok: true, reason: 'ok', code: 'WILLKOMMEN10' }, deps)

    expect(out.status).toBe('redeemed')
    if (out.status !== 'redeemed') return
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ code: 'WILLKOMMEN10', orderId: out.orderId })
    expect(out.orderId).toBeTruthy()
    expect(out.redeemed.redemptionId).toBe('r-1')
  })

  it('scheitert die Einloesung, faellt die ID weg — die Order bekommt ihre vom Server', async () => {
    const { deps, seen } = makeDeps({ ok: false, reason: 'limit_reached' })
    const out = await redeemCodeForOrder({ ok: true, reason: 'ok', code: 'AUSGESCHOEPFT' }, deps)

    expect(out).toEqual({ status: 'failed', reason: 'limit_reached' })
    // Eine ID wurde erzeugt und mitgeschickt — sie darf aber nirgends ankommen.
    expect(seen).toHaveLength(1)
    expect(out).not.toHaveProperty('orderId')
  })

  it('vergibt genau EINE ID je Einloesung (keine Doppelvergabe)', async () => {
    const { deps, issued } = makeDeps({ ok: true, reason: 'ok' })
    await redeemCodeForOrder({ ok: true, reason: 'ok', code: 'X' }, deps)
    expect(issued).toHaveLength(1)
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
