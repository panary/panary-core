import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
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
    TranslateModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-4xl space-y-4 overflow-y-auto h-full">
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
        <!-- Print-Server Steuerung -->
        <app-print-server-controls
          [status]="printServerStatus()"
          (statusChanged)="loadPrintServerStatus()" />

        <!-- Drucker-Liste -->
        <app-printer-list
          [printers]="printers()"
          [saving]="saving()"
          (printersChanged)="onPrintersChanged($event)" />

        <!-- Druckeinstellungen -->
        <app-print-settings-form
          [settings]="printSettings()"
          (settingsChanged)="onPrintSettingsChanged($event)" />

        <!-- MQTT-Konfiguration -->
        <app-mqtt-settings-form
          [settings]="mqttSettings()"
          (settingsChanged)="onMqttSettingsChanged($event)" />

        @if (error()) {
          <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
        }

        @if (saved()) {
          <p class="text-emerald-500 dark:text-emerald-400 text-sm">{{ 'PRINTERS.SETTINGS_SAVED' | translate }}</p>
        }

        <!-- Speichern Button -->
        <div class="flex gap-3 pt-2 pb-8">
          <button (click)="onSave()" [disabled]="saving()"
            class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-8 py-3 rounded-xl text-sm
                   hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50">
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
    mqttServerProtocol: 'mqtt',
    mqttServerUrl: 'localhost',
    mqttServerPort: 1883,
    mqttAutoConnect: false,
  })

  /**
   * Cache der vollständigen Settings aus der DB.
   * Wird in loadData() befüllt und in persistSettings() als Basis verwendet.
   */
  private cachedSettings: Record<string, any> | null = null

  async ngOnInit() {
    await this.loadData()
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
      this.mqttSettings.set({
        mqttServerProtocol: ps.mqttServerProtocol ?? 'mqtt',
        mqttServerUrl: ps.mqttServerUrl ?? 'localhost',
        mqttServerPort: ps.mqttServerPort ?? 1883,
        mqttAutoConnect: ps.mqttAutoConnect ?? false,
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
   */
  async onPrintersChanged(printers: PrinterFormData[]) {
    this.printers.set(printers)
    await this.persistSettings()
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
  private async persistSettings() {
    if (!this.cachedSettings) {
      this.error.set('Settings nicht geladen. Bitte Seite neu laden.')
      return
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
    } catch (err) {
      this.error.set(formatApiError(err))
    } finally {
      this.saving.set(false)
    }
  }
}
