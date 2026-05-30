/**
 * Fordert persistenten Storage an, damit der Cache nicht unter Storage-Druck
 * evictet wird. Gibt `false` zurück, wenn die Storage-API fehlt (z.B. Node/Test
 * oder ältere WebViews) — der Cache funktioniert dann weiter, nur ohne
 * Eviction-Schutz.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false
  }
  if (await navigator.storage.persisted()) {
    return true
  }
  return navigator.storage.persist()
}
