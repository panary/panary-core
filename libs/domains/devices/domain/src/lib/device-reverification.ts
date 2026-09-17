// Re-Verifikation nach langer Offline-Phase (panary/panary-core#325) — Single
// Source of Truth fuer die Frage „hat dieses Geraet so lange geschwiegen, dass
// es einmal bestaetigt werden muss?".
//
// Bewusst getrennt vom Schluessel-Ablauf (ADR 0042): Der Ablauf ist unsichtbar
// und weist NIE ab, solange die Karenz laeuft — ein abgelehnter Handshake macht
// das Terminal unbedienbar und unreparierbar. Die Re-Verifikation laesst den
// Handshake dagegen zu und haengt nur eine einmalige Bestaetigung davor.
//
// Framework-agnostisch (kein Feathers, kein Angular): dieselben Regeln laufen im
// Edge-Handshake, im Durchsetzungs-Hook und in den Tests. Muster wie
// `device-access-mode.ts` und `auto-log-off-timeout.ts`.

/** Schwelle, wenn der Standort nichts Brauchbares konfiguriert hat. */
export const DEVICE_REVERIFY_DEFAULT_DAYS = 7

/**
 * Untergrenze der Schwelle — kein Geschmack, sondern Betriebsschutz.
 *
 * Ein POS-Geraet hat KEIN Keepalive (anders als der Edge mit 4 h,
 * `cloud-sync-scheduler.worker.ts`): ein ausgeschaltetes Terminal funkt gar
 * nicht. Realistische Pausen im Alltag sind Nacht (~16 h), Wochenende (~60 h)
 * und Ruhetag plus Wochenende (~84 h = 3,5 Tage). Eine Schwelle darunter
 * traefe den Normalbetrieb, und eine Abfrage, die jeden Montag kommt, wird
 * weggetippt wie jede andere Gewohnheit — dann ist sie wertlos, wenn sie
 * einmal zaehlt.
 */
export const DEVICE_REVERIFY_MIN_DAYS = 4

/**
 * Obergrenze — jenseits davon traegt der Schluessel-Ablauf (ADR 0042) die
 * Hygiene. Eine Schwelle von „nie" gibt es bewusst nicht: Sie waere ein stiller
 * Aus-Schalter, den niemand im Betrieb als solchen erkennt.
 */
export const DEVICE_REVERIFY_MAX_DAYS = 90

/**
 * Stabiler Fehlercode, den der Server waehrend der ausstehenden Bestaetigung
 * auf Schreibzugriffen zurueckgibt, und Merkmal im Handshake-Ergebnis.
 *
 * 🚨 Der HTTP-Code dazu muss von `classifyOutboxError`
 * (`libs/shared/offline-cache/src/lib/outbox.ts`) als `transient` eingestuft
 * werden — 400/401/403/422 gelten dort als `terminal` und LOESCHEN den
 * Outbox-Eintrag. Eine offline erfasste Bestellung waere damit weg, nur weil
 * das Terminal eine Bestaetigung schuldet. Deshalb 503 (`Unavailable`).
 */
export const DEVICE_REVERIFICATION_ERROR_CODE = 'DEVICE_REVERIFICATION_REQUIRED'

/** Minimaler Ausschnitt der Standort-Einstellungen fuer die Schwelle. */
export interface DeviceSecuritySettingsState {
  offlineReverifyDays?: unknown
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Standort-Einstellung → Millisekunden.
 *
 * Geklammert statt abgelehnt: Das Schema laesst `offlineReverifyDays` bewusst
 * als freies `Type.Number()` stehen (Begruendung dort). Ein unbrauchbarer oder
 * zu kleiner Wert faellt hier auf Default bzw. Untergrenze zurueck — dieselbe
 * Linie wie `resolveAutoLogOffTimeoutMs`. Eine verschaerfte Inline-Constraint
 * im geteilten Schema wuerde stattdessen den Cloud→Edge-Sync des ganzen
 * Standorts terminal ablehnen.
 */
export const resolveDeviceReverifyThresholdMs = (settings?: DeviceSecuritySettingsState | null): number => {
  const raw = Number(settings?.offlineReverifyDays)
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEVICE_REVERIFY_DEFAULT_DAYS

  return Math.min(Math.max(days, DEVICE_REVERIFY_MIN_DAYS), DEVICE_REVERIFY_MAX_DAYS) * DAY_MS
}

/**
 * Wie lange hat das Geraet geschwiegen? `null`, wenn es dazu keine Aussage
 * gibt.
 *
 * `lastUsedAt` in der Zukunft (Uhr-Drift zwischen Edge und Geraet, oder eine
 * Zeitumstellung) ergibt 0 statt eines negativen Werts — sonst waere jede
 * Drift eine stille Verlaengerung der Frist.
 */
export const resolveDeviceOfflineForMs = (lastUsedAt: unknown, now: number): number | null => {
  if (typeof lastUsedAt !== 'string' || !lastUsedAt) return null
  const stamped = Date.parse(lastUsedAt)
  if (!Number.isFinite(stamped)) return null
  return Math.max(0, now - stamped)
}

/**
 * Ist eine Bestaetigung faellig?
 *
 * Fail-OPEN bei fehlendem oder unlesbarem `lastUsedAt` — und das ist Absicht:
 * Ein Bestands-Schluessel ohne Stempel hat nie behauptet, lange weg gewesen zu
 * sein. Ihn auf Verdacht zu sperren wuerde beim Deploy die halbe Flotte
 * gleichzeitig vor den Bestaetigungsbildschirm schicken, ohne dass irgendetwas
 * vorgefallen waere. Derselbe Handshake stempelt `lastUsedAt`; ab dann misst
 * die Regel echte Daten.
 */
export const isDeviceReverificationDue = (lastUsedAt: unknown, now: number, thresholdMs: number): boolean => {
  const offlineForMs = resolveDeviceOfflineForMs(lastUsedAt, now)
  if (offlineForMs === null) return false
  return offlineForMs > thresholdMs
}
