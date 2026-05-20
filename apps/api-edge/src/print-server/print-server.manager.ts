import type { PrintJob } from '@panary/locations/domain'
import { executePrintJob, buildTestPrintDocument, type PrinterConfig, type PrintResult } from './print-job.builder'
import { logger } from '@panary/shared-backend'

export interface PrintServerStatus {
  status: 'stopped' | 'running' | 'error'
  startedAt?: string
  error?: string
  printerCount?: number
}

/**
 * Singleton-Manager für den integrierten Print-Server.
 * Verwaltet den Lifecycle (start/stop/restart) und delegiert Druckaufträge.
 */
class PrintServerManager {
  private _status: 'stopped' | 'running' | 'error' = 'stopped'
  private _startedAt?: string
  private _error?: string
  private _printers: PrinterConfig[] = []

  async start(printers: PrinterConfig[]): Promise<void> {
    this._printers = printers
    this._status = 'running'
    this._startedAt = new Date().toISOString()
    this._error = undefined

    logger.info({
      message: `Print-Server gestartet mit ${printers.length} Drucker(n)`,
      event: 'print-server.start',
      printerCount: printers.length,
    })
  }

  async stop(): Promise<void> {
    this._status = 'stopped'
    this._startedAt = undefined
    this._printers = []

    logger.info({
      message: 'Print-Server gestoppt',
      event: 'print-server.stop',
    })
  }

  async restart(printers: PrinterConfig[]): Promise<void> {
    await this.stop()
    await this.start(printers)
  }

  updatePrinters(printers: PrinterConfig[]): void {
    this._printers = printers
  }

  getStatus(): PrintServerStatus {
    return {
      status: this._status,
      startedAt: this._startedAt,
      error: this._error,
      printerCount: this._printers.length,
    }
  }

  isRunning(): boolean {
    return this._status === 'running'
  }

  async print(job: PrintJob): Promise<PrintResult> {
    if (!this.isRunning()) {
      return {
        success: false,
        results: [{ printerId: '', printerName: '', success: false, error: 'Print-Server ist nicht aktiv' }],
      }
    }

    return executePrintJob(job, this._printers)
  }

  async testPrint(printerId: string): Promise<PrintResult> {
    if (!this.isRunning()) {
      return {
        success: false,
        results: [{ printerId, printerName: '', success: false, error: 'Print-Server ist nicht aktiv' }],
      }
    }

    const printer = this._printers.find(p => p.pid === printerId)
    if (!printer) {
      return {
        success: false,
        results: [{ printerId, printerName: '', success: false, error: 'Drucker nicht gefunden' }],
      }
    }

    if (printer.type !== 'ip') {
      return {
        success: false,
        results: [{ printerId, printerName: printer.name, success: false, error: 'Testdruck nur für IP-Drucker verfügbar' }],
      }
    }

    const testDocument = buildTestPrintDocument(printer.name)
    const testJob: PrintJob = { document: testDocument }

    return executePrintJob(testJob, [printer])
  }
}

// Singleton-Export
export const printServerManager = new PrintServerManager()
