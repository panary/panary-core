import { describe, expect, it } from 'vitest'

import { extractCloudErrorMessage } from './cloud-connection'

// Die Fehlermeldung landet 1:1 im Admin-UI der Kopplungs-Seite. Ein durchgereichter
// Roh-Body macht aus einem Konfigurationsfehler (falscher Port) einen scheinbaren
// Systemausfall — genau das ist am 2026-07-31 passiert.
describe('extractCloudErrorMessage', () => {
  it('nimmt die message aus einer FeathersError-JSON-Antwort', () => {
    const body = JSON.stringify({ name: 'BadRequest', message: 'Pairing-Code abgelaufen', code: 400 })
    expect(extractCloudErrorMessage(400, body)).toBe('Pairing-Code abgelaufen')
  })

  it('erklaert eine HTML-Antwort als falsche Cloud-URL, statt das Markup durchzureichen', () => {
    const body = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot POST /edge-pairing</pre>\n</body>\n</html>'

    const message = extractCloudErrorMessage(404, body)

    expect(message).toContain('keine Panary-Cloud-API')
    expect(message).toContain('localhost:3031')
    expect(message).not.toContain('<!DOCTYPE')
    expect(message).not.toContain('<pre>')
  })

  it('erkennt HTML auch ohne DOCTYPE-Praeambel', () => {
    expect(extractCloudErrorMessage(404, '<html><body>Not Found</body></html>')).toContain('keine Panary-Cloud-API')
  })

  it('deckelt unbekannte Roh-Bodies', () => {
    const body = 'x'.repeat(2000)
    const message = extractCloudErrorMessage(500, body)

    expect(message.length).toBeLessThan(600)
    expect(message.endsWith('…')).toBe(true)
  })

  it('laesst kurze Klartext-Fehler unveraendert', () => {
    expect(extractCloudErrorMessage(502, 'upstream timeout')).toBe('upstream timeout')
  })

  it('faellt auf den Status zurueck, wenn der Body leer ist', () => {
    expect(extractCloudErrorMessage(503, '   ')).toBe('Cloud-Antwort 503 ohne Fehlerdetails.')
  })

  it('faellt auf den Roh-Body zurueck, wenn JSON ungueltig ist', () => {
    expect(extractCloudErrorMessage(400, '{ kaputt')).toBe('{ kaputt')
  })
})
