// Drop-in fuer den Feathers-Validierungs-Hook, das sein Schema am Hook hinterlegt.
//
// Der Boot-Check `services/assert-stamp-fields.ts` braucht zu jedem Service das
// Schema, gegen das ein externer Create bzw. Patch validiert wird. Feathers
// gibt es nicht her: `schemaHooks.validateData(validator)` schliesst den
// Validator in eine Closure ein, der zurueckgegebene Hook traegt keine Spur
// davon (`@feathersjs/schema/lib/hooks/validate.js`).
//
// Bis panary/panary-core#267 kam der Check deshalb ausschliesslich ueber die
// FREIWILLIGE `docs.schemas`-Deklaration ans Schema — und war damit fuer sechs
// Services blind, die keine deklarieren: `audit-events`,
// `discount-code-redeem`, `fiscal-counters`, `sync-conflicts`, `sync-cursor`,
// `sync-outbox`. Darunter ausgerechnet `sync-conflicts`, wo genau diese Klasse
// am 2026-09-12 zuschlug („Mandant: must NOT have additional properties" auf
// jedes „Verwerfen" eines Sync-Konflikts, #183).
//
// Der Marker haengt bewusst an DEM Hook, den core selbst erzeugt, nicht an
// Feathers-Interna: Bricht das Muster bei einem Feathers-Update, faellt der
// Check still auf `docs.schemas` zurueck. Damit das nicht unbemerkt bleibt,
// prueft `stamp-fields-invariant.spec.ts` die Abdeckung getrennt vom Befund —
// „nichts gefunden" und „nicht gesucht" muessen unterscheidbar bleiben.

import { hooks as schemaHooks } from '@feathersjs/schema'

/**
 * Traegt den Validator, gegen den ein Hook validiert. `Symbol.for`, damit der
 * Marker auch ueber Modul-Instanz-Grenzen hinweg derselbe ist (Vitest-Aliase,
 * dist- vs. src-Aufloesung) — gleiche Begruendung wie bei
 * `MULTI_TENANCY_OPTIONS`.
 */
export const VALIDATE_DATA_VALIDATOR = Symbol.for('panary.validateData.validator')

/** AJV-ValidateFunction traegt ihr kompiliertes Schema. Mehr braucht der Check nicht. */
type ValidatorWithSchema = { schema?: unknown }

/**
 * Haengt einen Validator an einen bereits gebauten Hook. Fuer die Faelle, in
 * denen ein Service den Validierungs-Hook nicht direkt registriert, sondern in
 * eigene Logik einwickelt (z. B. die `fromSync`-Weiche in `business-days`) —
 * dort muss der Marker an den zusammengesetzten Hook wandern, sonst sieht der
 * Boot-Check nur die Huelle.
 *
 * Anzugeben ist der Validator des EXTERNEN Pfades: interne Pfade (`fromSync`,
 * `provider: undefined`) stempeln nicht, ihr Schema ist fuer diese
 * Fehlerklasse irrelevant.
 */
export const markValidateData = <H>(hook: H, validator: unknown): H => {
  Object.defineProperty(hook, VALIDATE_DATA_VALIDATOR, { value: validator, enumerable: false })
  return hook
}

/**
 * Der Feathers-Validierungs-Hook mit Marker. Verhalten identisch — der Hook
 * wird unveraendert von Feathers gebaut und nur zusaetzlich beschriftet.
 */
export const validateData = <S>(validator: S) =>
  markValidateData(schemaHooks.validateData(validator as never), validator)

/**
 * Liest das Schema aus einem markierten Hook. `undefined`, wenn der Hook nicht
 * markiert ist oder der Validator kein Schema traegt.
 */
export const readMarkedSchema = (hook: unknown): unknown => {
  const validator = (hook as Record<symbol, unknown> | undefined)?.[VALIDATE_DATA_VALIDATOR]
  if (!validator) return undefined
  return (validator as ValidatorWithSchema).schema
}
