import { inject, Injectable, signal } from '@angular/core'
import { ApiService } from './api.service'

interface DeviceConnectionStatus {
  online: number
  total: number
  connectedDeviceIds: string[]
}

/**
 * Aggregat-Service fuer den Geraete-Verbindungsstatus (Dashboard-KPI,
 * Sidebar-Badge, Geraete-Liste). Liest live aus dem Edge-Service
 * `device-connections` (verbundene Geraete aus der Socket-Channel-Registry).
 * Haelt online/total/connectedDeviceIds als Signals — Konsumenten reagieren live.
 *
 * `null` = unbekannt (z.B. fehlendes Leserecht → 403): Dashboard zeigt dann „–",
 * Badge wird ausgeblendet. Defensive Catch-Logik: ein Fehler haelt den letzten
 * Stand, der naechste Poll-Tick holt den richtigen Wert nach.
 */
@Injectable({ providedIn: 'root' })
export class DeviceStatusService {
  private api = inject(ApiService)

  readonly online = signal<number | null>(null)
  readonly total = signal<number | null>(null)
  readonly connectedDeviceIds = signal<Set<string>>(new Set())

  async refresh(): Promise<void> {
    try {
      const res = await this.api.getResource<DeviceConnectionStatus>('device-connections')
      this.online.set(typeof res?.online === 'number' ? res.online : null)
      this.total.set(typeof res?.total === 'number' ? res.total : null)
      this.connectedDeviceIds.set(new Set(res?.connectedDeviceIds ?? []))
    } catch {
      // Recht fehlt / Service nicht erreichbar — letzten Stand halten.
    }
  }
}
