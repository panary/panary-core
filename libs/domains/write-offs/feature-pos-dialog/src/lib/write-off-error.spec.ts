import { onTestFinished, vi } from 'vitest'

import { withTimeout, writeOffErrorMessage } from './write-off-error'

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
    expect(writeOffErrorMessage({ code: 404, message: "Service 'write-offs' not found" }, t)).toEqual(
      '<WRITE_OFF.ERROR_UNAVAILABLE>',
    )
  })

  it('meldet ein anderes 404 nicht als fehlenden Service', () => {
    expect(writeOffErrorMessage({ code: 404, message: 'No record found' }, t)).toEqual('No record found')
  })

  it('schweigt bei Mandantensperre und Kontext-403 — die zeigt der ServiceHelper selbst an', () => {
    expect(writeOffErrorMessage({ code: 403, message: 'TENANT_SUSPENDED: Mandant gesperrt' }, t)).toBeNull()
    expect(writeOffErrorMessage({ code: 403, message: 'Tenant-Kontext fehlt' }, t)).toBeNull()
  })

  it('fällt auf die Server-Meldung zurück, sonst auf den generischen Text', () => {
    expect(writeOffErrorMessage({ code: 500, message: 'Timeout' }, t)).toEqual('Timeout')
    expect(writeOffErrorMessage(undefined, t)).toEqual('<COMMON.SAVE_ERROR>')
  })

  it('meldet eine ausbleibende Antwort als Zeitüberschreitung', () => {
    expect(writeOffErrorMessage({ code: 408, message: 'timeout' }, t)).toEqual('<WRITE_OFF.ERROR_TIMEOUT>')
  })
})

describe('withTimeout', () => {
  it('gibt nach Ablauf mit 408 auf, statt ewig zu warten', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const pending = withTimeout(new Promise(() => undefined), 1000)
    vi.advanceTimersByTime(1000)

    await expect(pending).rejects.toMatchObject({ code: 408 })
  })

  it('reicht Ergebnis und Fehler unverändert durch', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toEqual('ok')
    await expect(withTimeout(Promise.reject({ code: 403 }), 1000)).rejects.toEqual({ code: 403 })
  })
})
