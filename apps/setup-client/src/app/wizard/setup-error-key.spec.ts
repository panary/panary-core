import { describe, expect, it } from 'vitest'

import { setupErrorKey } from './wizard'

/**
 * Baut eine Absage so nach, wie Angulars HttpClient sie durchreicht: Status auf
 * der obersten Ebene, der Body des Servers unter `error`.
 */
function httpError(status: number, reason?: string) {
  return { status, error: reason ? { error: reason } : undefined }
}

describe('setupErrorKey', () => {
  // Der Setup-Endpunkt ist seit #323 tokenpflichtig — diese Absagen sind der
  // Normalfall, nicht die Ausnahme, und muessen als Klartext ankommen.
  it.each([
    [httpError(401, 'invalid_token'), 'WIZARD.ERRORS.TOKEN_INVALID'],
    [httpError(401, 'missing_token'), 'WIZARD.ERRORS.TOKEN_INVALID'],
    [httpError(401, 'expired'), 'WIZARD.ERRORS.TOKEN_EXPIRED'],
    [httpError(409, 'already_used'), 'WIZARD.ERRORS.TOKEN_USED'],
    [httpError(429, 'rate_limited'), 'WIZARD.ERRORS.RATE_LIMITED'],
  ])('bildet %o auf %s ab', (err, erwartet) => {
    expect(setupErrorKey(err)).toBe(erwartet)
  })

  // Ein aelterer Edge ohne die Grund-Angabe im Body: Der Status allein muss
  // noch zu einer brauchbaren Meldung fuehren.
  it('faellt bei 401 ohne Grund auf die Token-Meldung zurueck', () => {
    expect(setupErrorKey(httpError(401))).toBe('WIZARD.ERRORS.TOKEN_INVALID')
  })

  it('faellt bei 429 ohne Grund auf die Rate-Limit-Meldung zurueck', () => {
    expect(setupErrorKey(httpError(429))).toBe('WIZARD.ERRORS.RATE_LIMITED')
  })

  it.each([
    { fall: 'Serverfehler', err: httpError(500) as unknown },
    { fall: 'Validierungsfehler', err: httpError(400, 'Invalid configuration data') as unknown },
    { fall: 'gar kein Fehlerobjekt', err: undefined as unknown },
    { fall: 'blanker Error ohne Status', err: new Error('Netzwerk weg') as unknown },
  ])('meldet fuer $fall die allgemeine Fehlermeldung', ({ err }) => {
    expect(setupErrorKey(err)).toBe('WIZARD.ERRORS.GENERIC')
  })

  // Der Status gewinnt nicht gegen einen ausdruecklichen Grund: Ein 401 mit
  // `expired` ist etwas anderes als ein 401 mit falschem Token, und der
  // Unterschied entscheidet, ob der Betreiber neu abtippt oder neu startet.
  it('bevorzugt den Grund aus dem Body gegenueber dem Status', () => {
    expect(setupErrorKey(httpError(401, 'expired'))).toBe('WIZARD.ERRORS.TOKEN_EXPIRED')
    expect(setupErrorKey(httpError(401, 'already_used'))).toBe('WIZARD.ERRORS.TOKEN_USED')
  })
})
