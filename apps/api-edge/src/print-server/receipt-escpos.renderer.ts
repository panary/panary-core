// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { buildTseReceiptBlock } from '@panary/tse/domain'
import type { Receipt } from '@panary/receipts/domain'
import type { EscposOptions } from './escpos.adapter'
import { formatPrintDate, formatPrintTime } from './print-date-format'

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
  const { paperWidth = '80mm', timeZone } = options
  const cols = COLUMNS_MAP[paperWidth] || 48
  const priceW = 12
  const nameW = cols - priceW
  const currency = receipt.currency || 'EUR'

  const enc = new ReceiptPrinterEncoder({ columns: cols, language: 'esc-pos' })
  enc.initialize()

  // Verkäufer-Kopf (Pflichtangabe Name + Anschrift)
  //
  // Der führende `newline()` ist Pflicht, nicht Kosmetik: Ohne ihn stellt der
  // Composer die Zentrier-Polsterung der Namenszeile VOR das `ESC @` aus
  // `initialize()` — die Leerzeichen liefen dann noch im Zustand des
  // vorangegangenen Druckauftrags.
  enc
    .newline()
    .align('center')
    .bold(true)
    .line(receipt.seller?.name ?? '')
    .bold(false)

  // 🚨 Der Font-Wechsel muss mit dem Umbruch der VORZEILE abgeschlossen sein —
  // sonst sitzt die zentrierte Zeile nicht mittig.
  //
  // Gemessen an @point-of-sale/receipt-printer-encoder@3.0.3 (#342): Der Composer
  // reiht eine zentrierte Zeile als `[space(n), ...style, ...inhalt]` — die
  // Polsterung steht VOR der Font-Umschaltung derselben Zeile. `n` rechnet er in
  // den Spalten des NEUEN Fonts (Font B: 48 → 64 Spalten), gedruckt werden die
  // Leerzeichen aber noch in der Zelle des alten Fonts (12 statt 9 Dots). Die
  // Zeile rutscht dadurch um ein Drittel der Polsterung nach rechts: am 80-mm-Beleg
  // 17 Leerzeichen à 12 statt à 9 Dots = 51 Dots ≈ 4 Zeichen zu weit rechts.
  // Die zweite Font-B-Zeile in Folge sass nur deshalb richtig, weil Font B beim
  // Umbruch der ersten bereits aktiv war.
  //
  // `font()` wirft mitten in einer Zeile („Changing fonts is not supported in the
  // middle of a line"), und `align()` erzeugt in dieser Version ausschliesslich
  // Software-Polsterung — der `ESC a`-Befehl der Sprachklasse ist ueber die
  // oeffentliche API nicht erreichbar. Der Wechsel braucht daher einen eigenen
  // Umbruch; die Leerzeile darunter ist der Preis dafuer.
  const hasSellerDetails = Boolean(receipt.seller?.address || receipt.seller?.taxNumber)
  if (hasSellerDetails) {
    enc.font('B').newline()
    if (receipt.seller?.address) enc.line(receipt.seller.address)
    if (receipt.seller?.taxNumber) enc.line(`St-Nr: ${receipt.seller.taxNumber}`)
    enc.font('A')
  }
  enc.align('left')

  // Beleg-Meta
  enc.newline().rule({ style: 'single' })
  enc.font('B')
  enc.line(`Beleg-Nr: ${receipt.receiptNumber ?? receipt.dailySequenceNumber}`)
  const issued = new Date(receipt.issuedAt)
  // Filialzeit, nicht Prozesszeit — der Aufrufer reicht `timeZone` aus den
  // Location-Settings durch (#274).
  enc.line(`Datum: ${formatPrintDate(issued, timeZone)} ${formatPrintTime(issued, timeZone)}`)
  if (receipt.kind === 'order-confirmation') enc.line('(Bestellbestaetigung — kein steuerlicher Beleg)')
  enc.font('A').newline()

  // Positionen
  for (const li of receipt.lineItems ?? []) {
    enc.table(
      [
        { width: nameW, align: 'left' },
        { width: priceW, align: 'right' },
      ],
      [[`${li.quantity}x ${li.name}`, fmtMoney(li.lineTotal, currency)]],
    )
  }

  // Nachlässe — direkt unter den Positionen, weil sie eine Minderung DIESES
  // Blocks sind: die Positionen tragen unrabattierte Summen, `totalGross` ist
  // rabattiert. Ohne die Zeile bliebe die Differenz auf dem Bon unerklärt (#228).
  for (const d of receipt.discounts ?? []) {
    enc.table(
      [
        { width: nameW, align: 'left' },
        { width: priceW, align: 'right' },
      ],
      [[`Nachlass: ${d.name}`, fmtMoney(-d.amount, currency)]],
    )
  }

  // Gesamtsumme
  enc.newline().rule({ style: 'single' })
  enc.table(
    [
      { width: Math.floor(cols * 0.55), align: 'left' },
      { width: Math.floor(cols * 0.45), align: 'right' },
    ],
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
      [
        { width: nameW, align: 'left' },
        { width: priceW, align: 'right' },
      ],
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
