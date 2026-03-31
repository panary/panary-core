/**
 * Erzeugt einen deterministischen Hash aus einem Objekt.
 * Wird für Dirty-Checking in Formularen verwendet:
 * Original-Hash beim Laden speichern, bei Änderungen vergleichen.
 */
export function objectHash(obj: unknown): string {
  const keys = obj !== null && typeof obj === 'object' ? Object.keys(obj as Record<string, unknown>).sort() : []
  const str = JSON.stringify(obj, keys)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
