import { Discount } from '../order.schema'

// Nachhut der abgeschafften Rabatt-Doppelung (ADR 0030).
//
// Eine Order kannte zwei Rabattquellen: `appliedDiscounts[]` (führend) und `discount`
// (Legacy-Einzelrabatt, Fallback). Der frühere „discount-mutex" leerte `discount`,
// sobald `appliedDiscounts` geschrieben wurden — entschied das aber allein am
// eingehenden Payload und sah deshalb nicht, wenn ein Flow nur `{ discount }` auf eine
// Order patchte, die den gespeicherten Vorzustand bereits trug. Ergebnis war ein
// persistierter Rabatt ohne Wirkung auf Preis, `taxSnapshot` und Bon
// (panary/panary-core#181).
//
// `discount` ist inzwischen aus `orderSchema`, der Engine, der Sync-Feldliste und der
// SQLite-Tabelle entfernt; `clearLegacyDiscountIfApplied` ist damit gegenstandslos und
// entfallen. Übrig bleibt der Guard.
//
// Der Guard ist bewusst NICHT durch `additionalProperties: false` ersetzt worden,
// obwohl `validateData` das Feld ohnehin abwiese: Er läuft als erster Hook — vor
// Sequenznummer und TSE-Start — und nennt beim Namen, was zu tun ist, statt eine
// generische Schema-Verletzung zu melden.
//
// Er feuert auf die ANWESENHEIT des Schlüssels, nicht auf einen Wert. Solange das Feld
// noch existierte, war `discount: null` erlaubt (Migrationspfad: Alt-Wert leeren) —
// seit der Entfernung lehnt das Schema auch `null` ab, und ein Guard, der ausgerechnet
// diesen Fall durchwinkt, würde die eine unklare Fehlermeldung übrig lassen, die er
// verhindern soll.

export interface LegacyDiscountWriteInput {
  discount?: Discount | null
}

/**
 * Liefert eine Fehlerbeschreibung, wenn ein Schreibzugriff das abgeschaffte
 * Legacy-Feld `discount` überhaupt mitschickt — sonst `null`. Nicht-werfend, damit
 * UI-Code den Zustand abfragen kann, ohne try/catch zu bauen.
 *
 * Ausschlaggebend ist die ANWESENHEIT des Schlüssels — auch `discount: null` wird
 * abgelehnt, weil das Feld nicht mehr existiert.
 */
export function findLegacyDiscountWrite(data: LegacyDiscountWriteInput | null | undefined): string | null {
  if (!data || typeof data !== 'object' || !('discount' in data)) return null
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
