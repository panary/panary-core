// Geldarithmetik in Cents als Integer — für die Live-Preis-/Steuer-Engine.
//
// Warum: JavaScript-Floats verlieren bei Multiplikation/Akkumulation regelmäßig
// 1ct durch IEEE-754-Rundung (0.1 + 0.2 === 0.30000000000000004). Über eine
// Order mit mehreren Positionen × Steuersätzen × Rabatten akkumuliert der Drift
// und ist für einen lückenlosen Z-Bon (KassenSichV) nicht tolerierbar.
//
// Konvention: Eingangswerte (Euro als Float) werden mit `toCents()` am Rand
// konvertiert; innerhalb der Engine läuft nur Integer-Arithmetik; beim Schreiben
// des taxSnapshot wird mit `fromCents()` zurückkonvertiert.
//
// Hinweis: Der Reporting-Aggregator (`businessdays/aggregator/.../money.ts`) hat
// eine inhaltlich identische Helper-Sammlung. Eine spätere Konsolidierung nach
// `@panary/shared-common` ist sinnvoll — orders/domain darf den Aggregator aber
// nicht importieren (Zyklus, da der Aggregator orders/domain konsumiert).

const SCALE = 100

/** Euro (Float/String/null) → Cents (Integer). Kommerzielle Rundung (half-away-from-zero). */
export function toCents(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined) return 0
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return 0
  return Math.round(n * SCALE)
}

/** Cents (Integer) → Euro-Anzeigewert (2 Nachkommastellen). Nur fürs Schreiben/Rendern, nicht für weitere Arithmetik. */
export function fromCents(cents: number): number {
  return cents / SCALE
}

/** Exakte Integer-Summe einer Cent-Liste. */
export function sumCents(values: ReadonlyArray<number>): number {
  let total = 0
  for (const v of values) total += v
  return total
}

/** Einzelpreis-Cents × Menge (Menge darf dezimal sein, z. B. 1.5 kg), Resultat gerundet. */
export function multiplyCents(cents: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0
  return Math.round(cents * quantity)
}

/**
 * Extrahiert den Netto-Anteil aus einem Brutto-Cent-Wert bei gegebenem Steuersatz.
 *   netFromGross(11900, 19) === 10000  (100,00€ Netto in 119,00€ Brutto)
 *
 * Das ist die fiskalisch korrekte eingebettete-MwSt-Extraktion (identisch zum
 * Reporting-Aggregator). NICHT `gross * (1 - rate/100)` — das überschätzt die Steuer.
 */
export function netFromGross(grossCents: number, taxRatePercent: number): number {
  return Math.round((grossCents * 100) / (100 + taxRatePercent))
}

/** Steuer-Anteil eines Brutto-Cent-Werts. Komplementär zu netFromGross (net + tax === gross). */
export function taxFromGross(grossCents: number, taxRatePercent: number): number {
  return grossCents - netFromGross(grossCents, taxRatePercent)
}

/**
 * Verteilt einen Gesamt-Cent-Betrag (z. B. einen Festbetrag-Rabatt) proportional zu
 * den Gewichten auf N Eimer — deterministisch und summen-exakt via Largest-Remainder.
 *
 * Garantie: Σ Resultat === totalCents (sofern totalCents <= Σ weights bzw. geklemmt),
 * keine verlorenen/erfundenen Cents durch unabhängiges Runden pro Eimer.
 */
export function distributeByLargestRemainder(
  totalCents: number,
  weights: ReadonlyArray<number>,
): number[] {
  const weightSum = sumCents(weights)
  if (weightSum <= 0 || totalCents <= 0) return weights.map(() => 0)

  const exact = weights.map(w => (totalCents * w) / weightSum)
  const floored = exact.map(v => Math.floor(v))
  let remainder = totalCents - sumCents(floored)

  // Verbleibende Cents an die größten Nachkomma-Reste vergeben.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)

  const result = [...floored]
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k].i] += 1
    remainder -= 1
  }
  return result
}
