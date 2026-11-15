/**
 * Versionsbausteine fuer die Kompatibilitaets-Regeln aus ADR 0070 (core#1437).
 *
 * Versionen haben das Format `YY.MM.INDEX` (`tools/scripts/bump-version.mjs`), der Index springt im
 * Monatswechsel auf 1. Die Fenster des ADR sind in Monatsstaenden bemessen, nie in Releases: Eine Woche
 * bringt zwischen 2 und ueber 10 Releases, ein Monat ist die stabile Einheit.
 *
 * Alles, was keine solche Version ist, ist „unbekannt" (`null`) und nie ein Rueckstand. Das betrifft real
 * vorkommende Werte: `staging-<sha>` (build-edge-docker.yml), `pr-check`, `smoke`, den Platzhalter `0.0.0`.
 * Ein Vergleich darauf wuerde sonst Jahre Rueckstand melden und Alarm ausloesen.
 */

export interface PanaryVersion {
  /** Zweistelliges Jahr, `26` fuer 2026. */
  year: number
  /** Monat 1–12, ohne fuehrende Null. */
  month: number
  /** Zaehler innerhalb des Monats, ab 1. */
  index: number
}

// Zweistelliges Jahr, damit `0.0.0` und `2026.11.15` nicht als Version durchgehen.
const VERSION_PATTERN = /^v?(\d{2})\.(\d{1,2})\.(\d{1,6})$/

/** Zerlegt `YY.MM.INDEX` (auch `v26.11.15`); alles andere ist `null`. */
export function parsePanaryVersion(input: unknown): PanaryVersion | null {
  if (typeof input !== 'string') return null
  const match = VERSION_PATTERN.exec(input.trim())
  if (!match) return null
  const [year, month, index] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || index < 1) return null
  return { year, month, index }
}

/** -1, 0 oder 1 nach Jahr, Monat, Index; `null`, sobald eine Seite keine Version ist. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const left = parsePanaryVersion(a)
  const right = parsePanaryVersion(b)
  if (!left || !right) return null
  for (const key of ['year', 'month', 'index'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return 0
}

/**
 * Rueckstand des Kandidaten gegenueber der Referenz in Monatsstaenden. Verglichen wird nur der Monatsstand,
 * nie der Index: Innerhalb eines Monats ist der Rueckstand immer 0.
 *
 * Vorzeichen: positiv = der Kandidat liegt hinter der Referenz zurueck, negativ = er ist NEUER als die
 * Referenz (der Datenverlust-Pfad aus ADR 0070: ein Edge, der neuer ist als die Cloud-Libs). `null`, wenn
 * eine Seite keine Version ist.
 */
export function monthsBehind(referenz: unknown, kandidat: unknown): number | null {
  const ref = parsePanaryVersion(referenz)
  const cand = parsePanaryVersion(kandidat)
  if (!ref || !cand) return null
  return ref.year * 12 + ref.month - (cand.year * 12 + cand.month)
}

/**
 * Weicht der laufende Build von der Version ab, die der Server meldet? Grundlage des Update-Hinweises in den
 * Browser-Clients (core#1439): Jede Abweichung genuegt, nicht erst ein Monatsrueckstand, denn nach einem
 * Neuladen liefert der Server ohnehin den autoritativen Stand.
 *
 * `false`, sobald eine Seite keine `YY.MM.INDEX`-Version ist (`staging-<sha>`, `pr-check`, `0.0.0`, ein leerer
 * oder fehlender Wert): Dort ist ein Vergleich nicht sinnvoll, und ein falscher Hinweis waere schlimmer als keiner.
 */
export function isVersionDrift(build: unknown, server: unknown): boolean {
  const order = compareVersions(build, server)
  return order !== null && order !== 0
}
