import type { PrintElement, PrintJob, TextLine } from '@panary/locations/domain'
import { buildEscposBuffer, sendToNetworkPrinter, type EscposOptions } from './escpos.adapter'
import { receiptVariantForRole, renderOrderReceipt } from './order-receipt.renderer'
import { formatPrintDateTime } from './print-date-format'
import { logger } from '@panary/shared-backend'

export interface PrinterConfig {
  pid: string
  active: boolean
  type: 'ip' | 'mqtt'
  name: string
  ip?: string
  port?: number
  paperWidth?: '58mm' | '80mm'
  encoding?: string
  /**
   * Was dieser Drucker druckt (#347). Fehlt das Feld — jeder Bestandsdrucker —,
   * gilt `both`; die Ableitung sitzt in `receiptVariantForRole`.
   */
  role?: 'kitchen' | 'receipt' | 'both'
  mqttTopic?: string
}

export interface PrintResult {
  success: boolean
  results: Array<{
    printerId: string
    printerName: string
    success: boolean
    error?: string
  }>
}

/**
 * Führt einen Druckauftrag aus — sendet das Dokument an alle Ziel-Drucker.
 * Nur IP-Drucker werden vom Backend bedient (MQTT bleibt Frontend-seitig).
 */
export async function executePrintJob(job: PrintJob, allPrinters: PrinterConfig[]): Promise<PrintResult> {
  // Ziel-Drucker filtern: nur aktive IP-Drucker
  let targetPrinters = allPrinters.filter(p => p.active && p.type === 'ip')

  // Falls printerIds angegeben, nur diese
  if (job.printerIds && job.printerIds.length > 0) {
    targetPrinters = targetPrinters.filter(p => job.printerIds!.includes(p.pid))
  }

  if (targetPrinters.length === 0) {
    return {
      success: false,
      results: [{ printerId: '', printerName: '', success: false, error: 'Keine aktiven IP-Drucker gefunden' }],
    }
  }

  const copies = job.copies ?? 1
  const results: PrintResult['results'] = []

  for (const printer of targetPrinters) {
    const options: EscposOptions = {
      paperWidth: (printer.paperWidth as '58mm' | '80mm') ?? '80mm',
      encoding: printer.encoding ?? 'cp437',
    }

    try {
      const buffer = buildEscposBuffer(job.document, options)
      const host = printer.ip!
      const port = printer.port ?? 9100

      for (let i = 0; i < copies; i++) {
        await sendToNetworkPrinter(host, port, buffer)
      }

      results.push({ printerId: printer.pid, printerName: printer.name, success: true })
      logger.info({
        message: `Druckauftrag erfolgreich an ${printer.name} (${host}:${port})`,
        event: 'print.success',
        printer: printer.name,
        copies,
      })
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      results.push({ printerId: printer.pid, printerName: printer.name, success: false, error: errorMessage })
      logger.error({
        message: `Druckfehler an ${printer.name}: ${errorMessage}`,
        event: 'print.error',
        printer: printer.name,
      })
    }
  }

  return {
    success: results.every(r => r.success),
    results,
  }
}

export interface OrderReceiptJob {
  /** Bestellung aus der Edge-DB. Die Vorlage liest sie ungetypt — wie `renderOrderReceipt`. */
  order: unknown
  /** Filiale samt `settings` — liefert Zeitzone, General-Preise und Steuerangaben. */
  location: unknown
  /**
   * Nur fuer die Log-Events je Drucker. `/print-server/*` sind rohe Koa-Routen und
   * laufen nicht durch `canonicalLog`: Sichtbar ist allein, was der Handler selbst
   * loggt (#346).
   */
  orderId: string
  deviceName?: string
}

/**
 * Rendert und sendet einen Bestellbon — **je Zieldrucker einzeln gerendert**.
 *
 * Bis #346 nahm `/print-order` die Papierbreite vom ERSTEN Drucker, renderte einen
 * Buffer und schickte genau diesen an alle Ziele. Standen 80 mm und 58 mm
 * nebeneinander, bekam der zweite Drucker ein Layout fuer die falsche Spaltenzahl
 * (`COLUMNS_MAP`: 58mm=32, 80mm=48) — Tabellen brachen um, Betraege rutschten aus
 * der Spalte. Der generische Druckpfad (`executePrintJob` oben) machte es von
 * Anfang an richtig; die beiden Pfade stehen seitdem bewusst in DERSELBEN Datei,
 * damit sie nicht erneut auseinanderlaufen.
 *
 * Abweichung zu `executePrintJob`: Diese Funktion filtert **nicht**. Sie erwartet
 * bereits ausgewaehlte Ziele, weil der Router bei leerer Liste ein eigenes
 * Wide-Event schreibt (`print.order_no_printers`), das `settings` und
 * `requestedPrinterIds` braucht — Angaben, die hier nicht vorliegen.
 *
 * Fehler bleiben **pro Drucker**: Der `try` umschliesst Rendern UND Senden, ein
 * Fehlschlag fuer ein Ziel reisst die uebrigen nicht mit.
 */
export async function executeOrderReceiptJob(
  job: OrderReceiptJob,
  targetPrinters: PrinterConfig[],
): Promise<PrintResult> {
  const results: PrintResult['results'] = []

  for (const printer of targetPrinters) {
    const paperWidth = printer.paperWidth ?? '80mm'
    // Kuechendrucker bekommen den Bon ohne Filialkopf und ohne TSE-Block (#347).
    // Ohne gepflegte Rolle ist das der Vollbon — siehe `receiptVariantForRole`.
    const variant = receiptVariantForRole(printer.role)
    // Welche Haelfte des `try` gescheitert ist, steht sonst nirgends: Die
    // Trennung Rendern/Senden entsteht hier erst, und `/print-server/*` laeuft
    // nicht durch `canonicalLog`. Ohne das Feld sieht ein kaputter Bon im
    // Edge-Log aus wie ein abgezogenes Kabel.
    let phase: 'render' | 'send' = 'render'

    try {
      // Bewusst KEIN Cache ueber gleiche Papierbreiten: Ein geteilter Buffer ist
      // genau die Form des Fehlers, den #346 behebt, und seit #347 haengt die
      // Vorlage zusaetzlich an der Druckerrolle — ein Cache-Schluessel aus der
      // Breite allein waere still falsch, er wuerde dem Kuechendrucker den Bon
      // des Kassendruckers geben. Der zweite Render kostet gemessen ~1,5 ms (Bon
      // mit 12 Positionen, 80 mm, n=500); das ist der Preis, und er ist kleiner
      // als das Risiko.
      const buffer = renderOrderReceipt(
        job.order,
        job.location,
        {
          paperWidth,
          // `encoding` erreicht heute WEDER `renderOrderReceipt` NOCH
          // `buildEscposBuffer` — beide erzeugen den Encoder ohne Codepage-Option.
          // Mitgegeben, damit beide Druckpfade dieselben Optionen tragen und das
          // Auswerten spaeter EINE Stelle ist, nicht zwei.
          encoding: printer.encoding ?? 'cp437',
          variant,
        },
        job.deviceName,
      )

      phase = 'send'
      await sendToNetworkPrinter(printer.ip!, printer.port ?? 9100, buffer)

      results.push({ printerId: printer.pid, printerName: printer.name, success: true })
      logger.info({
        message: `Bestellbon an ${printer.name} gesendet`,
        event: 'print.order_success',
        printer: printer.name,
        orderId: job.orderId,
        paperWidth,
        variant,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ printerId: printer.pid, printerName: printer.name, success: false, error: msg })
      logger.error({
        message: `Bestellbon-Fehler an ${printer.name}: ${msg}`,
        event: 'print.order_error',
        printer: printer.name,
        orderId: job.orderId,
        paperWidth,
        variant,
        phase,
      })
    }
  }

  return {
    success: results.every(r => r.success),
    results,
  }
}

/**
 * Generiert ein Testdruck-Dokument für einen einzelnen Drucker.
 *
 * `timeZone` kommt aus den Location-Settings und wird vom Print-Server-Manager
 * durchgereicht (beim Start aus der Filiale gelesen). Fehlt sie, greift
 * `DEFAULT_BUSINESS_TIMEZONE` — der Testdruck prüft die Hardware, nicht die
 * Uhrzeit, und darf daran nicht scheitern.
 */
export function buildTestPrintDocument(printerName: string, timeZone?: string): PrintElement[] {
  return [
    { type: 'text', text: 'PANARY TESTDRUCK', bold: true, align: 'center', width: 2, height: 2 },
    { type: 'feed', lines: 1 },
    { type: 'rule', character: '=', count: 48 },
    { type: 'text', text: `Drucker: ${printerName}`, align: 'center' },
    { type: 'text', text: `Datum: ${formatPrintDateTime(new Date(), timeZone)}`, align: 'center' },
    { type: 'rule', character: '=', count: 48 },
    { type: 'feed', lines: 1 },
    { type: 'badge', text: 'BADGE TEST', style: 'inverted', align: 'center' },
    { type: 'feed', lines: 1 },
    { type: 'qr', data: 'https://panary.de', size: 6, align: 'center' },
    { type: 'feed', lines: 1 },
    { type: 'text', text: 'Normal | ', align: 'left' },
    { type: 'text', text: 'Fett', bold: true, align: 'left' },
    { type: 'text', text: 'Unterstrichen', underline: true, align: 'left' },
    { type: 'text', text: 'Gross', width: 2, height: 2, align: 'center' },
    { type: 'feed', lines: 2 },
    { type: 'text', text: 'Testdruck erfolgreich!', align: 'center', bold: true },
    { type: 'feed', lines: 3 },
    { type: 'cut' },
  ]
}

/**
 * Konvertiert das Legacy TextLine[]-Format in das neue PrintElement[]-Format.
 */
export function convertTextLinesToPrintDocument(lines: TextLine[]): PrintElement[] {
  const elements: PrintElement[] = []

  for (const line of lines) {
    const el: PrintElement = {
      type: 'text' as const,
      text: line.text,
      bold: line.type === 'B' ? true : undefined,
      align: line.align as 'left' | 'center' | 'right' | undefined,
      width: line.width,
      height: line.height,
    }
    elements.push(el)
  }

  elements.push({ type: 'feed', lines: 3 })
  elements.push({ type: 'cut' })

  return elements
}
