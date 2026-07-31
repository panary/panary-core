import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { QRCodeComponent } from 'angularx-qrcode'
import { ApiService } from '../../core/api.service'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { DeviceStatusService } from '../../core/device-status.service'
import { formatApiError } from '../../core/error-helper'

interface Device {
  _id: string
  deviceId: string
  name: string
  type: string
  lastSeen?: string
  active: boolean
}

@Component({
  selector: 'app-device-list',
  standalone: true,
  imports: [TranslateModule, QRCodeComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-4 h-full overflow-y-auto">
      <div class="flex items-center justify-between min-h-9">
        <h1 class="text-xl font-bold tracking-tight">{{ 'DEVICES.TITLE' | translate }}</h1>
        <div class="flex items-center gap-3">
          @if (deviceStatus.online() !== null && deviceStatus.total() !== null) {
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full
                         bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300">
              {{ deviceStatus.online() }} / {{ deviceStatus.total() }} {{ 'DEVICES.CONNECTED' | translate }}
            </span>
          }
          <button (click)="openPairing()"
            class="text-sm font-semibold px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black
                   hover:opacity-90 active:scale-[0.98] transition flex items-center gap-1.5">
            <span class="text-base leading-none">+</span>
            {{ 'DEVICES.PAIR_DEVICE' | translate }}
          </button>
        </div>
      </div>

      @if (actionError()) {
        <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
          <p class="text-red-600 dark:text-red-400 text-sm">{{ actionError() }}</p>
        </div>
      }

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500 text-sm">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (devices().length === 0) {
        <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">{{ 'DEVICES.NO_DEVICES' | translate }}</p>
      } @else {
        <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                         text-xs uppercase tracking-wider">
                <th class="px-3 py-2.5">{{ 'COMMON.NAME' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.TYPE' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.DEVICE_ID' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.LAST_SEEN' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.CONNECTION' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'COMMON.STATUS_ACTIVE' | translate }}</th>
                <th class="px-3 py-2.5 text-right">{{ 'COMMON.ACTIONS' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (device of devices(); track device._id) {
                <tr class="border-b border-slate-200/50 dark:border-gray-800/50 hover:bg-slate-50 dark:hover:bg-gray-800/30 transition">
                  <td class="px-3 py-2.5 font-medium truncate max-w-48">{{ device.name }}</td>
                  <td class="px-3 py-2.5">
                    <span class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                                 text-slate-600 dark:text-gray-300">
                      {{ device.type }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 font-mono text-xs">
                    {{ device.deviceId.slice(0, 8) }}…
                  </td>
                  <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs">
                    {{ device.lastSeen ? formatDate(device.lastSeen) : '—' }}
                  </td>
                  <td class="px-3 py-2.5">
                    @if (isConnected(device.deviceId)) {
                      <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20
                                   dark:bg-green-900/30 dark:text-green-300 dark:ring-green-500/30">
                        <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        {{ 'DEVICES.ONLINE' | translate }}
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-500/20
                                   dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-500/30">
                        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                        {{ 'DEVICES.OFFLINE' | translate }}
                      </span>
                    }
                  </td>
                  <td class="px-3 py-2.5">
                    @if (device.active) {
                      <span class="inline-block w-2 h-2 rounded-full bg-green-400" [title]="'COMMON.STATUS_ACTIVE' | translate"></span>
                    } @else {
                      <span class="inline-block w-2 h-2 rounded-full bg-slate-300 dark:bg-gray-600"></span>
                    }
                  </td>
                  <td class="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" (click)="pendingDelete.set(device)"
                      class="text-xs px-2.5 py-1 rounded-lg text-red-500 dark:text-red-400
                             hover:bg-red-50 dark:hover:bg-red-950/30 transition">
                      {{ 'COMMON.DELETE' | translate }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (pairingOpen()) {
        <!-- Backdrop schliesst per Klick; Tastatur-Pfad laeuft ueber den Schliessen-Button
             im Dialog + (keydown.escape). a11y-Klick-Regeln hier bewusst deaktiviert
             (Repo-Muster: searchable-select, active-orders). -->
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" (click)="closePairing()">
          <!-- Inneres Klick-Stop verhindert Schliessen beim Klick in den Dialog; rein
               visuell, kein eigenes Tastatur-Target noetig. -->
          <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-8 w-full max-w-sm shadow-xl text-center"
               (click)="$event.stopPropagation()">
            <h2 class="text-lg font-bold mb-1">{{ 'DEVICES.PAIRING_TITLE' | translate }}</h2>
            <p class="text-sm text-slate-500 dark:text-gray-400 mb-6">{{ 'DEVICES.PAIRING_HINT' | translate }}</p>

            @if (pairingLoading()) {
              <p class="text-slate-400 dark:text-gray-500 text-sm py-12">{{ 'DEVICES.PAIRING_GENERATING' | translate }}</p>
            } @else if (pairingError()) {
              <p class="text-red-500 text-sm py-10">{{ 'DEVICES.PAIRING_ERROR' | translate }}</p>
            } @else {
              <div class="flex items-center justify-center gap-2 mb-5">
                <span class="text-4xl font-mono font-bold tracking-[0.3em]">{{ pairingCode() }}</span>
                <button type="button" (click)="copyCode()" [title]="'DEVICES.PAIRING_COPY' | translate"
                  [class]="codeCopied()
                    ? 'shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg text-green-600 dark:text-green-400 transition'
                    : 'shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800 transition'">
                  @if (codeCopied()) {
                    <span aria-hidden="true">&#10003;</span> {{ 'DEVICES.PAIRING_COPIED' | translate }}
                  } @else {
                    <span class="material-symbols-outlined" style="font-size: 18px; line-height: 1" aria-hidden="true">
                      content_copy
                    </span>
                  }
                </button>
              </div>
              @if (qrPayload()) {
                <div class="flex justify-center mb-5">
                  <div class="bg-white p-3 rounded-lg">
                    <qrcode [qrdata]="qrPayload()" [width]="180" [errorCorrectionLevel]="'M'" [margin]="2"></qrcode>
                  </div>
                </div>
              }
              <p class="text-xs text-slate-400 dark:text-gray-500 mb-6">{{ 'DEVICES.PAIRING_EXPIRES' | translate }}</p>
            }

            <div class="flex gap-3">
              <button (click)="closePairing()"
                class="flex-1 py-2.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-200 font-medium hover:bg-slate-200 dark:hover:bg-gray-700 transition text-sm">
                {{ 'COMMON.CLOSE' | translate }}
              </button>
              <button (click)="regeneratePairing()" [disabled]="pairingLoading()"
                class="flex-1 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black font-medium hover:opacity-90 transition disabled:opacity-50 text-sm">
                {{ 'DEVICES.PAIRING_REGENERATE' | translate }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (pendingDelete(); as device) {
        <app-confirm-dialog
          [title]="'DEVICES.DELETE_TITLE' | translate"
          [message]="'DEVICES.DELETE_CONFIRM' | translate: { device: device.name }"
          [confirmLabel]="'COMMON.DELETE' | translate"
          [dismissLabel]="'COMMON.CANCEL' | translate"
          (confirmed)="confirmDelete()"
          (dismissed)="pendingDelete.set(null)"
          (cancelled)="pendingDelete.set(null)" />
      }
    </div>
  `,
})
export class DeviceListComponent implements OnInit {
  private api = inject(ApiService)
  private cdr = inject(ChangeDetectorRef)
  protected deviceStatus = inject(DeviceStatusService)

  protected devices = signal<Device[]>([])
  protected loading = signal(true)
  protected pendingDelete = signal<Device | null>(null)
  protected actionError = signal<string | null>(null)

  // --- Geräte-Pairing per Kurz-Code (ruft den öffentlichen Edge-Endpoint via JWT) ---
  protected pairingOpen = signal(false)
  protected pairingLoading = signal(false)
  protected pairingError = signal(false)
  protected pairingCode = signal('')
  protected qrPayload = signal('')
  protected codeCopied = signal(false)

  private dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  protected isConnected(deviceId: string): boolean {
    return this.deviceStatus.connectedDeviceIds().has(deviceId)
  }

  protected formatDate(iso: string): string {
    try {
      return this.dateFormatter.format(new Date(iso))
    } catch {
      return iso
    }
  }

  async ngOnInit() {
    await this.refreshAll()
    this.loading.set(false)
  }

  /**
   * Gemeinsamer Reload-Pfad. `DeviceStatusService` ist providedIn:'root' und
   * speist Tabelle, Sidebar-Badge (NAV.DEVICE_BADGE) und Dashboard-KPI aus
   * denselben Signals — ein Refresh deckt also alle drei ab.
   */
  private async refreshAll(): Promise<void> {
    await Promise.all([this.loadDevices(), this.deviceStatus.refresh()])
    // OnPush + async: loadDevices schluckt Fehler still, dann aendert sich kein
    // Signal. markForCheck ist die billige Absicherung.
    this.cdr.markForCheck()
  }

  private async loadDevices() {
    try {
      const result = await this.api.find<Device>('devices', { $limit: 100, $sort: { name: 1 } })
      this.devices.set(result.data)
    } catch {
      // Recht fehlt / Service nicht erreichbar — leere Liste, Empty-State greift.
    }
  }

  /**
   * Loescht das Geraet. Der zugehoerige API-Schluessel wird serverseitig
   * mitgeloescht (cascade-device-apikeys.hook im api-edge) — der Client muss
   * dafuer nichts tun.
   */
  protected async confirmDelete() {
    const device = this.pendingDelete()
    this.pendingDelete.set(null)
    if (!device) return

    this.actionError.set(null)
    try {
      await this.api.remove('devices', device._id)
    } catch (e: unknown) {
      this.actionError.set(formatApiError(e))
    }
    await this.refreshAll()
  }

  protected async openPairing() {
    this.pairingOpen.set(true)
    await this.generateCode()
  }

  protected closePairing() {
    this.pairingOpen.set(false)
    this.pairingCode.set('')
    this.qrPayload.set('')
    this.pairingError.set(false)
    this.codeCopied.set(false)
    // Waehrend der Dialog offen war, hat sich moeglicherweise ein Geraet
    // gekoppelt. Ohne diesen Refresh musste die Seite manuell neu geladen werden,
    // damit das neue Geraet in Tabelle und Menueleiste auftaucht.
    void this.refreshAll()
  }

  protected async copyCode() {
    try {
      await navigator.clipboard.writeText(this.pairingCode())
      this.codeCopied.set(true)
      setTimeout(() => this.codeCopied.set(false), 3000)
    } catch {
      // Kein Fehler-Banner fuer einen Komfort-Button — der Code ist markierbar.
    }
  }

  protected regeneratePairing() {
    void this.generateCode()
  }

  /**
   * Fordert einen Pairing-Code beim Edge an und baut die QR-Payload {url, code}.
   * Die QR-URL nutzt bevorzugt localIp:port aus /health (die LAN-Adresse, die das
   * POS-Terminal erreichen kann), sonst das aktuelle Origin als Fallback.
   */
  private async generateCode() {
    this.pairingLoading.set(true)
    this.pairingError.set(false)
    this.pairingCode.set('')
    this.qrPayload.set('')
    this.codeCopied.set(false)
    try {
      const res = await this.api.create<{ code: string }>('device-pairing/request-code', {})
      this.pairingCode.set(res.code)
      let url = window.location.origin
      try {
        const health = await this.api.getResource<{ localIp?: string; port?: number }>('health')
        if (health?.localIp && health?.port) {
          url = `http://${health.localIp}:${health.port}`
        }
      } catch {
        // Fallback bleibt window.location.origin
      }
      this.qrPayload.set(JSON.stringify({ url, code: res.code }))
    } catch {
      this.pairingError.set(true)
    } finally {
      this.pairingLoading.set(false)
    }
  }
}
