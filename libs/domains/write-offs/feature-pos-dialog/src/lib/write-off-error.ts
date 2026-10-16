/** Fehlerform des Feathers-Clients: HTTP-Code plus Server-Meldung. */
interface FeathersClientError {
  code?: number
  message?: string
}

/**
 * Übersetzt einen Speicherfehler des POS-Dialogs in eine Meldung mit Ursache (panary/panary-core#635).
 * Bis dahin hieß jeder Fehler „Fehler beim Speichern“, auch der fehlende Edge-Service, und
 * Abschreibungen gingen unbemerkt verloren.
 */
export const writeOffErrorMessage = (err: unknown, translate: (key: string) => string): string => {
  const error = (err ?? {}) as FeathersClientError
  const detail = error.message?.trim()

  switch (error.code) {
    case 403:
      return translate('WRITE_OFF.ERROR_FORBIDDEN')
    case 400:
      return detail ? `${translate('WRITE_OFF.ERROR_INVALID')} (${detail})` : translate('WRITE_OFF.ERROR_INVALID')
    case 404:
      return translate('WRITE_OFF.ERROR_UNAVAILABLE')
    default:
      return detail || translate('COMMON.SAVE_ERROR')
  }
}
