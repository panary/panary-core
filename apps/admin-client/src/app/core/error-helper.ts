type ApiValidationDetail = {
  instancePath?: string
  message?: string
  params?: { missingProperty?: string }
}

type ApiErrorShape = {
  error?: unknown
  message?: string
  data?: ApiValidationDetail[]
}

/** Feathers-Validierungsfehler benutzerfreundlich aufbereiten */
export function formatApiError(error: unknown): string {
  const body = ((error as ApiErrorShape)?.error ?? error) as ApiErrorShape

  // Feathers-Validierungsfehler mit Details
  if (body?.data && Array.isArray(body.data)) {
    const messages = body.data.map(d => {
      const field = d.instancePath?.replace(/^\//, '') || d.params?.missingProperty || 'Unbekanntes Feld'
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
