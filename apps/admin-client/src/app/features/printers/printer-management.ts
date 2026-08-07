import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { CloudManagedBannerComponent } from '../../core/cloud-managed-banner'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { EmergencyOverrideService } from '../../core/emergency-override.service'
import { PrinterService, type PrintServerStatus } from './printer.service'
import { PrintServerControlsComponent } from './print-server-controls'
import { PrinterListComponent } from './printer-list'
import { PrintSettingsFormComponent, type PrintSettingsData } from './print-settings-form'
import { MqttSettingsFormComponent, type MqttSettingsData } from './mqtt-settings-form'
import type { PrinterFormData } from './printer-form-dialog'
import { formatApiError } from '../../core/error-helper'

@Component({
  selector: 'app-printer-management',
  standalone: true,
  imports: [
    PrintServerControlsComponent,
    PrinterListComponent,
    PrintSettingsFormComponent,
    MqttSettingsFormComponent,
    CloudManagedBannerComponent,
    TranslateModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-4xl flex flex-col gap-4 overflow-y-auto h-full">
      <div class="flex items-center justify-between min-h-9">
        <h1 class="text-xl font-bold tracking-tight">{{ 'PRINTERS.TITLE' | translate }}</h1>
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (!locationId()) {
        <div class="text-center py-16">
          <p class="text-slate-400 dark:text-gray-500 text-lg">{{ 'LOCATION.NO_LOCATION' | translate }}</p>
        </div>
      } @else {
        <!--
          Drei Zustaende: ungepairt = editierbar / gepairt = gesperrt /
          gepairt + Notfall-Modus = editierbar mit Hinweis. Der Notfall-Modus
          ist die einzige Ausnahme der Cloud-Hoheit (ADR 0001) — Drucker sind
          das einzige Settings-Feld mit akuter Hardware-Abhaengigkeit.
        -->
        @if (emergency()) {
          <app-cloud-managed-banner
            variant="printer-emergency"
            [sinceMin]="emergencySinceMin()"
            [showEndButton]="true"
            (endEmergency)="onEndEmergency()"
          />
        } @else if (locked()) {
          <app-cloud-managed-banner sublineKey="CLOUD_MANAGED.SUBLINE_PRINTERS" />

          @if (canOfferEmergency()) {
            <!--
              Nur wenn die Cloud unerreichbar ist und der Auto-Trigger noch
              nicht gefeuert hat. Schliesst die Luecke im MANUAL-Sync-Modus, wo
              der Heartbeat nur alle 30 min laeuft.
            -->
            <div>
              <button
                type="button"
                (click)="onStartEmergency()"
                [disabled]="switching()"
                class="px-4 py-2 text-sm font-medium rounded-lg border border-orange-300 dark:border-orange-700
                       text-orange-900 dark:text-orange-200 hover:bg-orange-50 dark:hover:bg-orange-900/30
                       transition disabled:opacity-50"
              >
                {{ 'CLOUD_MANAGED.EMERGENCY_START' | translate }}
              </button>
            </div>
          }
        }

        <!-- Print-Server Steuerung -->
        <app-print-server-controls [status]="printServerStatus()" (statusChanged)="loadPrintServerStatus()" />

        <!-- Drucker-Liste -->
        <app-printer-list
          [printers]="printers()"
          [saving]="saving()"
          [readOnly]="locked()"
          (printersChanged)="onPrintersChanged($event)"
        />

        <!-- Druckeinstellungen -->
        <app-print-settings-form
          [settings]="printSettings()"
          [readOnly]="locked()"
          (settingsChanged)="onPrintSettingsChanged($event)"
        />

        <!-- MQTT-Konfiguration -->
        <app-mqtt-settings-form
          [settings]="mqttSettings()"
          [readOnly]="locked()"
          (settingsChanged)="onMqttSettingsChanged($event)"
        />

        @if (error()) {
          <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
        }

        @if (saved()) {
          <p class="text-emerald-500 dark:text-emerald-400 text-sm">{{ 'PRINTERS.SETTINGS_SAVED' | translate }}</p>
        }

        <!-- Speichern Button -->
        <div class="flex gap-3 pt-2 pb-8">
          <button
            (click)="onSave()"
            [disabled]="saving() || locked()"
            class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-8 py-3 rounded-xl text-sm
                   hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50"
          >
            {{ saving() ? ('COMMON.SAVING' | translate) : ('PRINTERS.SAVE_SETTINGS' | translate) }}
          </button>
        </div>
      }
    </div>
  `,
})
export class PrinterManagementComponent implements OnInit {
  private api = inject(ApiService)
  private printerService = inject(PrinterService)
  private cloudManaged = inject(CloudManagedService)
  private emergencyOverride = inject(EmergencyOverrideService)

  /**
   * Gesperrt, wenn die Cloud die Settings verwaltet UND kein Notfall-Modus
   * laeuft. Spiegelt exakt die `isPrinterOnlyPatch`-Whitelist im Backend.
   */
  protected readonly locked = computed(() => !this.cloudManaged.printerWritable())
  protected readonly emergency = this.cloudManaged.printerEmergency
  protected readonly emergencySinceMin = this.cloudManaged.emergencyOverrideSinceMin
  protected readonly canOfferEmergency = this.cloudManaged.canOfferEmergency
  protected readonly switching = signal(false)

  loading = signal(true)
  saving = signal(false)
  saved = signal(false)
  error = signal('')

  locationId = signal<string | null>(null)
  printServerStatus = signal<PrintServerStatus | null>(null)
  printers = signal<PrinterFormData[]>([])
  printSettings = signal<PrintSettingsData>({
    printServerEnabled: true,
    maxNameCharacters: 42,
    separationCharacter: '_',
    separationCharacterCount: 47,
    showDialogAfterOrder: true,
  })
  mqttSettings = signal<MqttSettingsData>({
    mqttServerProtocol: 'ws',
    mqttServerUrl: 'localhost',
    mqttServerPort: 9001,
  })

  /**
   * Cache der vollständigen Settings aus der DB.
   * Wird in loadData() befüllt und in persistSettings() als Basis verwendet.
   */
  private cachedSettings: Record<string, any> | null = null

  async ngOnInit() {
    // Frischen Cloud-Zustand holen, statt auf den nächsten 60-s-Poll zu warten.
    void this.cloudManaged.refresh()
    await this.loadData()
  }

  /** Notausgang aus dem Notfall-Modus (ADR 0001). */
  async onEndEmergency() {
    await this.toggleEmergency(false)
  }

  /**
   * Manuelles Aktivieren — nur angeboten, wenn die Cloud unerreichbar ist und
   * der Auto-Trigger noch nicht gefeuert hat.
   */
  async onStartEmergency() {
    await this.toggleEmergency(true)
  }

  private async toggleEmergency(active: boolean) {
    if (this.switching()) return
    this.switching.set(true)
    this.error.set('')
    try {
      await this.emergencyOverride.setActive(active)
      // Der Sperrzustand haengt an /health — nach dem Refresh im Service ist er
      // aktuell, die Settings selbst muessen aber neu geladen werden, falls die
      // Cloud zwischenzeitlich etwas gepusht hat.
      await this.loadData()
    } catch (err) {
      this.error.set(formatApiError(err))
    } finally {
      this.switching.set(false)
    }
  }

  private async loadData() {
    try {
      const result = await this.api.find<any>('locations', { $limit: 1 })
      const loc = result.data[0]
      if (!loc) {
        this.loading.set(false)
        return
      }

      this.locationId.set(loc._id)
      this.cachedSettings = loc.settings || {}

      const ps = this.cachedSettings!['printSettings'] || {}
      this.printers.set(ps.printers || [])
      this.printSettings.set({
        printServerEnabled: ps.printServerEnabled ?? true,
        maxNameCharacters: ps.maxNameCharacters ?? 42,
        separationCharacter: ps.separationCharacter ?? '_',
        separationCharacterCount: ps.separationCharacterCount ?? 47,
        showDialogAfterOrder: ps.showDialogAfterOrder ?? true,
        backofficePrinter: ps.backofficePrinter,
      })
      // Fallbacks muessen den Schema-Defaults entsprechen (default-settings.ts):
      // 'mqtt' ist kein gueltiger Enum-Wert (nur ws|wss) und 1883 ist der TCP-Port,
      // ueber den der Browser-Client nicht sprechen kann. Mit den alten Werten
      // stand das Select auf keinem Eintrag und ein Speichern lief in 400.
      this.mqttSettings.set({
        mqttServerProtocol: ps.mqttServerProtocol ?? 'ws',
        mqttServerUrl: ps.mqttServerUrl ?? 'localhost',
        mqttServerPort: ps.mqttServerPort ?? 9001,
      })
    } catch (err) {
      this.error.set(formatApiError(err))
    } finally {
      this.loading.set(false)
    }

    await this.loadPrintServerStatus()
  }

  async loadPrintServerStatus() {
    try {
      const status = await this.printerService.getStatus()
      this.printServerStatus.set(status)
    } catch {
      this.printServerStatus.set({ status: 'stopped' })
    }
  }

  /**
   * Drucker-CRUD: Sofort in die DB speichern und Print-Server aktualisieren.
   *
   * Snapshot/Rollback, damit die Liste bei einem fehlgeschlagenen Save nicht
   * einen Stand zeigt, den die DB nicht hat — sonst glaubt der Nutzer, der
   * Drucker sei angelegt, bis er die Seite neu laedt.
   */
  async onPrintersChanged(printers: PrinterFormData[]) {
    const snapshot = this.printers()
    this.printers.set(printers)
    if (!(await this.persistSettings())) {
      this.printers.set(snapshot)
    }
  }

  onPrintSettingsChanged(changes: Partial<PrintSettingsData>) {
    this.printSettings.update(current => ({ ...current, ...changes }))
    this.saved.set(false)
  }

  onMqttSettingsChanged(changes: Partial<MqttSettingsData>) {
    this.mqttSettings.update(current => ({ ...current, ...changes }))
    this.saved.set(false)
  }

  async onSave() {
    await this.persistSettings()
  }

  /**
   * Baut die vollständigen Settings zusammen und patcht die Location.
   * Nutzt cachedSettings als Basis, damit alle Settings-Bereiche
   * (generalSettings, taxSettings, etc.) erhalten bleiben.
   */
  /** @returns `true`, wenn der Patch persistiert wurde. */
  private async persistSettings(): Promise<boolean> {
    // Letzte Verteidigungslinie vor dem Backend — die Kindkomponenten sperren
    // die Eingabe, dieser Guard jeden programmatischen Pfad.
    if (this.locked()) {
      this.error.set('Diese Daten werden in der Cloud verwaltet.')
      return false
    }
    if (!this.cachedSettings) {
      this.error.set('Settings nicht geladen. Bitte Seite neu laden.')
      return false
    }

    this.saving.set(true)
    this.error.set('')
    this.saved.set(false)

    try {
      const updatedPrintSettings = {
        ...this.cachedSettings!['printSettings'],
        ...this.printSettings(),
        ...this.mqttSettings(),
        printers: this.printers(),
        printerSequence: this.printers().map(p => p.pid),
      }

      // Obsolete Felder entfernen, die nicht mehr im Schema sind
      delete updatedPrintSettings.printServerUrl

      const updatedSettings = {
        ...this.cachedSettings,
        printSettings: updatedPrintSettings,
      }

      await this.api.patch('locations', this.locationId()!, { settings: updatedSettings } as any)

      // Cache aktualisieren, damit nachfolgende Saves konsistent bleiben
      this.cachedSettings = updatedSettings
      this.saved.set(true)

      // Print-Server mit aktualisierten Druckern neu starten
      if (this.printServerStatus()?.status === 'running') {
        await this.printerService.restart()
        await this.loadPrintServerStatus()
      }
      return true
    } catch (err) {
      this.error.set(formatApiError(err))
      return false
    } finally {
      this.saving.set(false)
    }
  }
}
