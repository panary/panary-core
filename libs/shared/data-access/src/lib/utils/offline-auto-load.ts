/** Zustand, aus dem ein Stammdaten-Service entscheidet, ob er (neu) lädt. */
export interface AutoLoadState {
  isAuthenticated: boolean
  isLoaded: boolean
  /** Der letzte Load lief ohne authentifizierte Verbindung, kam also aus dem Offline-Cache. */
  loadedFromCache: boolean
  /** Offline-Cache bereit (nur im POS; sonst immer `false`). */
  cacheReady: boolean
}

/**
 * Soll ein Stammdaten-Service mit Offline-Cache jetzt laden? (core#649)
 *
 * - Online: wenn noch nichts geladen ist **oder** der Stand aus dem Cache stammt — nach dem
 *   Reconnect ersetzt der Server-Stand den Cache-Stand.
 * - Offline: nur mit bereitem Cache und nur einmal. Ohne diesen Zweig blieb die Liste nach
 *   einem Offline-Start leer, weil der Load bisher allein an `isAuthenticated()` hing.
 *
 * Ohne Cache (Cloud-/Admin-Frontends) ist `cacheReady` immer `false`, das Verhalten also
 * unverändert: Laden erst mit Verbindung.
 */
export function shouldAutoLoad(state: AutoLoadState): boolean {
  if (state.isAuthenticated) return !state.isLoaded || state.loadedFromCache
  return state.cacheReady && !state.isLoaded
}
