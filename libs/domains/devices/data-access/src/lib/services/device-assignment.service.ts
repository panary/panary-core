import { computed, inject, Injectable, Injector, signal } from '@angular/core'
import {
  DeviceAccessMode,
  resolveAssignedUserIds,
  resolveDeviceAccessMode,
  type DeviceAccessModeValue,
} from '@panary/devices/domain'
import { ConnectionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

const ASSIGNMENT_CACHE_KEY = 'pnry_device_assignment'

interface CachedAssignment {
  deviceId: string
  deviceAccessMode?: DeviceAccessModeValue
  assignedUserIds?: string[]
}

/**
 * Zuweisungs-Zustand des eigenen Terminals (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
 *
 * **Reine Anzeige-Quelle.** Die Durchsetzung sitzt am Edge
 * (`userQueryResolver`, `verifyPin`); dieser Service bestimmt nur, wie der
 * Login-Screen aussieht. Ein manipulierter localStorage-Cache kann deshalb
 * nichts freischalten — er kann den Screen hoechstens falsch aussehen lassen,
 * bis der Server-Wert da ist.
 *
 * Muster analog `UiScaleService`: `ConnectionService` bewusst per Injector statt
 * im Konstruktor, damit im Environment-Init keine harte Abhaengigkeit entsteht.
 */
@Injectable({ providedIn: 'root' })
export class DeviceAssignmentService {
  #deviceConfigService = inject(DeviceConfigService)
  #injector = inject(Injector)

  readonly #accessMode = signal<DeviceAccessModeValue>(DeviceAccessMode.SHARED)
  readonly #assignedUserIds = signal<string[]>([])
  readonly #loaded = signal(false)

  readonly accessMode = this.#accessMode.asReadonly()
  readonly assignedUserIds = this.#assignedUserIds.asReadonly()
  /** true, sobald ein Server-Wert vorlag — der Cache allein zaehlt nicht. */
  readonly loaded = this.#loaded.asReadonly()

  readonly isAssigned = computed(() => this.#accessMode() === DeviceAccessMode.ASSIGNED)
  readonly isShared = computed(() => !this.isAssigned())

  /** _id des eigenen Device-Records — einmal aufgeloest, dann gecached. */
  #deviceRecordId: string | null = null
  #listenerBound = false

  constructor() {
    this.#restoreFromCache()
  }

  /**
   * Laedt den eigenen Device-Record und haengt den Realtime-Listener ein.
   * Idempotent — der Login-Screen ruft das bei jedem Verbindungsaufbau.
   */
  async refresh(): Promise<void> {
    const config = this.#deviceConfigService.getConfig()
    if (!config?.deviceId) return

    const devicesService = this.#connection().devicesService
    if (!devicesService) return

    const result = (await devicesService.find({ query: { deviceId: config.deviceId, $limit: 1 } })) as
      { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
    const record = (Array.isArray(result) ? result : (result?.data ?? []))[0]
    if (!record) return

    this.#deviceRecordId = (record['_id'] as string | undefined) ?? null
    this.#apply(record)
    this.#loaded.set(true)
    this.#bindRealtime(config.deviceId)
  }

  /**
   * Realtime: Eine Zuweisungs-Aenderung im Admin soll am offenen Login-Screen
   * ankommen, ohne dass jemand das Terminal neu startet.
   *
   * ⚠️ Der Filter auf die eigene `deviceId` ist Pflicht, kein Feinschliff: Das
   * `devices`-Publish in `channels.ts` geht an den **gesamten Mandanten**. Ohne
   * ihn uebernaehme dieses Terminal die Zuweisung jedes anderen Geraets — und
   * zwar genau in dem Moment, in dem irgendwo im Betrieb ein Geraet gepatcht
   * wird.
   */
  #bindRealtime(ownDeviceId: string): void {
    if (this.#listenerBound) return
    const devicesService = this.#connection().devicesService as
      { on?: (event: string, handler: (record: Record<string, unknown>) => void) => void } | undefined
    if (!devicesService?.on) return

    devicesService.on('patched', (record: Record<string, unknown>) => {
      if (record?.['deviceId'] !== ownDeviceId) return
      this.#apply(record)
      this.#loaded.set(true)
    })
    this.#listenerBound = true
  }

  #apply(record: Record<string, unknown>): void {
    this.#accessMode.set(resolveDeviceAccessMode(record))
    this.#assignedUserIds.set(resolveAssignedUserIds(record))
    this.#persistCache()
  }

  /**
   * localStorage ist hier **nur Anzeige-Cache**: Er verhindert, dass der
   * Login-Screen beim Kaltstart kurz die geteilte Ansicht zeigt, bevor der
   * Server-Wert da ist. Er entscheidet nichts — deshalb auch kein Schema-Check
   * ueber `resolve*` hinaus.
   */
  #restoreFromCache(): void {
    try {
      const raw = localStorage.getItem(ASSIGNMENT_CACHE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as CachedAssignment
      // Ein Cache vom vorherigen Pairing gehoert einem anderen Geraet.
      if (cached.deviceId !== this.#deviceConfigService.getConfig()?.deviceId) {
        localStorage.removeItem(ASSIGNMENT_CACHE_KEY)
        return
      }
      this.#accessMode.set(resolveDeviceAccessMode(cached))
      this.#assignedUserIds.set(resolveAssignedUserIds(cached))
    } catch {
      // Kaputter Cache ist kein Grund, den Login-Screen scheitern zu lassen.
    }
  }

  #persistCache(): void {
    const deviceId = this.#deviceConfigService.getConfig()?.deviceId
    if (!deviceId) return
    try {
      const payload: CachedAssignment = {
        deviceId,
        deviceAccessMode: this.#accessMode(),
        assignedUserIds: this.#assignedUserIds(),
      }
      localStorage.setItem(ASSIGNMENT_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // Speicher voll / privater Modus — der Cache ist optional.
    }
  }

  #connection(): ConnectionService {
    return this.#injector.get(ConnectionService)
  }

  /** Nur fuer Diagnose/Tests: der aufgeloeste Record. */
  get deviceRecordId(): string | null {
    return this.#deviceRecordId
  }
}
