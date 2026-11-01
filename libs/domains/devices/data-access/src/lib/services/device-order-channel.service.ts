import { inject, Injectable, Injector, signal } from '@angular/core'
import { resolveDeviceOrderChannel, type DeviceOrderChannelValue } from '@panary/devices/domain'
import { ConnectionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

const ORDER_CHANNEL_CACHE_KEY = 'pnry_device_order_channel'

interface CachedOrderChannel {
  deviceId: string
  defaultOrderChannel: DeviceOrderChannelValue | null
}

/**
 * Standard-Bestellart des eigenen Terminals (panary/panary-core#1166).
 *
 * **Reine Vorbelegung.** Der Bestelldialog startet mit diesem Kanal, der Umschalter überschreibt ihn
 * je Bestellung; gebucht wird, was der Dialog sendet. Ein manipulierter Cache kann deshalb nichts
 * freischalten, er kann höchstens die Vorbelegung ändern. Schreiben darf den Wert nur der Owner im
 * Admin (Edge-Hook `validateDeviceOrderChannel`); das Terminal hat dafür bewusst keinen Weg.
 *
 * Vorbild ist `DeviceAssignmentService`, nicht `UiScaleService`: Der **Server gewinnt** immer
 * (`refresh()` im Ladepfad des Login-Screens, den jeder Verbindungsaufbau durchläuft), und der Cache gilt nur für die `deviceId`, unter der er
 * geschrieben wurde. Ein Cache eines früheren Pairings wird verworfen.
 */
@Injectable({ providedIn: 'root' })
export class DeviceOrderChannelService {
  #deviceConfigService = inject(DeviceConfigService)
  #injector = inject(Injector)

  readonly #channel = signal<DeviceOrderChannelValue | null>(null)

  /** `null` = kein Standard für dieses Terminal, es gilt der Kanal des Standort-Betriebsmodus. */
  readonly channel = this.#channel.asReadonly()

  #listenerBound = false

  constructor() {
    this.#restoreFromCache()
  }

  /** Lädt den eigenen Device-Record und hängt den Realtime-Listener ein. Idempotent. */
  async refresh(): Promise<void> {
    const config = this.#deviceConfigService.getConfig()
    if (!config?.deviceId) return

    const devicesService = this.#connection().devicesService
    if (!devicesService) return

    const result = (await devicesService.find({ query: { deviceId: config.deviceId, $limit: 1 } })) as
      { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
    const record = (Array.isArray(result) ? result : (result?.data ?? []))[0]
    if (!record) return

    this.#apply(record)
    this.#bindRealtime(config.deviceId)
  }

  /**
   * ⚠️ Der Filter auf die eigene `deviceId` ist Pflicht: Das `devices`-Publish geht an den gesamten
   * Mandanten. Ohne ihn übernähme dieses Terminal den Kanal jedes anderen Geräts.
   */
  #bindRealtime(ownDeviceId: string): void {
    if (this.#listenerBound) return
    const devicesService = this.#connection().devicesService as
      { on?: (event: string, handler: (record: Record<string, unknown>) => void) => void } | undefined
    if (!devicesService?.on) return

    devicesService.on('patched', (record: Record<string, unknown>) => {
      if (record?.['deviceId'] !== ownDeviceId) return
      this.#apply(record)
    })
    this.#listenerBound = true
  }

  #apply(record: Record<string, unknown>): void {
    this.#channel.set(resolveDeviceOrderChannel(record))
    this.#persistCache()
  }

  #restoreFromCache(): void {
    try {
      const raw = localStorage.getItem(ORDER_CHANNEL_CACHE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as CachedOrderChannel
      // Ein Cache vom vorherigen Pairing gehört einem anderen Gerät.
      if (cached.deviceId !== this.#deviceConfigService.getConfig()?.deviceId) {
        localStorage.removeItem(ORDER_CHANNEL_CACHE_KEY)
        return
      }
      this.#channel.set(resolveDeviceOrderChannel(cached))
    } catch {
      // Kaputter Cache ist kein Grund, die Kasse scheitern zu lassen.
    }
  }

  #persistCache(): void {
    const deviceId = this.#deviceConfigService.getConfig()?.deviceId
    if (!deviceId) return
    try {
      const payload: CachedOrderChannel = { deviceId, defaultOrderChannel: this.#channel() }
      localStorage.setItem(ORDER_CHANNEL_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // Speicher voll / privater Modus: der Cache ist optional.
    }
  }

  #connection(): ConnectionService {
    return this.#injector.get(ConnectionService)
  }
}
