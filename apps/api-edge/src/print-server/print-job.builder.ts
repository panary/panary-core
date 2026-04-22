import type { PrintElement, PrintJob, TextLine } from '@panary-core/locations/domain'
import { buildEscposBuffer, sendToNetworkPrinter, type EscposOptions } from './escpos.adapter'
import { logger } from '@panary-core/shared-backend'

export interface PrinterConfig {
  pid: string
  active: boolean
  type: 'ip' | 'mqtt'
  name: string
  ip?: string
  port?: number
  paperWidth?: '58mm' | '80mm'
  encoding?: string
  primaryTopics?: string[]
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
export async function executePrintJob(
  job: PrintJob,
  allPrinters: PrinterConfig[],
): Promise<PrintResult> {
  // Ziel-Drucker filtern: nur aktive IP-Drucker
  let targetPrinters = allPrinters.filter(p => p.active && p.type === 'ip')

  // Falls printerIds angegeben, nur diese
  if (job.printerIds && job.printerIds.length > 0) {
    targetPrinters = targetPrinters.filter(p => job.printerIds!.includes(p.pid))
  }

  if (targetPrinters.length === 0) {
    return { success: false, results: [{ printerId: '', printerName: '', success: false, error: 'Keine aktiven IP-Drucker gefunden' }] }
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

/**
 * Generiert ein Testdruck-Dokument für einen einzelnen Drucker.
 */
export function buildTestPrintDocument(printerName: string): PrintElement[] {
  return [
    { type: 'text', text: 'PANARY TESTDRUCK', bold: true, align: 'center', width: 2, height: 2 },
    { type: 'feed', lines: 1 },
    { type: 'rule', character: '=', count: 48 },
    { type: 'text', text: `Drucker: ${printerName}`, align: 'center' },
    { type: 'text', text: `Datum: ${new Date().toLocaleString('de-DE')}`, align: 'center' },
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
