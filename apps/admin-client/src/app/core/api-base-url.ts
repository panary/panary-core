// Fallback fuer den Angular-Dev-Server (Port 4202): dort laeuft das Panel unter
// `baseHref: '/'` und das Edge-Backend liegt auf einem anderen Port.
export const DEV_SERVER_API_URL = 'http://localhost:3030'

/**
 * Basis-URL des Edge-Backends — einzige Quelle fuer REST und Socket.
 *
 * Im Production-Build liefert das Edge-Backend das Panel selbst unter `/admin/`
 * aus (`baseHref`, siehe `apps/api-edge/src/app.ts`) — Panel und API teilen sich
 * also immer denselben Origin, egal ob `localhost`, LAN-IP oder Hostname.
 *
 * Ohne diese Ableitung stand hier fix `http://localhost:3030`: beim Aufruf ueber
 * die LAN-IP (z.B. `http://10.10.100.3:3030/admin`) zeigte der WebSocket damit auf
 * den *Client*-Rechner statt auf den Server → Dauerfehler "Keine Verbindung zum
 * Server". Der `/assets/config.json`-Laufzeit-Override (`AppConfigService`) greift
 * hier nicht: er wird beim Bootstrap nie aufgerufen und laege wegen des `baseHref`
 * ohnehin unter einem anderen Pfad.
 *
 * Umgekehrt nutzten die REST-Services frueher fix `window.location.origin`: im
 * Dev-Server ging die Anmeldung damit an `localhost:4202/authentication` und
 * scheiterte mit 404, ohne den Edge je zu erreichen (panary/panary-core#460).
 */
export function resolveApiUrl(baseUri: string = document.baseURI, origin: string = window.location.origin): string {
  // `baseURI` spiegelt das gebaute `<base href>` — `/admin/` nur im Production-Build,
  // die Routen selbst tragen kein `/admin`-Praefix.
  return baseUri.includes('/admin/') ? origin : DEV_SERVER_API_URL
}

export const API_BASE_URL = resolveApiUrl()
