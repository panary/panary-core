import { describe, expect, it } from 'vitest'

import {
  computeSubscriptionQuote,
  ENTERPRISE_NEGOTIATION_THRESHOLD,
  resolveVolumeDiscountPct,
} from './subscription-pricing'

describe('resolveVolumeDiscountPct', () => {
  it.each([
    [1, 0],
    [2, 0],
    [3, 15],
    [9, 15],
    [10, 25],
    [24, 25],
    [25, 35],
    [100, 35],
  ])('locationCount=%i → %i%%', (count, expected) => {
    expect(resolveVolumeDiscountPct(count)).toBe(expected)
  })

  it('behandelt < 1 wie 1 Filiale', () => {
    expect(resolveVolumeDiscountPct(0)).toBe(0)
    expect(resolveVolumeDiscountPct(-5)).toBe(0)
  })
})

describe('computeSubscriptionQuote', () => {
  it('Operate, 1 Filiale: kein Rabatt', () => {
    const q = computeSubscriptionQuote({ unitPriceCents: 8900, locationCount: 1 })
    expect(q.discountPct).toBe(0)
    expect(q.effectiveUnitPriceCents).toBe(8900)
    expect(q.totalCents).toBe(8900)
    expect(q.savingsCents).toBe(0)
    expect(q.requiresEnterpriseQuote).toBe(false)
  })

  it('Operate, 5 Filialen: −15 % je Filiale', () => {
    const q = computeSubscriptionQuote({ unitPriceCents: 8900, locationCount: 5 })
    expect(q.discountPct).toBe(15)
    expect(q.effectiveUnitPriceCents).toBe(7565) // round(8900 * 0.85)
    expect(q.listTotalCents).toBe(44500)
    expect(q.totalCents).toBe(37825)
    expect(q.savingsCents).toBe(6675)
  })

  it('Operate, 12 Filialen: −25 % je Filiale', () => {
    const q = computeSubscriptionQuote({ unitPriceCents: 8900, locationCount: 12 })
    expect(q.discountPct).toBe(25)
    expect(q.effectiveUnitPriceCents).toBe(6675) // round(8900 * 0.75)
    expect(q.totalCents).toBe(80100)
  })

  it('25 Filialen → requiresEnterpriseQuote', () => {
    const q = computeSubscriptionQuote({ unitPriceCents: 8900, locationCount: ENTERPRISE_NEGOTIATION_THRESHOLD })
    expect(q.discountPct).toBe(35)
    expect(q.requiresEnterpriseQuote).toBe(true)
  })

  it('rundet pro Filiale (nicht auf den Gesamtbetrag)', () => {
    // 2900 * 0.85 = 2465 (glatt); ungerader Fall: 2999 * 0.85 = 2549.15 → 2549
    const q = computeSubscriptionQuote({ unitPriceCents: 2999, locationCount: 3 })
    expect(q.effectiveUnitPriceCents).toBe(2549)
    expect(q.totalCents).toBe(2549 * 3)
  })

  it('Preis 0 (trial/enterprise) bleibt 0, kein NaN', () => {
    const q = computeSubscriptionQuote({ unitPriceCents: 0, locationCount: 4 })
    expect(q.totalCents).toBe(0)
    expect(q.savingsCents).toBe(0)
    expect(q.discountPct).toBe(15)
  })

  it('locationCount < 1 wird auf 1 geklemmt', () => {
    const q = computeSubscriptionQuote({ unitPriceCents: 8900, locationCount: 0 })
    expect(q.locationCount).toBe(1)
    expect(q.totalCents).toBe(8900)
  })
})
