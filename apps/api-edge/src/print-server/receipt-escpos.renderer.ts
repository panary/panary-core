// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { buildTseReceiptBlock } from '@panary/tse/domain'
import type { Receipt } from '@panary/receipts/domain'
import type { EscposOptions } from './escpos.adapter'

const COLUMNS_MAP: Record<string, number> = { '58mm': 32, '80mm': 48 }

const fmtMoney = (n: number, currency: string): string => `${n.toFixed(2).replace('.', ',')} ${currency}`

/**
 * Rendert einen persistenten Beleg (Receipt-Snapshot, §146a AO) als ESC/POS —
 * der lokale Druck-Kanal des Beleg-Systems (ADR Phase 3, ReceiptProvider.print-
 * Binding am Edge). Reiner Render aus dem immutablen Snapshot; der TSE-Block läuft
 * über den geteilten `buildTseReceiptBlock` (identisch zum Order-Bon).
 *
 * Dispatch an einen konkreten Drucker übernimmt der bestehende Print-Server
 * (`print-server.manager`/`-router`, MQTT/Netzwerk) — der Trigger („drucke beim
 * Ausstellen, wenn Print-Kanal/localPrintOnly aktiv") ist der Integrationspunkt
 * und hängt an der Drucker-Konfiguration (Hardware/Laufzeit).
 */
export function renderReceiptEscPos(receipt: Receipt, options: EscposOptions = {}): Uint8Array {
  const { paperWidth = '80mm' } = options
  const cols = COLUMNS_MAP[paperWidth] || 48
  const priceW = 12
  const nameW = cols - priceW
  const currency = receipt.currency || 'EUR'

  const enc = new ReceiptPrinterEncoder({ columns: cols, language: 'esc-pos' })
  enc.initialize()

  // Verkäufer-Kopf (Pflichtangabe Name + Anschrift)
  enc.newline().align('center').bold(true).line(receipt.seller?.name ?? '').bold(false)
  if (receipt.seller?.address) enc.font('B').line(receipt.seller.address).font('A')
  if (receipt.seller?.taxNumber) enc.font('B').line(`St-Nr: ${receipt.seller.taxNumber}`).font('A')
  enc.align('left')

  // Beleg-Meta
  enc.newline().rule({ style: 'single' })
  enc.font('B')
  enc.line(`Beleg-Nr: ${receipt.receiptNumber ?? receipt.dailySequenceNumber}`)
  const issued = new Date(receipt.issuedAt)
  enc.line(
    `Datum: ${issued.toLocaleDateString('de-DE')} ${issued.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
  )
  if (receipt.kind === 'order-confirmation') enc.line('(Bestellbestaetigung — kein steuerlicher Beleg)')
  enc.font('A').newline()

  // Positionen
  for (const li of receipt.lineItems ?? []) {
    enc.table(
      [{ width: nameW, align: 'left' }, { width: priceW, align: 'right' }],
      [[`${li.quantity}x ${li.name}`, fmtMoney(li.lineTotal, currency)]],
    )
  }

  // Gesamtsumme
  enc.newline().rule({ style: 'single' })
  enc.table(
    [{ width: Math.floor(cols * 0.55), align: 'left' }, { width: Math.floor(cols * 0.45), align: 'right' }],
    [
      [
        (e: any) => e.bold(true).size(2, 2).text('Gesamt').size(1, 1).bold(false),
        (e: any) => e.bold(true).size(2, 2).text(fmtMoney(receipt.totalGross, currency)).size(1, 1).bold(false),
      ],
    ],
  )

  // Steuer-Aufschlüsselung (mehrsatzig, z. B. 7 % / 19 %)
  enc.font('B')
  for (const t of receipt.taxSummary?.taxes ?? []) {
    enc.table(
      [{ width: nameW, align: 'left' }, { width: priceW, align: 'right' }],
      [[`MwSt ${t.taxRate}% (Netto ${fmtMoney(t.amount, currency)})`, fmtMoney(t.tax, currency)]],
    )
  }
  enc.font('A').rule({ style: 'single' })

  // TSE-Signaturblock (KassenSichV) — nur bei sale mit tse; No-Op sonst.
  appendTseBlock(enc, receipt.tse)

  enc.newline(6).cut()
  return enc.encode()
}

function appendTseBlock(enc: any, tse: unknown): void {
  if (!tse || typeof tse !== 'object') return
  const block = buildTseReceiptBlock(tse as never)
  if (!block) return
  enc.newline().font('B').align('left')
  enc.bold(true).line(block.title).bold(false)
  for (const row of block.rows) enc.line(`${row.label}: ${row.value}`)
  if (block.qrPayload) enc.align('center').qrcode(block.qrPayload, { model: 2, size: 5, errorlevel: 'm' }).align('left')
  if (block.note) enc.bold(true).line(block.note).bold(false)
  enc.font('A')
}
