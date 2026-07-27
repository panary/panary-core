import { computed, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core'
import { DEFAULT_UI_DENSITY_FACTORS, UiDensity, type UiDensityLevel } from '@panary/devices/domain'
import { ConnectionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

// Persistenz-Schluessel: lokales Terminal-Flag + gewaehlte Dichte. panary-core
// hat KEINE Feature-Flag-Infrastruktur — das localStorage-Flag IST hier der
// Mechanismus (Default off, Opt-in pro Terminal in den POS-Einstellungen).
const UI_SCALE_STORAGE_KEY = 'pnry_ui_scale'
const UI_SCALE_FLAG_KEY = 'pnry_feature.pos-fluid-ui-scaling-v1'

const FLUID_SCALE_CLASS = 'pnry-fluid-scale'
const DENSITY_PROPERTY = '--pnry-density'

interface StoredUiScale {
  density: UiDensityLevel
  factors?: Partial<Record<UiDensityLevel, number>>
}

const isDensityLevel = (value: unknown): value is UiDensityLevel =>
  typeof value === 'string' && (Object.values(UiDensity) as string[]).includes(value)

/**
 * Fluide UI-Skalierung des POS-Terminals (PNRY-FEAT-POS-UI-SCALE-001).
 *
 * Muster analog ThemeServiceService: synchrones localStorage-Read im
 * Konstruktor + sofortige Anwendung — kein Flash of Wrong Scale. Die
 * Anwendung besteht bewusst NUR aus zwei DOM-Operationen (Klasse
 * `pnry-fluid-scale` auf <html> + Custom-Property `--pnry-density`) — kein
 * Komponenten-Re-Render, damit die Live-Vorschau auch auf Sunmi-Hardware
 * fluessig bleibt (Fundament: apps/pos-client/src/styles.scss).
 *
 * Persistenz: localStorage ist die Quelle der Wahrheit fuers Terminal. Der
 * eigene Device-Datensatz (devices.uiScale) wird best-effort gespiegelt —
 * offline darf nie brechen. Boot-Reconcile: lokaler Wert gewinnt und wird
 * bei Abweichung zurueckgeschrieben; existiert lokal nichts, wird der
 * Server-Wert uebernommen.
 */
@Injectable({
  providedIn: 'root',
})
export class UiScaleService {
  #deviceConfigService = inject(DeviceConfigService)
  // ConnectionService bewusst nicht im Konstruktor injizieren: keine harte
  // Abhaengigkeit im Environment-Init. Der erste Zugriff passiert fruehestens
  // im Boot-Reconcile — und der ist per queueMicrotask vom synchronen
  // Initializer-Pfad entkoppelt (siehe Konstruktor).
  #injector = inject(Injector)

  readonly #enabled = signal<boolean>(false)
  readonly #density = signal<UiDensityLevel>(UiDensity.DEFAULT)
  readonly #factors = signal<Partial<Record<UiDensityLevel, number>> | undefined>(undefined)

  readonly enabled = this.#enabled.asReadonly()
  readonly density = this.#density.asReadonly()
  // Clamp auf die Schema-Grenzen (0.5–2): das Backend validiert nur den
  // Device-Record — ein manipulierter localStorage-Wert darf das Terminal
  // nicht mit --pnry-density: 100 unbedienbar machen.
  readonly factor = computed(() => {
    const raw = this.#factors()?.[this.#density()] ?? DEFAULT_UI_DENSITY_FACTORS[this.#density()]
    return Math.min(2, Math.max(0.5, raw))
  })

  // _id des eigenen Device-Datensatzes (via find ueber deviceId ermittelt) —
  // gecacht, damit nicht jeder setDensity-Aufruf einen find ausloest.
  #deviceRecordId: string | null = null
  #reconciled = false

  constructor() {
    // Synchron aus localStorage lesen und sofort anwenden — kein Flash
    this.#enabled.set(this.#readFlag())
    const stored = this.#readStoredScale()
    if (stored) {
      this.#density.set(stored.density)
      this.#factors.set(stored.factors)
    }
    this.#apply(this.#enabled(), this.factor())

    // Live-Anwendung bei Signal-Aenderung. DOM-Ops in untracked — sie lesen
    // keine weiteren Signals, defensiv gegen kuenftige Erweiterungen
    // (.claude/rules/angular.md §2.1).
    effect(() => {
      const enabled = this.enabled()
      const factor = this.factor()
      untracked(() => this.#apply(enabled, factor))
    })

    // Boot-Reconcile mit dem Device-Record — async, liest/schreibt Signals →
    // untracked-Pflicht (angular.md §2.1). Best-effort: offline/nicht
    // verbunden ist kein Fehler, naechster setDensity versucht es erneut.
    // Via queueMicrotask vom synchronen Initializer-Pfad entkoppelt, damit
    // die ConnectionService-Instanziierung (erster Zugriff in
    // #resolveDeviceRecordId) nicht mitten im Environment-Init passiert.
    queueMicrotask(() => untracked(() => void this.#reconcileWithDeviceRecord()))
  }

  setEnabled(enabled: boolean): void {
    this.#enabled.set(enabled)
    try {
      localStorage.setItem(UI_SCALE_FLAG_KEY, enabled ? 'on' : 'off')
    } catch {
      // localStorage nicht verfuegbar — Anwendung bleibt fuer die Session aktiv
    }
  }

  setDensity(level: UiDensityLevel): void {
    this.#density.set(level)
    this.#persistLocal()
    // Best-Effort-Spiegelung in den eigenen Device-Record — nie blockierend.
    void this.#persistRemote()
  }

  /** Nur die zwei DOM-Operationen — Aktivierung laut Fundament in styles.scss. */
  #apply(enabled: boolean, factor: number): void {
    const root = document.documentElement
    if (enabled) {
      root.classList.add(FLUID_SCALE_CLASS)
      root.style.setProperty(DENSITY_PROPERTY, String(factor))
    } else {
      root.classList.remove(FLUID_SCALE_CLASS)
      root.style.removeProperty(DENSITY_PROPERTY)
    }
  }

  #readFlag(): boolean {
    try {
      return localStorage.getItem(UI_SCALE_FLAG_KEY) === 'on'
    } catch {
      return false
    }
  }

  #readStoredScale(): StoredUiScale | null {
    try {
      const raw = localStorage.getItem(UI_SCALE_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<StoredUiScale>
      if (!isDensityLevel(parsed?.density)) return null
      return { density: parsed.density, factors: parsed.factors }
    } catch {
      return null
    }
  }

  #persistLocal(): void {
    try {
      const value: StoredUiScale = { density: this.#density() }
      const factors = this.#factors()
      if (factors) value.factors = factors
      localStorage.setItem(UI_SCALE_STORAGE_KEY, JSON.stringify(value))
    } catch {
      // localStorage nicht verfuegbar — Terminal verliert die Wahl beim Reload
    }
  }

  /** Eigenen Device-Record patchen (uiScale) — try/catch, offline bricht nie. */
  async #persistRemote(): Promise<void> {
    try {
      const recordId = await this.#resolveDeviceRecordId()
      if (!recordId) return
      const uiScale: StoredUiScale = { density: this.#density() }
      const factors = this.#factors()
      if (factors) uiScale.factors = factors
      await this.#connection().devicesService.patch(recordId, { uiScale })
    } catch (err) {
      console.warn('[UiScale] Device-Record-Patch fehlgeschlagen (offline?):', err)
    }
  }

  /**
   * Boot-Abgleich: lokaler Wert gewinnt und wird bei Abweichung
   * zurueckgeschrieben; existiert lokal NICHTS, wird der Server-Wert
   * uebernommen (localStorage + Signals).
   */
  async #reconcileWithDeviceRecord(): Promise<void> {
    if (this.#reconciled) return
    try {
      const config = this.#deviceConfigService.getConfig()
      if (!config?.deviceId) return

      const recordId = await this.#resolveDeviceRecordId()
      if (!recordId) return

      const record = (await this.#connection().devicesService.get(recordId)) as {
        uiScale?: StoredUiScale
      }
      const remote = record?.uiScale
      const local = this.#readStoredScale()

      if (local) {
        // Lokal gewinnt — bei Abweichung zurueckschreiben.
        if (!remote || remote.density !== local.density || JSON.stringify(remote) !== JSON.stringify(local)) {
          await this.#persistRemote()
        }
      } else if (remote && isDensityLevel(remote.density)) {
        this.#density.set(remote.density)
        this.#factors.set(remote.factors)
        this.#persistLocal()
      }
      this.#reconciled = true
    } catch (err) {
      console.warn('[UiScale] Boot-Reconcile uebersprungen (offline?):', err)
    }
  }

  /** _id des eigenen Device-Records via deviceId ermitteln und cachen. */
  async #resolveDeviceRecordId(): Promise<string | null> {
    if (this.#deviceRecordId) return this.#deviceRecordId
    const config = this.#deviceConfigService.getConfig()
    if (!config?.deviceId) return null

    const result = (await this.#connection().devicesService.find({
      query: { deviceId: config.deviceId, $limit: 1 },
    })) as { data?: Array<{ _id?: string }> } | Array<{ _id?: string }>
    const records = Array.isArray(result) ? result : (result?.data ?? [])
    this.#deviceRecordId = records[0]?._id ?? null
    return this.#deviceRecordId
  }

  #connection(): ConnectionService {
    return this.#injector.get(ConnectionService)
  }
}
