/**
 * Auswertung von Rueckstau-Signalen der Cloud (HTTP 429) im Edge→Cloud-Sync.
 *
 * Pure functions ohne App-/DB-Zugriff — gleiches Muster wie `backoff-schedule.ts`,
 * damit Vitest die Logik hermetisch im sync-domain-Workspace testen kann.
 *
 * Ein 429 ist KEIN Fehlversuch: die Cloud hat den Payload nie bewertet, sie hat
 * nur gesagt „spaeter". Die Konsequenzen dieser Unterscheidung stehen in
 * `docs/adr/0019-edge-429-rueckstau-behandlung.md`; hier lebt nur die Frage
 * „wie lange spaeter".
 */

/**
 * Untergrenze der Wartezeit.
 *
 * `koa-ratelimit` (Cloud) rechnet `Retry-After` als `(reset - now) | 0` und
 * liefert am Fensterende legitim `0`. Ohne Untergrenze wuerde der Edge sofort
 * erneut anklopfen — genau das Verhalten, gegen das das Limit existiert.
 */
export const RATE_LIMIT_MIN_DELAY_MS = 5_000

/**
 * Wartezeit, wenn die Antwort keinen (oder keinen verwertbaren) `Retry-After`
 * traegt. 60 s entspricht der Fensterlaenge der Cloud-Buckets
 * (`panary-cloud/docs/adr/0033-edge-sync-rate-limiting.md`): nach einem vollen
 * Fenster ist das Kontingent in jedem Fall zurueckgesetzt.
 */
export const RATE_LIMIT_FALLBACK_DELAY_MS = 60_000

/**
 * Obergrenze der Wartezeit.
 *
 * `Retry-After` kommt von aussen — aus einer Cloud mit abweichender
 * Fensterkonfiguration, aus einem vorgelagerten Proxy oder im Extremfall aus
 * einer feindlichen Antwort. Ein Header duerfte den Sync nie ueber Stunden
 * stilllegen; 15 Minuten sind mehr als jedes realistische Fenster und immer
 * noch kurz genug, dass ein Edge denselben Geschaeftstag wieder aufholt.
 */
export const RATE_LIMIT_MAX_DELAY_MS = 15 * 60_000

const clamp = (ms: number): number => Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.max(RATE_LIMIT_MIN_DELAY_MS, ms))

/**
 * Liest den `Retry-After`-Header in Millisekunden.
 *
 * RFC 9110 §10.2.3 erlaubt zwei Formen, beide werden unterstuetzt:
 *  - Delta-Sekunden als nicht-negative Ganzzahl (`Retry-After: 120`) — was
 *    `koa-ratelimit` in der Cloud sendet
 *  - HTTP-Datum (`Retry-After: Wed, 05 Aug 2026 12:00:00 GMT`) — was ein
 *    vorgelagerter Proxy/CDN senden kann
 *
 * Rueckgabe ist auf `[RATE_LIMIT_MIN_DELAY_MS, RATE_LIMIT_MAX_DELAY_MS]`
 * geklemmt. `null` bedeutet „kein verwertbarer Header" — der Aufrufer waehlt
 * dann seinen eigenen Fallback (`rateLimitDelayMs` bzw. `backoffMs` im
 * Push-Pfad).
 *
 * Ein Datum in der Vergangenheit ergibt bewusst die Untergrenze statt `null`:
 * die Cloud hat eine Aussage getroffen („ab jetzt wieder"), sie ist nur beim
 * Eintreffen bereits abgelaufen.
 */
export const parseRetryAfterMs = (raw: string | null | undefined, nowMs: number): number | null => {
  if (raw === null || raw === undefined) return null
  const value = raw.trim()
  if (value.length === 0) return null

  // Delta-Sekunden zuerst: der haeufige Fall und eindeutig zu erkennen.
  // Bewusst nicht `Number()` — das akzeptiert '1e3', '0x10' und Dezimalstellen,
  // die die Spec an dieser Stelle nicht vorsieht.
  if (/^\d+$/.test(value)) {
    return clamp(Number(value) * 1000)
  }

  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return null
  return clamp(dateMs - nowMs)
}

/**
 * Wartezeit bis zum naechsten Versuch nach einem 429 — mit Fallback, wenn die
 * Antwort keinen verwertbaren `Retry-After` traegt.
 *
 * Der Fallback wird ebenfalls geklemmt, damit ein Aufrufer mit eigenem
 * Backoff-Wert (z. B. `backoffMs(attempts)` im Push-Pfad, bis zu 6 h) nicht an
 * der Obergrenze vorbeikommt.
 */
export const rateLimitDelayMs = (
  raw: string | null | undefined,
  nowMs: number,
  fallbackMs: number = RATE_LIMIT_FALLBACK_DELAY_MS,
): number => parseRetryAfterMs(raw, nowMs) ?? clamp(fallbackMs)
