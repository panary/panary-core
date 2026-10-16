import { writeOffErrorMessage } from './write-off-error'

// Der POS-Dialog meldete jeden Fehler als „Fehler beim Speichern" (panary/panary-core#635). Bis zum
// Edge-Service lief jede Abschreibung ins Leere, und niemand sah, warum. Die Meldung nennt jetzt
// die Ursache; die Server-Message dient als Rückfall.
describe('writeOffErrorMessage', () => {
  const t = (key: string) => `<${key}>`

  it('nennt fehlende Rechte, wenn der Edge mit 403 ablehnt', () => {
    expect(writeOffErrorMessage({ code: 403, message: 'You do not have permission' }, t)).toEqual(
      '<WRITE_OFF.ERROR_FORBIDDEN>',
    )
  })

  it('nennt ungültige Daten bei 400 — mit der Server-Meldung als Detail', () => {
    expect(writeOffErrorMessage({ code: 400, message: 'validation failed' }, t)).toEqual(
      '<WRITE_OFF.ERROR_INVALID> (validation failed)',
    )
  })

  it('meldet einen unbekannten Service am Edge als nicht verfügbar statt als Speicherfehler', () => {
    expect(writeOffErrorMessage({ code: 404, message: "Can not find service 'write-offs'" }, t)).toEqual(
      '<WRITE_OFF.ERROR_UNAVAILABLE>',
    )
  })

  it('fällt auf die Server-Meldung zurück, sonst auf den generischen Text', () => {
    expect(writeOffErrorMessage({ code: 500, message: 'Timeout' }, t)).toEqual('Timeout')
    expect(writeOffErrorMessage(undefined, t)).toEqual('<COMMON.SAVE_ERROR>')
  })
})
