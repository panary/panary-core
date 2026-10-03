import net from 'net'
// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { resolvePrinterCodepage, type PrintElement } from '@panary/locations/domain'
import { logger } from '@panary/shared-backend'
import { transliterateForCodepage } from './escpos-transliteration'

const TCP_TIMEOUT = 5000

export type PaperWidth = '58mm' | '80mm'

const COLUMNS_MAP: Record<PaperWidth, number> = {
  '58mm': 32,
  '80mm': 48,
}

export interface EscposOptions {
  paperWidth?: PaperWidth
  /**
   * Gepflegter Zeichensatz des Druckers (`printers[].encoding`, #376). Leer =
   * CP437, byte-identisch zum Stand davor. Unbekannte Werte fallen auf CP437
   * zurueck, siehe `resolveEscposCodepage`.
   */
  encoding?: string
  /**
   * Zeitzone der Filiale (`settings.generalSettings.timezone`) fuer alle
   * Datums-/Uhrzeitangaben der Vorlage. Leer = `DEFAULT_BUSINESS_TIMEZONE`.
   * Ohne sie formatiert der Renderer in der Prozess-Zeitzone — im Container
   * UTC (#274).
   */
  timeZone?: string
}

/**
 * Gepflegtes Encoding → Encoder-Codepage. Ein unbekannter Wert druckt in CP437
 * und hinterlaesst ein Event: `/print-server/*` laeuft nicht durch
 * `canonicalLog`, ohne das Event waere der Fehlgriff unsichtbar (#376).
 */
export function resolveEscposCodepage(encoding: string | undefined, printerName?: string): string {
  const { codepage, known } = resolvePrinterCodepage(encoding)
  if (!known) {
    logger.warn({
      message: `Unbekanntes Drucker-Encoding "${encoding}" — Bon wird in ${codepage} gedruckt`,
      event: 'print.encoding_unknown',
      printer: printerName,
      encoding,
      codepage,
    })
  }
  return codepage
}

/**
 * Der eine Ort, an dem ein ESC/POS-Encoder entsteht — fuer alle drei
 * Renderpfade (Vorlage, Bestellbon, fiskalischer Beleg). Bis #376 erzeugte jeder
 * seinen eigenen ohne Codepage, und das gepflegte Encoding kam nirgends an.
 *
 * `codepage('cp437')` ist byte-identisch zum Encoder ohne Angabe (gemessen an
 * 3.0.3: beide schreiben `ESC t 0` vor den ersten Text).
 */
export function createEscposEncoder(columns: number, encoding?: string): InstanceType<typeof ReceiptPrinterEncoder> {
  const encoder = new ReceiptPrinterEncoder({ columns, language: 'esc-pos' })
  const codepage = resolveEscposCodepage(encoding)
  encoder.codepage(codepage)
  installTransliteration(encoder, codepage)
  return encoder
}

/**
 * Haengt die Transliteration (#517) an den Encoder — hier und nicht je
 * Renderer, damit die drei Pfade nicht wieder auseinanderlaufen.
 *
 * `line()` ruft intern `this.text()` und ist damit mit abgedeckt. `table()`
 * dagegen baut je Zelle einen eigenen Encoder: Text-Zellen werden vorab
 * ersetzt, Callback-Zellen bekommen einen Zellen-Encoder mit derselben Ersetzung.
 *
 * Was am Ende `?` bleibt, meldet `encode()` einmal je Bon als
 * `print.unmappable_chars` — `/print-server/*` laeuft nicht durch
 * `canonicalLog`, ohne das Event waere es stumm.
 */
function installTransliteration(encoder: any, codepage: string): void {
  const unmappable = new Map<string, number>()
  const ersetze = (value: unknown) =>
    typeof value === 'string' ? transliterateForCodepage(value, codepage, unmappable) : value

  const patchText = (enc: any) => {
    const text = enc.text
    enc.text = (value: unknown) => text.call(enc, ersetze(value))
    return enc
  }
  patchText(encoder)

  const table = encoder.table
  encoder.table = (columnDefs: unknown, rows: unknown[][]) =>
    table.call(
      encoder,
      columnDefs,
      rows.map(row =>
        row.map(cell => (typeof cell === 'function' ? (enc: any) => cell(patchText(enc)) : ersetze(cell))),
      ),
    )

  const encode = encoder.encode
  encoder.encode = (format?: string) => {
    if (unmappable.size > 0) {
      logger.warn({
        message: `Bon enthaelt Zeichen, die ${codepage} nicht darstellen kann — als "?" gedruckt`,
        event: 'print.unmappable_chars',
        codepage,
        chars: [...unmappable].map(([char, count]) => ({
          char,
          codepoint: `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
          count,
        })),
      })
      unmappable.clear()
    }
    return encode.call(encoder, format)
  }
}

/**
 * Wandelt ein PrintElement[]-Array in einen ESC/POS-Buffer um.
 */
export function buildEscposBuffer(elements: PrintElement[], options: EscposOptions = {}): Uint8Array {
  const { paperWidth = '80mm', encoding } = options
  const columns = COLUMNS_MAP[paperWidth] || 48

  const encoder = createEscposEncoder(columns, encoding)

  encoder.initialize()

  for (const el of elements) {
    switch (el.type) {
      case 'text':
        applyTextElement(encoder, el, columns)
        break
      case 'qr':
        if (el.align) encoder.align(el.align)
        encoder.qrcode(el.data, 1, el.size ?? 6, 'h')
        encoder.align('left')
        break
      case 'image':
        if (el.align) encoder.align(el.align)
        // Bilder müssen als ImageData übergeben werden — Base64-Dekodierung
        // erfolgt im print-job.builder, hier wird das rohe Element weitergereicht
        logger.warn({
          message: 'Image-Element wird übersprungen — erfordert vorverarbeitetes ImageData',
          event: 'print.image_skip',
        })
        encoder.align('left')
        break
      case 'badge':
        if (el.align) encoder.align(el.align)
        if (el.style === 'inverted' || !el.style) {
          encoder.invert(true)
          encoder.text(` ${el.text} `)
          encoder.invert(false)
        } else {
          encoder.bold(true)
          encoder.text(`[ ${el.text} ]`)
          encoder.bold(false)
        }
        encoder.newline()
        encoder.align('left')
        break
      case 'feed':
        encoder.newline(el.lines ?? 1)
        break
      case 'cut':
        encoder.cut(el.partial ? 'partial' : 'full')
        break
      case 'table':
        applyTableElement(encoder, el)
        break
      case 'rule': {
        if (el.style) {
          // Native rule()-Methode der Library — erzeugt saubere Linien
          encoder.rule({ style: el.style })
        } else {
          const char = el.character ?? '-'
          const count = el.count ?? columns
          encoder.text(char.repeat(count))
          encoder.newline()
        }
        break
      }
    }
  }

  return encoder.encode()
}

function applyTextElement(
  encoder: InstanceType<typeof ReceiptPrinterEncoder>,
  el: Extract<PrintElement, { type: 'text' }>,
  _columns: number,
): void {
  if (el.align) encoder.align(el.align)
  if (el.font) encoder.font(el.font)
  if (el.bold) encoder.bold(true)
  if (el.italic) encoder.italic(true)
  if (el.underline) encoder.underline(true)
  if (el.invert) encoder.invert(true)

  const w = el.width ?? 1
  const h = el.height ?? 1
  if (w > 1 || h > 1) encoder.size(w, h)

  encoder.text(el.text)
  encoder.newline()

  // Reset — umgekehrte Reihenfolge
  if (w > 1 || h > 1) encoder.size(1, 1)
  if (el.invert) encoder.invert(false)
  if (el.underline) encoder.underline(false)
  if (el.italic) encoder.italic(false)
  if (el.bold) encoder.bold(false)
  if (el.font) encoder.font('A')
  if (el.align) encoder.align('left')
}

function applyTableElement(
  encoder: InstanceType<typeof ReceiptPrinterEncoder>,
  el: Extract<PrintElement, { type: 'table' }>,
): void {
  // Font muss VOR dem table()-Aufruf gesetzt werden — innerhalb von Zellen nicht erlaubt
  if (el.font) encoder.font(el.font)

  const colDefs = el.columns.map((col: any) => ({
    width: col.width,
    align: col.align || 'left',
    marginLeft: col.marginLeft || 0,
    marginRight: col.marginRight || 0,
  }))

  const rows = el.rows.map((row: any[]) =>
    row.map((cell: any) => {
      if (typeof cell === 'string') return cell
      return (enc: any) => {
        if (cell.bold) enc.bold(true)
        if (cell.width || cell.height) enc.size(cell.width ?? 1, cell.height ?? 1)
        enc.text(cell.text)
        if (cell.width || cell.height) enc.size(1, 1)
        if (cell.bold) enc.bold(false)
      }
    }),
  )

  encoder.table(colDefs, rows)

  if (el.font) encoder.font('A')
}

/**
 * Sendet rohe ESC/POS-Daten an einen Netzwerkdrucker via TCP.
 */
export function sendToNetworkPrinter(host: string, port: number, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(TCP_TIMEOUT)

    socket.on('timeout', () => {
      cleanup()
      reject(new Error(`Zeitüberschreitung bei Verbindung zu ${host}:${port}`))
    })

    socket.on('error', err => {
      cleanup()
      reject(new Error(`Verbindungsfehler zu ${host}:${port}: ${err.message}`))
    })

    socket.connect(port, host, () => {
      socket.write(Buffer.from(data), err => {
        cleanup()
        if (err) {
          reject(new Error(`Sendefehler an ${host}:${port}: ${err.message}`))
        } else {
          resolve()
        }
      })
    })
  })
}
