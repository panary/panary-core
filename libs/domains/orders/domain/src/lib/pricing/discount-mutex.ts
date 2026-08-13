import { AppliedDiscount, Discount } from '../order.schema'

// Invariante „discount-mutex" — Abschaffung des Legacy-Rabattfelds.
//
// Eine Order kannte zwei Rabattquellen (siehe compute-order-tax.ts):
//   1. `appliedDiscounts[]` — das Modell; ist es nicht-leer, ist es fuer
//      Tax-Engine UND Bon-Renderer FUEHREND (`order.discount` wird ignoriert).
//   2. `discount` — Legacy-Einzel-Order-Rabatt (Fallback, nur wenn appliedDiscounts leer).
//
// Zwei Quellen fuer dieselbe Aussage sind mehrdeutig („welcher Rabatt gilt?"), und die
// Mehrdeutigkeit war nicht theoretisch: Patchte ein Flow nur `{ discount }` auf eine
// Order, die in der DB bereits `appliedDiscounts` trug, wurde der Legacy-Wert
// gespeichert, aber von der Engine ignoriert — ein persistierter Rabatt ohne Wirkung
// auf Preis, `taxSnapshot` und Bon (panary/panary-core#181). Der frueher hier
// implementierte Payload-Vergleich konnte das nicht sehen, weil er den gespeicherten
// Vorzustand nicht kannte.
//
// Entscheidung (ADR 0030): keine Kombinationsregel, sondern Abschaffung. Es gibt genau
// eine Rabattquelle, und das ist `appliedDiscounts`.
//
// Daraus folgen die zwei Funktionen unten — bewusst mit unterschiedlicher Haerte:
//
//   * EXTERN (echte Clients): `findLegacyDiscountWrite` → der Schreibzugriff wird
//     sichtbar mit 400 abgelehnt. Stilles Strippen waere die gleiche Fehlerklasse wie
//     vorher: Ein Client meldet einen Rabatt an, der Server verwirft ihn wortlos.
//   * INTERN (Sync-Apply, Migrations-Pfade): `clearLegacyDiscountIfApplied` — der
//     bisherige Mutex bleibt. Ein 400 waere im Sync-Apply TERMINAL (rejected ohne
//     Retry); Bestandsdaten von Alt-Edges wuerden dauerhaft haengenbleiben. Alt-Werte
//     werden dort weiter still bereinigt, sobald `appliedDiscounts` mitkommt.

/**
 * Liefert den fuer den `discount`-Data-Resolver (create/patch) aufzuloesenden Wert:
 * `null`, sobald die Order eine nicht-leere `appliedDiscounts`-Liste traegt, sonst
 * der unveraenderte Eingangswert.
 *
 * Rueckgabe `null` (nicht `undefined`), damit ein PATCH einen bereits gespeicherten
 * Legacy-`discount` tatsaechlich ueberschreibt — ein `undefined`-Resolver-Ergebnis
 * wuerde das Feld nur weglassen und den Alt-Wert in der DB stehen lassen.
 */
export function clearLegacyDiscountIfApplied(
  value: Discount | null | undefined,
  data: { appliedDiscounts?: AppliedDiscount[] | null },
): Discount | null | undefined {
  const hasApplied = Array.isArray(data.appliedDiscounts) && data.appliedDiscounts.length > 0
  return hasApplied ? null : value
}

export interface LegacyDiscountWriteInput {
  discount?: Discount | null
}

/**
 * Liefert eine Fehlerbeschreibung, wenn ein Schreibzugriff den abgeschafften
 * Legacy-`discount` mit einem Wert belegt — sonst `null`. Nicht-werfend, damit
 * UI-Code den Zustand abfragen kann, ohne try/catch zu bauen.
 *
 * `discount: null` und `discount: undefined` sind ausdruecklich erlaubt: Das LEEREN
 * eines Alt-Werts ist der Migrationspfad, nicht sein Gegenteil. Die POS-Flows senden
 * es beim Rabattieren mit, damit ein vor der Umstellung gespeicherter Legacy-Wert
 * verschwindet.
 */
export function findLegacyDiscountWrite(data: LegacyDiscountWriteInput | null | undefined): string | null {
  if (!data?.discount) return null
  return (
    'Das Feld `discount` ist abgeschafft und wird nicht mehr angenommen. ' +
    'Rabatte gehoeren als Snapshot nach `appliedDiscounts`.'
  )
}

/** Werfende Variante fuer Server-Hooks. Wirft `Error` mit sprechender Meldung. */
export function assertNoLegacyDiscountWrite(data: LegacyDiscountWriteInput | null | undefined): void {
  const conflict = findLegacyDiscountWrite(data)
  if (conflict) throw new Error(conflict)
}
