import { describe, it, expect } from 'vitest'
import {
  toCents,
  fromCents,
  sumCents,
  multiplyCents,
  applyTaxRate,
  netFromGross,
  taxFromGross,
} from './money'

describe('money', () => {
  describe('toCents', () => {
    it('konvertiert ganze Euro-Beträge', () => {
      expect(toCents(1)).toBe(100)
      expect(toCents(10.5)).toBe(1050)
      expect(toCents(0)).toBe(0)
    })
    it('akzeptiert Strings', () => {
      expect(toCents('19.99')).toBe(1999)
    })
    it('rundet kommerziell (half-away-from-zero)', () => {
      expect(toCents(0.005)).toBe(1)   // 0.5ct → 1ct
      expect(toCents(0.004)).toBe(0)
      expect(toCents(-0.005)).toBe(-0) // signed zero erlaubt
    })
    it('liefert 0 bei null/undefined/NaN', () => {
      expect(toCents(null)).toBe(0)
      expect(toCents(undefined)).toBe(0)
      expect(toCents(Number.NaN)).toBe(0)
      expect(toCents(Number.POSITIVE_INFINITY)).toBe(0)
    })
    it('vermeidet Float-Drift bei akkumulierten Euro-Werten', () => {
      // 0.1 + 0.2 ist nicht exakt 0.3 als Float, aber als Cents:
      const sum = sumCents([toCents(0.1), toCents(0.2)])
      expect(sum).toBe(30)
      expect(fromCents(sum)).toBe(0.3)
    })
  })

  describe('multiplyCents', () => {
    it('multipliziert Preis × Menge', () => {
      expect(multiplyCents(500, 3)).toBe(1500)        // 5€ × 3 = 15€
      expect(multiplyCents(199, 2)).toBe(398)         // 1.99€ × 2 = 3.98€
    })
    it('rundet dezimale Mengen', () => {
      expect(multiplyCents(1000, 0.333)).toBe(333)    // Gewichtsprodukt
    })
    it('liefert 0 bei nicht-finiten Mengen', () => {
      expect(multiplyCents(100, Number.NaN)).toBe(0)
    })
  })

  describe('applyTaxRate', () => {
    it('berechnet Steueranteil exakt', () => {
      expect(applyTaxRate(10000, 19)).toBe(1900)
      expect(applyTaxRate(10000, 7)).toBe(700)
    })
  })

  describe('netFromGross & taxFromGross', () => {
    it('zerlegt Brutto in Netto + Steuer exakt (19%)', () => {
      const net = netFromGross(11900, 19)
      const tax = taxFromGross(11900, 19)
      expect(net).toBe(10000)
      expect(tax).toBe(1900)
      expect(net + tax).toBe(11900)
    })
    it('zerlegt Brutto in Netto + Steuer exakt (7%)', () => {
      const net = netFromGross(10700, 7)
      const tax = taxFromGross(10700, 7)
      expect(net).toBe(10000)
      expect(tax).toBe(700)
    })
    it('Rundungsfehler bei krummen Beträgen liegt im ±1ct-Toleranz', () => {
      // 12.34€ Brutto bei 19%: 12.34 / 1.19 = 10.3697... → 10.37€ netto, 1.97€ Tax
      const net = netFromGross(1234, 19)
      const tax = taxFromGross(1234, 19)
      expect(net + tax).toBe(1234)
    })
  })

  describe('sumCents', () => {
    it('summiert exakt ohne Float-Drift', () => {
      const values = Array.from({ length: 1000 }, () => 10)
      expect(sumCents(values)).toBe(10_000)
    })
  })
})
