import { describe, expect, it } from 'vitest'

import { menuComponentSurchargeLineCents, menuComponentSurchargePerUnitCents } from './menu-component-surcharge'

describe('menuComponentSurchargePerUnitCents (#1452)', () => {
  it('liefert den festgeschriebenen Aufschlag je Stück in Cents', () => {
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { amount: 1, surcharge: 0.6 })).toBe(60)
  })

  it('rechnet Euro-Gleitkomma cent-genau um (0,7 € → 70, nicht 69)', () => {
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { amount: 1, surcharge: 0.7 })).toBe(70)
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { amount: 1, surcharge: 1.15 })).toBe(115)
  })

  it('ist 0, wenn das Feld fehlt (Bestand, ältere Kassen): kein Betrag, kein Rückgriff auf den Komponentenpreis', () => {
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { amount: 1 })).toBe(0)
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { amount: 1, surcharge: null })).toBe(0)
  })

  it('ist 0 bei Aufschlag 0 und bei ungültigen Werten', () => {
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { surcharge: 0 })).toBe(0)
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { surcharge: -1 })).toBe(0)
    expect(menuComponentSurchargePerUnitCents({ amount: 1 }, { surcharge: Number.NaN })).toBe(0)
  })

  it('ist 0 bei FIXED_PROPORTIONAL, auch wenn ein Aufschlag am Slot steht', () => {
    expect(
      menuComponentSurchargePerUnitCents({ amount: 1, bundlePricingMode: 'FIXED_PROPORTIONAL' }, { surcharge: 0.6 }),
    ).toBe(0)
  })

  it('zählt bei ROLLUP und ohne Modus den Aufschlag', () => {
    expect(menuComponentSurchargePerUnitCents({ bundlePricingMode: 'ROLLUP' }, { surcharge: 0.6 })).toBe(60)
    expect(menuComponentSurchargePerUnitCents({}, { surcharge: 0.6 })).toBe(60)
  })
})

describe('menuComponentSurchargeLineCents (#1452)', () => {
  it('Menge 1 an Zeile und Komponente: gleich dem Aufschlag je Stück', () => {
    expect(menuComponentSurchargeLineCents({ amount: 1 }, { amount: 1, surcharge: 0.6 })).toBe(60)
  })

  it('skaliert mit der Zeilenmenge (2 Menüs → 1,20 €)', () => {
    expect(menuComponentSurchargeLineCents({ amount: 2 }, { amount: 1, surcharge: 0.6 })).toBe(120)
  })

  it('skaliert mit der Komponentenmenge (2 Getränke je Menü → 1,20 €)', () => {
    expect(menuComponentSurchargeLineCents({ amount: 1 }, { amount: 2, surcharge: 0.6 })).toBe(120)
  })

  it('skaliert mit beiden Mengen (3 Menüs × 2 Getränke → 3,60 €)', () => {
    expect(menuComponentSurchargeLineCents({ amount: 3 }, { amount: 2, surcharge: 0.6 })).toBe(360)
  })

  it('fehlende Mengen zählen als 1', () => {
    expect(menuComponentSurchargeLineCents({}, { surcharge: 0.6 })).toBe(60)
  })

  it('ist 0 ohne Aufschlag und bei FIXED_PROPORTIONAL, auch bei Menge 2', () => {
    expect(menuComponentSurchargeLineCents({ amount: 2 }, { amount: 2 })).toBe(0)
    expect(
      menuComponentSurchargeLineCents(
        { amount: 2, bundlePricingMode: 'FIXED_PROPORTIONAL' },
        { amount: 2, surcharge: 0.6 },
      ),
    ).toBe(0)
  })
})
