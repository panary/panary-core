/**
 * Reine Logik der Bezahlansicht „nur Bar" (core#831): Eingabe des gegebenen Betrags in Cent, Rückgeld und
 * Schnellbeträge. Alles in ganzen Cent — Euro-Beträge mit Nachkommastellen addieren sich nicht exakt.
 */

/** Obergrenze der Eingabe (100 000 €): Tippfehler mit zu vielen Ziffern landen nicht im Kassenbuch. */
export const MAX_GIVEN_CENTS = 10_000_000

/** Scheine, aus denen die Schnellbeträge gebildet werden. */
const QUICK_NOTES_CENTS = [500, 1000, 2000, 5000, 10000, 20000] as const

/** Höchstens so viele Schnellbeträge neben „Passend". */
const MAX_QUICK_AMOUNTS = 3

export const toCents = (euro: number): number => Math.round(euro * 100)

/** Ziffer von rechts eingeben, wie an einer Registrierkasse: 5, 0, 0 → 5,00 €. */
export const appendCashDigit = (cents: number, digit: number): number => {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return cents
  return Math.min(MAX_GIVEN_CENTS, cents * 10 + digit)
}

export const removeCashDigit = (cents: number): number => Math.floor(cents / 10)

/** Rückgeld in Cent, nie negativ — fehlt Geld, steht dort 0 und „Bar kassieren" bleibt gesperrt. */
export const changeCents = (givenCents: number, totalCents: number): number => Math.max(0, givenCents - totalCents)

/** Kassieren ist erst möglich, wenn der Betrag da ist und die Summe größer als 0 ist. */
export const canCollect = (givenCents: number, totalCents: number): boolean =>
  totalCents > 0 && givenCents >= totalCents

/**
 * Schnellbeträge über der Summe: die nächsten runden Scheine, die die Summe decken. „Passend" ist ein eigener
 * Knopf und steht nicht in der Liste.
 */
export const quickAmounts = (totalCents: number): number[] =>
  QUICK_NOTES_CENTS.filter(note => note > totalCents).slice(0, MAX_QUICK_AMOUNTS)
