import { Utils } from '@panary/shared/util-helpers'

export interface EdgeBaseUrlSources {
  /** `serverUrl` aus der gepairten Device-Config im localStorage (POS-Betrieb). */
  deviceServerUrl?: string | null
  /** `AppConfigService.apiUrl` — Admin-/Browser-Betrieb ohne Pairing. */
  configuredApiUrl?: string | null
}

/**
 * Ermittelt die Basis-URL (`protocol//host`) des Edge-Servers für HTTP-Aufrufe
 * auf Endpunkte ausserhalb der Feathers-Services (heute `/print-server/*`).
 *
 * Hier stand frueher schlicht `window.location.origin`. Das trifft nur im
 * Admin-Client zu, den der Edge selbst ausliefert (`api-edge` serviert
 * `dist/apps/admin-client/browser`). Der POS laeuft unter eigener Herkunft —
 * bei Tauri `http://tauri.localhost` — und schickte den Druckauftrag damit an
 * sich selbst: der Bon-Endpunkt sah nie eine Anfrage, waehrend der Testdruck
 * aus dem Edge-Admin funktionierte.
 *
 * Quellen und Reihenfolge sind bewusst dieselben wie in
 * `ConnectionService.createSocket` (Device-Config vor App-Config, beides ueber
 * `Utils.getBaseUrl` normalisiert), damit Druck und Socket nicht auf
 * verschiedene Hosts zeigen koennen.
 *
 * @throws wenn keine der Quellen eine brauchbare URL liefert — an einen
 * falschen Host zu senden waere genau der stille Fehlschlag, den diese
 * Aufloesung beseitigt.
 */
export function resolveEdgeBaseUrl(sources: EdgeBaseUrlSources): string {
  const raw = sources.deviceServerUrl?.trim() || sources.configuredApiUrl?.trim()
  if (!raw) throw new Error('Kein Edge-Server konfiguriert — Druckauftrag hat kein Ziel.')

  return Utils.getBaseUrl(raw)
}
