import { describe, expect, it } from 'vitest'
import { describePrintFailure } from './print-result'

// Regression: `/print-server/print-order` meldet Teil- und Totalausfaelle mit
// HTTP 200 und `success: false` im Body. Der Client warf die Antwort weg und
// quittierte mit „Druckauftrag gesendet" — ein nicht erreichbarer Drucker war
// vom Erfolg nicht zu unterscheiden.

describe('describePrintFailure', () => {
  it('nennt Drucker und Grund', () => {
    expect(
      describePrintFailure({
        success: false,
        results: [{ printerName: 'Theke', success: false, error: 'connect ETIMEDOUT 10.10.100.40:9100' }],
      }),
    ).toBe('Theke: connect ETIMEDOUT 10.10.100.40:9100')
  })

  it('fuehrt mehrere gescheiterte Drucker auf und laesst erfolgreiche weg', () => {
    expect(
      describePrintFailure({
        success: false,
        results: [
          { printerName: 'Theke', success: true },
          { printerName: 'Pizza', success: false, error: 'ECONNREFUSED' },
          { printerName: 'Imbiss', success: false, error: 'Socket-Timeout' },
        ],
      }),
    ).toBe('Pizza: ECONNREFUSED · Imbiss: Socket-Timeout')
  })

  it('kommt ohne Druckernamen aus — der Kein-Ziel-Fall liefert einen leeren Namen', () => {
    expect(
      describePrintFailure({
        success: false,
        results: [{ printerId: '', printerName: '', success: false, error: 'Keine aktiven IP-Drucker' }],
      }),
    ).toBe('Keine aktiven IP-Drucker')
  })

  it('faellt auf einen generischen Text zurueck, wenn results fehlt oder leer ist', () => {
    expect(describePrintFailure({ success: false })).toBe('Druckauftrag fehlgeschlagen.')
    expect(describePrintFailure({ success: false, results: [] })).toBe('Druckauftrag fehlgeschlagen.')
  })

  it('benennt einen Fehler ohne Begruendung statt ihn zu verschlucken', () => {
    expect(describePrintFailure({ success: false, results: [{ printerName: 'Theke', success: false }] })).toBe(
      'Theke: Unbekannter Fehler',
    )
  })
})
