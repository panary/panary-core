// Geldarithmetik in Cents als Integer.
//
// Warum: JavaScript-Floats verlieren bei Multiplikation/Akkumulation
// regelmäßig 1ct durch IEEE-754-Rundung. Beispiel:
//   0.1 + 0.2 === 0.30000000000000004
// Bei einem Tag mit 200 Bestellungen × 5 Steuersätzen sind das schnell
// 1.000+ Operationen — der akkumulierte Drift ist nicht tolerierbar
// für einen lückenlosen Z-Bon.
//
// Konvention: Alle Eingangswerte (z. B. `Order.payment.totalAmount` als Euro)
// werden mit `toCents()` am Lib-Rand konvertiert. Innerhalb der Pipeline läuft
// nur noch Integer-Arithmetik. Beim Rendern in der UI wird mit `fromCents()`
// zurück konvertiert.

const SCALE = 100

/**
 * Konvertiert einen Geldbetrag (z. B. Euro als Float oder String) in Cents als Integer.
 *
 * Rundungsregel: kommerzielle Rundung (banker's rounding wäre auch denkbar,
 * aber commercial = half-away-from-zero ist die intuitive Wahl für Endkunden-
 * Beträge im DACH-Raum).
 *
 * Akzeptiert: `number | string | null | undefined` — `null`/`undefined` → 0.
 */
export function toCents(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined) return 0
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return 0
  // Math.round für kommerzielle Rundung; +/- 0.5 wird weg von 0 gerundet,
  // konsistent über positive und negative Werte (Storno-Refund).
  return Math.round(n * SCALE)
}

/**
 * Konvertiert Cents (Integer) zurück in eine Anzeige-Number (Euro mit 2 Nachkommastellen).
 *
 * Für UI-Rendering — niemals für weitere Arithmetik verwenden.
 */
export function fromCents(cents: number): number {
  // `(cents | 0) / 100` würde 32-bit-Truncate erzwingen; bei großen
  // Aggregaten (> 21M Euro = 2.1B Cents) ist das zu wenig. Direkter
  // Float-Quotient ist hier OK, weil das Resultat nur zur Anzeige geht.
  return cents / SCALE
}

/** Summiert eine Liste von Cent-Beträgen exakt (Integer-Addition). */
export function sumCents(values: ReadonlyArray<number>): number {
  let total = 0
  for (const v of values) total += v
  return total
}

/**
 * Multipliziert einen Cent-Betrag mit einer Mengenangabe (Stückzahl × Preis).
 * Mengen können Fließkomma sein (1.5 kg, 0.25 L), das Resultat wird wieder gerundet.
 */
export function multiplyCents(cents: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0
  return Math.round(cents * quantity)
}

/**
 * Wendet einen prozentualen Steuersatz auf einen Netto-Cent-Wert an
 * und liefert den Steuer-Anteil als Cents. Beispiel:
 *   applyTaxRate(10000, 19) === 1900  (19% von 100,00€ → 19,00€)
 *
 * Wir multiplizieren mit `100` und teilen am Ende, um Float-Drift zu vermeiden.
 */
export function applyTaxRate(netCents: number, taxRatePercent: number): number {
  return Math.round((netCents * taxRatePercent) / 100)
}

/**
 * Berechnet aus einem Brutto-Cent-Wert den Netto-Anteil bei gegebenem Steuersatz.
 *   netFromGross(11900, 19) === 10000
 *
 * Verwendet exakte Integer-Mathematik:
 *   net = round(gross × 100 / (100 + rate))
 */
export function netFromGross(grossCents: number, taxRatePercent: number): number {
  return Math.round((grossCents * 100) / (100 + taxRatePercent))
}

/**
 * Berechnet aus einem Brutto-Cent-Wert den Steuer-Anteil bei gegebenem Steuersatz.
 *   taxFromGross(11900, 19) === 1900
 *
 * Komplementär zu netFromGross — beide zusammen ergeben exakt den Brutto-Wert
 * (höchstens ±1 ct Rundungstoleranz, da unabhängig gerundet wird).
 */
export function taxFromGross(grossCents: number, taxRatePercent: number): number {
  return grossCents - netFromGross(grossCents, taxRatePercent)
}
