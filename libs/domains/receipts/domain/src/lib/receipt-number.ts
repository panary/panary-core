// Nicht-fiskalische interne Belegnummer (ADR D5) — rein für Auffindbarkeit und
// DSFinV-K-Auffüllung. Die fiskalisch lückenlose Nummer ist tse.transactionNumber;
// hier wird KEIN vierter gaploser Zähler eingeführt, die Nummer ist deterministisch
// aus Datum + Location + Bon-/Anzeigenummer abgeleitet.
export interface InternalReceiptNumberInput {
  /** ISO-8601-Zeitstempel des Belegs (issuedAt / recordingDate). */
  date: string
  locationId: string
  dailySequenceNumber: number
}

export const formatInternalReceiptNumber = (input: InternalReceiptNumberInput): string => {
  const ymd = input.date.slice(0, 10).replace(/-/g, '')
  const loc = input.locationId.replace(/-/g, '').slice(0, 8)
  const seq = String(Math.max(0, Math.trunc(input.dailySequenceNumber))).padStart(4, '0')
  return `R-${ymd}-${loc}-${seq}`
}
