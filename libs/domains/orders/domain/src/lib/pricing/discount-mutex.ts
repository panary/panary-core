import { AppliedDiscount, Discount } from '../order.schema'

// Einweg-Migrations-Invariante „discount-mutex".
//
// Eine Order kennt zwei Rabattquellen (siehe compute-order-tax.ts):
//   1. `appliedDiscounts[]` — neues Modell; ist es nicht-leer, ist es fuer
//      Tax-Engine UND Bon-Renderer FUEHREND (`order.discount` wird ignoriert).
//   2. `discount` — Legacy-Einzel-Order-Rabatt (Fallback, nur wenn appliedDiscounts leer).
//
// Der Frontend-Data-Access-Layer (order.service.ts) setzt beim Anlegen einer
// rabattierten Order BEIDE Felder — `discount` als „Legacy-Spiegel". Damit bleibt
// nach dem Persistieren ein stale, fachlich unwirksamer `discount` in DB/Sync/Audit
// zurueck und erzeugt Mehrdeutigkeit („welcher Rabatt gilt?"). Diese Invariante
// loest das serverseitig: sobald (nicht-leere) `appliedDiscounts` geschrieben werden,
// gewinnt das neue Feld und der Legacy-`discount` wird aktiv geleert.
//
// Rueckgabe `null` (nicht `undefined`), damit ein PATCH einen bereits gespeicherten
// Legacy-`discount` tatsaechlich ueberschreibt — ein `undefined`-Resolver-Ergebnis
// wuerde das Feld nur weglassen und den Alt-Wert in der DB stehen lassen.
//
// Ist `appliedDiscounts` leer/ungesetzt, bleibt der Legacy-Rabatt als aktiver
// Fallback unveraendert erhalten.

/**
 * Liefert den fuer den `discount`-Data-Resolver (create/patch) aufzuloesenden Wert:
 * `null`, sobald die Order eine nicht-leere `appliedDiscounts`-Liste traegt, sonst
 * der unveraenderte Eingangswert.
 */
export function clearLegacyDiscountIfApplied(
  value: Discount | null | undefined,
  data: { appliedDiscounts?: AppliedDiscount[] | null },
): Discount | null | undefined {
  const hasApplied = Array.isArray(data.appliedDiscounts) && data.appliedDiscounts.length > 0
  return hasApplied ? null : value
}
