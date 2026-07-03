/**
 * Baut einen idempotenten On-Demand-Load für Services mit deaktiviertem Auto-Load
 * (s. `DATA_ACCESS_AUTO_LOAD`): geladen wird nur, solange `isLoaded` false liefert,
 * und parallele Aufrufe werden auf EINEN laufenden `load` dedupliziert — kein
 * Doppel-Fetch, wenn mehrere Konsumenten gleichzeitig `ensureLoaded()` rufen.
 */
export function createEnsureLoaded(isLoaded: () => boolean, load: () => void | Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null

  return async (): Promise<void> => {
    if (isLoaded()) return

    inFlight ??= Promise.resolve(load()).finally((): void => {
      inFlight = null
    })

    await inFlight
  }
}
