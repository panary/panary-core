/**
 * Längste Client-Version, die der Edge vom Handshake übernimmt. Gleiche Grenze wie die
 * Mindestversionen der Heartbeat-Antwort (`sync-heartbeat.schema.ts`); echte Stände (`26.11.15`)
 * brauchen acht Zeichen, Staging-Tags (`staging-ab12cd3`) etwas mehr.
 */
export const MAX_CLIENT_VERSION_LENGTH = 50

/**
 * Liest `clientVersion` aus dem Socket-`auth` einer Geräteverbindung (core#1438, ADR 0070).
 *
 * Tolerant: Ein älterer POS sendet das Feld nicht, ein fremder Client womöglich Unsinn. In beiden
 * Fällen ist die Version „unbekannt" (`null`) — die Verbindung wird deshalb nie abgewiesen.
 * Der Wert wird nicht auf das Format `YY.MM.INDEX` geprüft: Die Auswertung (`parsePanaryVersion`)
 * entscheidet beim Lesen, was sie damit anfangen kann. Hier zählt nur, dass nichts Langes oder
 * Nicht-Textuelles in Connection, Log und Antwort landet.
 */
export function readClientVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_CLIENT_VERSION_LENGTH) return null
  return value
}
