/**
 * Serialisiert den ganzen Wert, auf jeder Ebene, mit sortierten Objektschlüsseln — die Reihenfolge der Schlüssel
 * ändert das Ergebnis nicht, die Reihenfolge von Listeneinträgen schon.
 * (Kein Array als Replacer: Der wäre eine Whitelist für Eigenschaftsnamen auf JEDER Ebene und ließe verschachtelte
 * Felder aus dem Hash fallen, core#1477.)
 */
function canonicalJson(obj: unknown): string {
  return (
    JSON.stringify(obj, (_key, value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
      const record = value as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map(key => [key, record[key]]),
      )
    }) ?? 'undefined'
  )
}

/**
 * Erzeugt einen deterministischen Hash aus einem Objekt.
 * Wird für Dirty-Checking in Formularen verwendet:
 * Original-Hash beim Laden speichern, bei Änderungen vergleichen.
 */
export function objectHash(obj: unknown): string {
  const str = canonicalJson(obj)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
