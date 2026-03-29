import { inject, Injectable } from '@angular/core'
import { HttpClient, HttpHeaders } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { Order } from '../models/order.model'

const API_URL = 'http://localhost:3030'
const DEVICE_CONFIG_KEY = 'panary_device_config'

@Injectable({ providedIn: 'root' })
export class OrderPrintService {
  private http = inject(HttpClient)

  /**
   * Sendet eine Bestellung ans Backend zum Rendern und Drucken.
   * Das Backend rendert den Bon serverseitig mit der vollen Encoder-API
   * (table mit Callbacks, Font-Wechsel in Zellen, box, etc.).
   */
  async printOrder(order: Order, printerIds?: string[]): Promise<void> {
    const headers = this.buildAuthHeaders()
    const deviceConfig = this.getDeviceConfig()
    const body: Record<string, unknown> = {
      orderId: order._id,
      deviceName: deviceConfig?.deviceName,
    }
    if (printerIds?.length) body['printerIds'] = printerIds

    await lastValueFrom(this.http.post(`${API_URL}/print-server/print-order`, body, { headers }))
  }

  private buildAuthHeaders(): HttpHeaders {
    // POS-Geräte: API-Key aus Device-Config
    try {
      const stored = localStorage.getItem(DEVICE_CONFIG_KEY)
      if (stored) {
        const config = JSON.parse(stored)
        if (config.apiKey && config.deviceId) {
          return new HttpHeaders({
            'X-Api-Key': config.apiKey,
            'X-Device-Id': config.deviceId,
          })
        }
      }
    } catch { /* leer */ }

    // Admin-Fallback: JWT aus sessionStorage
    try {
      const stored = sessionStorage.getItem('authenticationItem')
      if (stored) {
        const token = JSON.parse(stored)?.accessToken
        if (token) return new HttpHeaders({ Authorization: `Bearer ${token}` })
      }
    } catch { /* leer */ }

    return new HttpHeaders()
  }

  private getDeviceConfig(): { deviceName?: string } | null {
    try {
      const stored = localStorage.getItem(DEVICE_CONFIG_KEY)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  }
}
