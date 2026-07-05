import { describe, expect, it } from 'vitest'
import { distributeByLargestRemainder, fromCents, multiplyCents, netFromGross, sumCents, taxFromGross, toCents } from './money'

// Sperrt die Cent-Arithmetik der Live-Preis-/Steuer-Engine fest (#40).
//
// Besonders wichtig: das Rundungs-Verhalten bei negativen Beträgen. `Math.round`
// rundet .5-Grenzen Richtung +∞ (half-up) — für POSITIVE Beträge ist das identisch
// mit kaufmännischer Rundung (half-away-from-zero), für NEGATIVE nicht:
// -2,5 ct → -2 ct (nicht -3). Negative Beträge kommen im Engine-Fluss regulär
// nicht vor (Schema: price/amount minimum 0), das Verhalten wird hier aber
// bewusst gelockt, damit eine spätere Änderung (z. B. echte kaufmännische
// Rundung) als Diff sichtbar wird.

/** Deterministischer PRNG (mulberry32) — reproduzierbare Property-Tests ohne Zusatz-Dependency. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('toCents', () => {
  it('konvertiert Euro-Werte und Strings in Integer-Cents', () => {
    expect(toCents(1)).toBe(100)
    expect(toCents(19.99)).toBe(1999)
    expect(toCents('19.99')).toBe(1999)
    expect(toCents(0)).toBe(0)
  })

  it('liefert 0 bei null/undefined/NaN/Infinity/nicht-numerischen Strings', () => {
    expect(toCents(null)).toBe(0)
    expect(toCents(undefined)).toBe(0)
    expect(toCents(Number.NaN)).toBe(0)
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0)
    expect(toCents('abc')).toBe(0)
  })

  it('rundet positive .5-Grenzen auf (kaufmännisch)', () => {
    expect(toCents(0.005)).toBe(1)
    expect(toCents(0.025)).toBe(3)
    expect(toCents(0.004)).toBe(0)
  })

  it('VERHALTEN: negative .5-Grenzen runden Richtung +∞ (half-up, NICHT half-away-from-zero)', () => {
    // Math.round(-0.5) === -0 und Math.round(-2.5) === -2. Kaufmännische Rundung
    // würde -1 bzw. -3 liefern — der Kommentar in money.ts gilt exakt nur für
    // positive Beträge. Hier bewusst als Ist-Verhalten gelockt.
    expect(toCents(-0.005)).toBe(-0)
    expect(toCents(-0.025)).toBe(-2)
  })

  it('negative Beträge abseits der .5-Grenze runden zur nächsten Ganzzahl', () => {
    expect(toCents(-19.99)).toBe(-1999)
    expect(toCents('-2.50')).toBe(-250)
    expect(toCents(-1.005)).toBe(-100) // Float: -1.005 × 100 liegt knapp über -100,5
  })

  it('vermeidet Float-Drift bei akkumulierten Euro-Werten (0,1 + 0,2)', () => {
    const sum = sumCents([toCents(0.1), toCents(0.2)])
    expect(sum).toBe(30)
    expect(fromCents(sum)).toBe(0.3)
  })
})

describe('multiplyCents', () => {
  it('multipliziert Preis × Menge (auch dezimal) und rundet', () => {
    expect(multiplyCents(500, 3)).toBe(1500)
    expect(multiplyCents(1000, 0.333)).toBe(333)
  })

  it('liefert 0 bei nicht-finiter Menge', () => {
    expect(multiplyCents(100, Number.NaN)).toBe(0)
    expect(multiplyCents(100, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('negative Faktoren reichen das Vorzeichen durch', () => {
    expect(multiplyCents(333, -1)).toBe(-333)
    expect(multiplyCents(-100, 2.5)).toBe(-250)
    expect(multiplyCents(199, -2)).toBe(-398)
  })

  it('VERHALTEN: .5-Grenze rundet Richtung +∞ — asymmetrisch zu positiven Werten', () => {
    expect(multiplyCents(5, 0.5)).toBe(3) // +2,5 → 3 (auf)
    expect(multiplyCents(-5, 0.5)).toBe(-2) // -2,5 → -2 (Richtung +∞, nicht -3)
  })
})

describe('netFromGross / taxFromGross', () => {
  it('extrahiert eingebettete MwSt (11900 @19 % → 10000 + 1900)', () => {
    expect(netFromGross(11900, 19)).toBe(10000)
    expect(taxFromGross(11900, 19)).toBe(1900)
  })

  it('Invariante: net + tax === gross für krumme Beträge und beide Sätze', () => {
    for (const rate of [7, 19]) {
      for (const gross of [1, 3, 99, 1234, 12349, 999999]) {
        expect(netFromGross(gross, rate) + taxFromGross(gross, rate)).toBe(gross)
      }
    }
  })
})

describe('distributeByLargestRemainder', () => {
  it('verteilt summen-exakt nach Gewichten (700 über [440, 230, 90] → [405, 212, 83])', () => {
    expect(distributeByLargestRemainder(700, [440, 230, 90])).toEqual([405, 212, 83])
  })

  it('Gewicht 0 in der Mitte erhält nie einen Rest-Cent; Frac-Tie geht an den früheren Index', () => {
    // exact [1.5, 0, 1.5] → floors [1, 0, 1], Rest 1. Stabiler Sort (ES2019+):
    // bei gleichem Nachkomma-Rest gewinnt der frühere Index.
    expect(distributeByLargestRemainder(3, [1, 0, 1])).toEqual([2, 0, 1])
    expect(distributeByLargestRemainder(7, [3, 0, 4])).toEqual([3, 0, 4])
  })

  it('totalCents <= 0 → Nullen', () => {
    expect(distributeByLargestRemainder(0, [1, 2])).toEqual([0, 0])
    expect(distributeByLargestRemainder(-5, [1, 2])).toEqual([0, 0])
  })

  it('weightSum <= 0 → Nullen', () => {
    expect(distributeByLargestRemainder(10, [0, 0, 0])).toEqual([0, 0, 0])
    expect(distributeByLargestRemainder(10, [])).toEqual([])
    expect(distributeByLargestRemainder(10, [-5, 2])).toEqual([0, 0])
  })

  it('totalCents > Σ Gewichte wird trotzdem summen-exakt verteilt (kein Clamp in der Funktion)', () => {
    // Das Klemmen auf die Brutto-Basis passiert beim Aufrufer (discountAmountCents),
    // nicht hier — die Verteilung selbst bleibt für beliebige positive Totals exakt.
    expect(distributeByLargestRemainder(1000, [3, 7])).toEqual([300, 700])
  })

  it('PROPERTY: Σ Resultat === totalCents, keine negativen Anteile, 0-Gewicht → 0, monoton', () => {
    const rnd = mulberry32(0xc0ffee)
    for (let iter = 0; iter < 300; iter++) {
      const n = 1 + Math.floor(rnd() * 8)
      const weights = Array.from({ length: n }, () => Math.floor(rnd() * 5000))
      const weightSum = weights.reduce((s, w) => s + w, 0)
      const totalCents = 1 + Math.floor(rnd() * Math.max(1, weightSum * 2))
      const result = distributeByLargestRemainder(totalCents, weights)

      expect(result).toHaveLength(n)
      if (weightSum <= 0) {
        expect(result).toEqual(weights.map(() => 0))
        continue
      }
      // Summen-Exaktheit: kein Cent verloren oder erfunden
      expect(sumCents(result)).toBe(totalCents)
      result.forEach((r, i) => {
        expect(r).toBeGreaterThanOrEqual(0)
        if (weights[i] === 0) expect(r).toBe(0)
      })
      // Monotonie: echt größeres Gewicht bekommt nie weniger
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (weights[i] > weights[j]) {
            expect(result[i]).toBeGreaterThanOrEqual(result[j])
          }
        }
      }
    }
  })
})

describe('sumCents', () => {
  it('summiert exakt ohne Float-Drift', () => {
    expect(sumCents(Array.from({ length: 1000 }, () => 10))).toBe(10000)
    expect(sumCents([])).toBe(0)
    expect(sumCents([5, -3])).toBe(2)
  })
})
