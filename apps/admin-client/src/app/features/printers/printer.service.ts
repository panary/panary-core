import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'

const API_URL = 'http://localhost:3030'

export interface PrintServerStatus {
  status: 'stopped' | 'running' | 'error'
  startedAt?: string
  error?: string
  printerCount?: number
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

@Injectable({ providedIn: 'root' })
export class PrinterService {
  private http = inject(HttpClient)

  async getStatus(): Promise<PrintServerStatus> {
    return lastValueFrom(this.http.get<PrintServerStatus>(`${API_URL}/print-server/status`))
  }

  async start(): Promise<{ success: boolean; status: PrintServerStatus }> {
    return lastValueFrom(this.http.post<{ success: boolean; status: PrintServerStatus }>(`${API_URL}/print-server/start`, {}))
  }

  async stop(): Promise<{ success: boolean; status: PrintServerStatus }> {
    return lastValueFrom(this.http.post<{ success: boolean; status: PrintServerStatus }>(`${API_URL}/print-server/stop`, {}))
  }

  async restart(): Promise<{ success: boolean; status: PrintServerStatus }> {
    return lastValueFrom(this.http.post<{ success: boolean; status: PrintServerStatus }>(`${API_URL}/print-server/restart`, {}))
  }

  async testPrint(printerId: string): Promise<PrintResult> {
    return lastValueFrom(this.http.post<PrintResult>(`${API_URL}/print-server/test-print`, { printerId }))
  }
}
