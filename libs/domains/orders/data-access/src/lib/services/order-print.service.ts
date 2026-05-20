import { inject, Injectable } from '@angular/core'
import { HttpClient, HttpHeaders } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { LocationService } from '@panary/locations/data-access'
import { Order } from '@panary/orders/domain'
import { publishViaMqtt } from './mqtt-publish'

const API_URL = window.location.origin
const DEVICE_CONFIG_KEY = 'panary_device_config'

interface PrinterConfig {
  pid: string
  active: boolean
  type: 'ip' | 'mqtt'
  name: string
  mqttTopic?: string
}

@Injectable({ providedIn: 'root' })
export class OrderPrintService {
  private http = inject(HttpClient)
  private locationService = inject(LocationService)

  /**
   * Sendet eine Bestellung an die angegebenen Drucker.
   * IP-Drucker: HTTP an Backend (serverseitiges Rendering + ESC/POS).
   * MQTT-Drucker: Fire-and-Forget Publish an das konfigurierte Topic.
   */
  async printOrder(order: Order, printerIds?: string[]): Promise<void> {
    const allPrinters: PrinterConfig[] = this.locationService.printers || []
    let targets = allPrinters.filter(p => p.active)
    if (printerIds?.length) targets = targets.filter(p => printerIds.includes(p.pid))

    const ipPrinters = targets.filter(p => p.type === 'ip')
    const mqttPrinters = targets.filter(p => p.type === 'mqtt')

    const promises: Promise<void>[] = []

    if (ipPrinters.length > 0) {
      promises.push(this.printViaBackend(order, ipPrinters.map(p => p.pid)))
    }

    if (mqttPrinters.length > 0) {
      promises.push(this.printViaMqtt(order, mqttPrinters))
    }

    await Promise.all(promises)
  }

  private async printViaBackend(order: Order, printerIds: string[]): Promise<void> {
    const headers = this.buildAuthHeaders()
    const deviceConfig = this.getDeviceConfig()
    const body: Record<string, unknown> = {
      orderId: order._id,
      deviceName: deviceConfig?.deviceName,
    }
    if (printerIds.length) body['printerIds'] = printerIds

    await lastValueFrom(this.http.post(`${API_URL}/print-server/print-order`, body, { headers }))
  }

  private async printViaMqtt(order: Order, printers: PrinterConfig[]): Promise<void> {
    const settings = this.locationService.printSettings
    if (!settings?.mqttServerUrl || !settings?.mqttServerPort) return

    const broker = {
      protocol: settings.mqttServerProtocol || 'ws',
      host: settings.mqttServerUrl,
      port: settings.mqttServerPort,
    }

    const deviceConfig = this.getDeviceConfig()
    const clientId = deviceConfig?.deviceId ? `panary-${deviceConfig.deviceId}` : undefined
    const payload = {
      orderId: order._id,
      deviceName: deviceConfig?.deviceName,
      printerIds: [] as string[],
    }

    const promises = printers
      .filter(p => p.mqttTopic)
      .map(p => publishViaMqtt(payload, p.mqttTopic!, broker, clientId))

    await Promise.all(promises)
  }

  private buildAuthHeaders(): HttpHeaders {
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

    try {
      const stored = sessionStorage.getItem('authenticationItem')
      if (stored) {
        const token = JSON.parse(stored)?.accessToken
        if (token) return new HttpHeaders({ Authorization: `Bearer ${token}` })
      }
    } catch { /* leer */ }

    return new HttpHeaders()
  }

  private getDeviceConfig(): { deviceName?: string; deviceId?: string } | null {
    try {
      const stored = localStorage.getItem(DEVICE_CONFIG_KEY)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  }
}
