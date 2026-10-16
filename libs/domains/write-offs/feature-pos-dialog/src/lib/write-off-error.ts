/** Fehlerform des Feathers-Clients: HTTP-Code plus Server-Meldung. */
interface FeathersClientError {
  code?: number
  message?: string
}

/**
 * Übersetzt einen Speicherfehler des POS-Dialogs in eine Meldung mit Ursache (panary/panary-core#635).
 * Bis dahin hieß jeder Fehler „Fehler beim Speichern“, auch der fehlende Edge-Service, und
 * Abschreibungen gingen unbemerkt verloren.
 *
 * `null` heißt: Der Dialog meldet nichts selbst, weil `ServiceHelper.handleError` den Fall schon
 * anzeigt (Mandantensperre als Banner) oder bewusst unterdrückt (Kontext-403 ohne Impersonation).
 */
export const writeOffErrorMessage = (err: unknown, translate: (key: string) => string): string | null => {
  const error = (err ?? {}) as FeathersClientError
  const detail = error.message?.trim()

  switch (error.code) {
    case 403:
      if (detail?.startsWith('TENANT_SUSPENDED') || detail?.includes('Tenant-Kontext')) return null
      return translate('WRITE_OFF.ERROR_FORBIDDEN')
    case 400:
      return detail ? `${translate('WRITE_OFF.ERROR_INVALID')} (${detail})` : translate('WRITE_OFF.ERROR_INVALID')
    case 404: {
      // Nur der fehlende Service (Feathers: „Service '<pfad>' not found“), kein beliebiges 404.
      const lower = detail?.toLowerCase() ?? ''
      if (lower.startsWith("service '") && lower.includes("' not found"))
        return translate('WRITE_OFF.ERROR_UNAVAILABLE')
      return detail || translate('COMMON.SAVE_ERROR')
    }
    default:
      return detail || translate('COMMON.SAVE_ERROR')
  }
}
