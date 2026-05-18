/**
 * Exponential-Backoff-Schedule fuer Edge→Cloud-Sync-Push bei transient
 * Cloud-Errors (Netzwerk, 5xx, Cloud-Restart-Fenster).
 *
 * Pure function — extrahiert aus `cloud-sync-scheduler.worker.ts` damit
 * Vitest die Logik hermetisch im sync-domain-Workspace testen kann (api-edge
 * hat kein eigenes Vitest-Setup, siehe ADR sync-hardening-adr.md).
 */

/**
 * Wartezeiten zwischen den Push-Versuchen. Index = `attempts - 1`
 * (also Versuch 1 → 30s, Versuch 2 → 1min, etc.).
 *
 * Begruendung der Werte:
 * - 30s: kurz genug, um einen Cloud-Restart zu ueberbruecken
 * - 1min / 5min / 30min: typische Stufen fuer Outage-Recovery
 * - 2h / 6h: Schutz vor Pile-Up bei laengeren Cloud-Ausfaellen — Operator
 *   bekommt Zeit zur Reaktion (Notification, Support-Ticket etc.)
 * - 6h-Cap × MAX_ATTEMPTS=10 = max 1 Eskalation/Tag pro Eintrag
 */
export const RETRY_BACKOFF_SCHEDULE_MS = [
  30_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3600_000,
  6 * 3600_000,
] as const

/**
 * Maximale Retry-Versuche bei transient errors. Bei Erreichen wird der
 * Outbox-Eintrag final als `rejected` markiert und ein `sync-conflicts`-
 * Eintrag mit `reason: PUSH_REJECTED` erzeugt → Operator-Resolution.
 */
export const MAX_RETRY_ATTEMPTS = 10

/**
 * Berechnet die Wartezeit bis zum naechsten Push-Versuch in Millisekunden.
 * Wird vom Edge-Worker auf `nextAttemptAt = now + backoffMs(attempts)`
 * angewandt.
 *
 * @param attempts Anzahl der bisherigen Versuche (>= 1). Werte < 1 werden
 *                 als 1 interpretiert (defensiver Fallback).
 * @returns Wartezeit in Millisekunden, mindestens 30s, maximal 6h.
 */
export const backoffMs = (attempts: number): number => {
  if (attempts < 1) return RETRY_BACKOFF_SCHEDULE_MS[0]
  const i = Math.min(attempts - 1, RETRY_BACKOFF_SCHEDULE_MS.length - 1)
  return RETRY_BACKOFF_SCHEDULE_MS[i]
}

/**
 * Liefert `true`, wenn der naechste Versuch die MAX_RETRY_ATTEMPTS-Grenze
 * erreichen wuerde — der Worker eskaliert dann zu `sync-conflicts` statt
 * weiteren Retry zu planen.
 */
export const shouldEscalateAfterRetry = (currentAttempts: number): boolean =>
  currentAttempts + 1 >= MAX_RETRY_ATTEMPTS
