/**
 * Fehlerbeschreibungen für `console.*` im POS-Frontend (`.claude/rules/pos-logging.md` §3).
 *
 * Der Mitschnitt schreibt jedes Nicht-`Error`-Objekt per `JSON.stringify` vollständig in
 * `panary-pos.log`, und die Datei geht per „Logs exportieren" an den Support. Ein roher
 * Socket-Fehler (Plain Object) trüge so sein `data` mit, ein `HttpErrorResponse` Body, URL und
 * Header. Die Helfer geben deshalb eine Zeichenkette aus Name, Code und Meldung zurück, nie `data`.
 */

/** Name des Fehlers, ohne Meldung. Für Fehler, deren Meldung die Eingabe zitieren kann. */
export function errorName(error: unknown): string {
  if (error instanceof Error) return error.name
  const name = (error as { name?: unknown } | null)?.name
  return typeof name === 'string' && name ? name : typeof error
}

/**
 * Name, Code und Meldung als eine Zeile: `NotAuthenticated (401): jwt expired`.
 *
 * Ein `HttpErrorResponse` (Angular, kein `Error`) nennt nur Name und Status: Seine `message`
 * enthält die URL samt Query.
 */
export function describeErrorForLog(error: unknown): string {
  if (error === null || typeof error !== 'object') return errorName(error)

  const name = errorName(error)
  const record = error as { status?: unknown; code?: unknown; message?: unknown }

  if (name === 'HttpErrorResponse') {
    return typeof record.status === 'number' ? `${name} (${record.status})` : name
  }

  const code = typeof record.code === 'number' || typeof record.code === 'string' ? ` (${record.code})` : ''
  const message = typeof record.message === 'string' && record.message ? `: ${record.message}` : ''
  return `${name}${code}${message}`
}
