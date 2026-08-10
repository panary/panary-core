import { describe, it, expect } from 'vitest'
import { computeCashReconciliation } from './cash-reconciliation'

describe('cash-reconciliation', () => {
  it('expected = opening + sales − drops − payouts', () => {
    const r = computeCashReconciliation({
      openingFloatCents: 10000, // 100€ Wechselgeld
      cashSalesCents: 50000, // 500€ Bargeld-Umsatz
      cashDropsCents: 20000, // 200€ in den Safe
      payoutsCents: 1500, // 15€ Lieferanten
      countedClosingFloatCents: 38500,
    })
    expect(r.expectedClosingFloatCents).toBe(10000 + 50000 - 20000 - 1500)
    expect(r.varianceCents).toBe(0)
  })

  it('negative Variance = Fehlbetrag', () => {
    const r = computeCashReconciliation({
      openingFloatCents: 10000,
      cashSalesCents: 30000,
      cashDropsCents: 0,
      payoutsCents: 0,
      countedClosingFloatCents: 39000, // 10€ fehlen → counted 39000 − expected 40000 = −1000
    })
    expect(r.varianceCents).toBe(-1000)
  })

  it('positive Variance = Überschuss', () => {
    const r = computeCashReconciliation({
      openingFloatCents: 10000,
      cashSalesCents: 30000,
      cashDropsCents: 0,
      payoutsCents: 0,
      countedClosingFloatCents: 41000, // 10€ zu viel → counted 41000 − expected 40000 = 1000
    })
    expect(r.varianceCents).toBe(1000)
  })
})
