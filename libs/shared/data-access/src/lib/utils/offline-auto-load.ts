/** Zustand, aus dem ein Stammdaten-Service entscheidet, ob er (neu) lädt. */
export interface AutoLoadState {
  isAuthenticated: boolean
  /** Reads kommen gerade aus dem Offline-Cache (`BaseService.readsFromCache()`; ohne Cache immer `false`). */
  readsFromCache: boolean
  isLoaded: boolean
  /** Der letzte Load kam aus dem Offline-Cache. */
  loadedFromCache: boolean
}

/**
 * Soll ein Stammdaten-Service mit Offline-Cache jetzt laden? (core#649)
 *
 * - Offline mit bereitem Cache: einmal laden. Ohne diesen Zweig blieb die Liste nach einem
 *   Offline-Start leer, weil der Load allein an `isAuthenticated()` hing.
 * - Online: wenn noch nichts geladen ist **oder** der Stand aus dem Cache stammt — nach dem
 *   Reconnect ersetzt der Server-Stand den Cache-Stand.
 * - Dazwischen (Socket verbunden, Gerät noch nicht authentifiziert): warten. Ein Read ginge
 *   an den Server und scheiterte.
 *
 * Ohne Cache (Cloud-/Admin-Frontends) ist `readsFromCache` immer `false`, das Verhalten also
 * unverändert: Laden erst mit Verbindung.
 */
export function shouldAutoLoad(state: AutoLoadState): boolean {
  if (state.readsFromCache) return !state.isLoaded
  if (state.isAuthenticated) return !state.isLoaded || state.loadedFromCache
  return false
}
