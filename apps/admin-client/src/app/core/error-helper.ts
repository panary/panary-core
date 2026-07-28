type ApiValidationDetail = {
  instancePath?: string
  message?: string
  keyword?: string
  params?: { missingProperty?: string; additionalProperty?: string }
}

type ApiErrorShape = {
  error?: unknown
  message?: string
  data?: ApiValidationDetail[] | { code?: string }
  code?: string
}

/**
 * Liest den maschinenlesbaren Fehlercode eines Feathers-Fehlers.
 *
 * `new Forbidden(msg, { code: 'CLOUD_MANAGED' })` legt das Objekt in
 * `error.data` ab — dort, wo bei Validierungsfehlern ein Array steht. Der
 * Aufrufer soll auf den Code reagieren koennen (z.B. den Cloud-Zustand neu
 * laden), nicht auf den uebersetzten Meldungstext.
 */
export function getApiErrorCode(error: unknown): string | null {
  const body = ((error as ApiErrorShape)?.error ?? error) as ApiErrorShape
  if (body?.data && !Array.isArray(body.data) && typeof body.data.code === 'string') {
    return body.data.code
  }
  return typeof body?.code === 'string' ? body.code : null
}

/** Feathers-Validierungsfehler benutzerfreundlich aufbereiten */
export function formatApiError(error: unknown): string {
  const body = ((error as ApiErrorShape)?.error ?? error) as ApiErrorShape

  // Feathers-Validierungsfehler mit Details. additionalProperties-Fehler
  // listen das beanstandete Feld in params.additionalProperty, nicht in
  // instancePath — sonst zeigt der Fehler nur ein nichtssagendes
  // „Unbekanntes Feld" ohne zu sagen welches.
  if (body?.data && Array.isArray(body.data)) {
    const messages = body.data.map(d => {
      const field =
        d.params?.additionalProperty ||
        d.instancePath?.replace(/^\//, '') ||
        d.params?.missingProperty ||
        'Unbekanntes Feld'
      const msg = d.message || 'Ungültig'
      return `${formatFieldName(field)}: ${msg}`
    })
    if (messages.length > 0) return messages.join('\n')
  }

  // UNIQUE-Constraint-Fehler benutzerfreundlich
  if (body?.message?.includes('UNIQUE constraint failed')) {
    const match = body.message.match(/UNIQUE constraint failed: \w+\.(\w+)/)
    if (match) {
      const field = formatFieldName(match[1])
      return `${field} ist bereits vergeben. Bitte einen anderen Wert verwenden.`
    }
    return 'Ein Eintrag mit diesen Daten existiert bereits.'
  }

  // Feathers-Fehler mit Message
  if (body?.message && body.message !== 'validation failed') {
    return body.message
  }

  // Fallback
  return 'Ein unerwarteter Fehler ist aufgetreten.'
}

const FIELD_LABELS: Record<string, string> = {
  loginname: 'Login-Name',
  firstName: 'Vorname',
  lastName: 'Nachname',
  email: 'E-Mail',
  password: 'Passwort',
  role: 'Rolle',
  tenantId: 'Mandant',
  locationId: 'Standort',
  name: 'Name',
  acronym: 'Kürzel',
  price: 'Preis',
  status: 'Status',
}

function formatFieldName(field: string): string {
  return FIELD_LABELS[field] || field
}
