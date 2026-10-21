/**
 * Begründung, warum Stempeln und Pausen am Dashboard gesperrt sind — als Übersetzungsschlüssel.
 * Die Kontosperre geht vor „offline": Sie bleibt auch bestehen, wenn die Verbindung zurückkommt,
 * und ist deshalb die Auskunft, mit der der Nutzer etwas anfangen kann (core#797, Muster der
 * Schnellaktionen aus core#489).
 */
export function timeTrackingBlockedHintKey(suspended: boolean, offline: boolean): string | null {
  if (suspended) return 'CLOUD_STATUS.TENANT_SUSPENDED'
  if (offline) return 'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED'
  return null
}
