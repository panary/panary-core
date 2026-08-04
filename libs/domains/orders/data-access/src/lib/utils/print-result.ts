/** Antwort von `POST /print-server/print-order` (api-edge, print-server.router.ts). */
export interface PrintOrderResponse {
  success: boolean
  results?: Array<{
    printerId?: string
    printerName?: string
    success: boolean
    error?: string
  }>
}

/**
 * Baut aus einer fehlgeschlagenen Druckantwort eine Meldung, die dem Kassierer
 * sagt, WELCHER Drucker WARUM nicht konnte.
 *
 * Hintergrund: Der Endpunkt meldet Teil- und Totalausfaelle mit **HTTP 200** und
 * `success: false` im Body — ein nicht erreichbarer Drucker (TCP-Timeout, 5 s)
 * oder eine leere Zielliste sah fuer den Client aus wie ein Erfolg. Der Dialog
 * quittierte mit „Druckauftrag gesendet", obwohl nichts aus dem Drucker kam.
 */
export function describePrintFailure(response: PrintOrderResponse): string {
  const failed = (response.results ?? []).filter(r => !r.success)
  if (failed.length === 0) return 'Druckauftrag fehlgeschlagen.'

  return failed
    .map(r => {
      const name = r.printerName?.trim()
      const reason = r.error?.trim() || 'Unbekannter Fehler'
      return name ? `${name}: ${reason}` : reason
    })
    .join(' · ')
}
