// Entscheidungslogik fuer den Notfall-Modus (ADR `docs/adr/0001-emergency-override.md`).
//
// Bewusst als pure Funktionen ohne App-/DB-Zugriff, damit die Modi-Matrix
// testbar bleibt (gleiches Muster wie `evaluateOutboxGuard` in business-days).
//
// **Warum es zwei Zusatzfelder braucht:** Ein einzelnes Boolean ueberlebt die
// Automatik nicht. Der Scheduler-Worker schaltet den Modus selbsttaetig ein und
// aus — eine manuelle Bedienung wuerde ohne Gegenmassnahme sofort wieder
// ueberschrieben:
//
//  - `emergencyOverrideSource`: Der Reconcile-Fast-Path deaktiviert den Modus,
//    sobald null Overrides offen sind — **ohne Cloud-Call**. Eine manuelle
//    Aktivierung waere nach einem Sync-Tick wieder weg.
//  - `emergencyOverrideSuppressedUntil`: `consecutiveHeartbeatFailures` wird nur
//    bei einem ERFOLGREICHEN Heartbeat auf 0 gesetzt. Nach einer manuellen
//    Deaktivierung waehrend des Ausfalls steht der Zaehler weiterhin ueber der
//    Schwelle — der naechste Fehlversuch wuerde binnen Sekunden re-aktivieren.

export type EmergencyOverrideSource = 'AUTO' | 'MANUAL'

/**
 * Trigger-Schwellen: entweder drei konsekutive Heartbeat-Fehler (≈1,5 min bei
 * 30-s-Tick, reagiert schnell auf akute Ausfaelle) ODER fuenf Minuten ohne
 * erfolgreichen Heartbeat (faengt Faelle, in denen das Scheduling pausiert war
 * und der Fehlerzaehler gar nicht hochlaeuft).
 */
export const EMERGENCY_OVERRIDE_FAILURE_THRESHOLD = 3
export const EMERGENCY_OVERRIDE_AFTER_MS = 5 * 60 * 1000

/**
 * Lebensdauer einer MANUELLEN Aktivierung. Ohne Timebox bliebe die
 * Drucker-Whitelist nach der Rueckkehr der Cloud dauerhaft offen und der Edge
 * wuerde still divergieren.
 */
export const MANUAL_EMERGENCY_OVERRIDE_TTL_MS = 2 * 60 * 60 * 1000

/**
 * Sperrfrist der AUTOMATIK nach einer manuellen Deaktivierung.
 *
 * Bewusst eine eigene Konstante, obwohl der Wert derzeit gleich ist: die beiden
 * beantworten unterschiedliche Fragen („wie lange gilt mein Einschalten" vs.
 * „wie lange halte ich den Watchdog still"). Eine gemeinsame Konstante haette
 * beim Justieren der einen still die andere mitverschoben.
 */
export const AUTO_ACTIVATION_SUPPRESSION_MS = 2 * 60 * 60 * 1000

/** Nur die Felder, die die Entscheidung braucht — bewusst kein CloudConnection. */
export interface EmergencyOverrideState {
  emergencyOverride?: boolean
  emergencyOverrideSince?: string | null
  emergencyOverrideSource?: string | null
  emergencyOverrideSuppressedUntil?: string | null
}

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** Manuelle Aktivierung noch innerhalb ihrer TTL? */
export const isManualOverrideStillValid = (state: EmergencyOverrideState, nowMs: number): boolean => {
  if (state.emergencyOverrideSource !== 'MANUAL') return false
  const sinceMs = parseMs(state.emergencyOverrideSince)
  // Ohne verwertbares Datum lieber als abgelaufen behandeln: ein Modus, der
  // sich nie wieder selbst schliesst, ist das schlechtere Versagen.
  if (sinceMs === null) return false
  return nowMs - sinceMs < MANUAL_EMERGENCY_OVERRIDE_TTL_MS
}

/** Automatik nach manueller Deaktivierung voruebergehend stillgelegt? */
export const isOverrideSuppressed = (state: EmergencyOverrideState, nowMs: number): boolean => {
  const untilMs = parseMs(state.emergencyOverrideSuppressedUntil)
  return untilMs !== null && untilMs > nowMs
}

/**
 * Soll der Worker den Notfall-Modus automatisch aktivieren?
 *
 * @param failureCount Zaehlerstand NACH dem aktuellen Fehlversuch.
 * @param elapsedMsSinceLastOk Zeit seit dem letzten erfolgreichen Heartbeat.
 */
export const shouldActivateEmergencyOverride = (
  state: EmergencyOverrideState,
  input: { failureCount: number; elapsedMsSinceLastOk: number },
  nowMs: number,
): boolean => {
  if (state.emergencyOverride) return false
  if (isOverrideSuppressed(state, nowMs)) return false
  return (
    input.failureCount >= EMERGENCY_OVERRIDE_FAILURE_THRESHOLD ||
    input.elapsedMsSinceLastOk >= EMERGENCY_OVERRIDE_AFTER_MS
  )
}

/**
 * Soll der Reconcile-Pfad den Notfall-Modus automatisch beenden?
 *
 * Nur wenn nichts mehr offen ist UND es keine noch gueltige manuelle
 * Aktivierung gibt — sonst raeumt der Fast-Path eine bewusste Operator-
 * Entscheidung weg, ohne dass jemand es merkt.
 */
export const shouldAutoDeactivateEmergencyOverride = (
  state: EmergencyOverrideState,
  input: { pendingCount: number; conflictCount: number },
  nowMs: number,
): boolean => {
  if (input.pendingCount > 0 || input.conflictCount > 0) return false
  return !isManualOverrideStillValid(state, nowMs)
}
