import type { OrderTseInfo } from './order-signing'

// Strukturierter TSE-Block für den Bon (KassenSichV Belegausgabepflicht) —
// pure und testbar. Der Drucker-Renderer (Edge) mappt das auf Encoder-Aufrufe.
export interface TseReceiptBlock {
  title: string
  rows: Array<{ label: string; value: string }>
  /** Optionaler QR-Inhalt (Signaturwert) für die maschinenlesbare Belegprüfung. */
  qrPayload?: string
  /** Hinweiszeile (z. B. §146a-Ausfall oder Simulations-Kennzeichnung). */
  note?: string
}

// Baut den TSE-Beleg-Block aus dem eingebetteten `order.tse`. `null` =
// nichts drucken (keine TSE-Info / kein fiskalischer Vorgang).
export const buildTseReceiptBlock = (tse: OrderTseInfo | null | undefined): TseReceiptBlock | null => {
  if (!tse) return null

  if (tse.status === 'signed') {
    return {
      title: 'TSE-Signatur',
      rows: [
        { label: 'Transaktion', value: String(tse.transactionNumber) },
        { label: 'Signaturzähler', value: tse.signatureCounter != null ? String(tse.signatureCounter) : '–' },
        { label: 'TSE-Zeit', value: tse.logTime ?? '–' },
      ],
      qrPayload: tse.signatureValue ?? undefined,
      note: tse.simulated ? 'SIMULATION – nicht fiskalisch gültig' : undefined,
    }
  }

  // unavailable / failed → §146a-Beleghinweis (Ausfall dokumentieren).
  return {
    title: 'TSE',
    rows: [{ label: 'Transaktion', value: String(tse.transactionNumber) }],
    note:
      tse.status === 'unavailable'
        ? 'TSE nicht verfügbar – Beleg wird nachsigniert (§146a)'
        : 'TSE-Signatur fehlgeschlagen – Beleg wird nachsigniert',
  }
}
