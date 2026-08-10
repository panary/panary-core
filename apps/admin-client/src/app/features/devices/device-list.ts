import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { QRCodeComponent } from 'angularx-qrcode'
import {
  DeviceAccessMode,
  isDeviceAssigned,
  resolveAssignedUserIds,
  resolveDeviceAccessMode,
  type DeviceAccessModeValue,
} from '@panary/devices/domain'
import { ApiService } from '../../core/api.service'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { DeviceStatusService } from '../../core/device-status.service'
import { formatApiError } from '../../core/error-helper'
import { DeviceAssignmentPickerComponent, type PosUser } from './device-assignment-picker'

interface Device {
  _id: string
  deviceId: string
  name: string
  type: string
  lastSeen?: string
  active: boolean
  locationId?: string
  deviceAccessMode?: DeviceAccessModeValue
  assignedUserIds?: string[]
}

@Component({
  selector: 'app-device-list',
  standalone: true,
  imports: [TranslateModule, QRCodeComponent, ConfirmDialogComponent, DeviceAssignmentPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-4 h-full overflow-y-auto">
      <div class="flex items-center justify-between min-h-9">
        <h1 class="text-xl font-bold tracking-tight">{{ 'DEVICES.TITLE' | translate }}</h1>
        <div class="flex items-center gap-3">
          @if (deviceStatus.online() !== null && deviceStatus.total() !== null) {
            <span
              class="text-xs font-semibold px-2.5 py-1 rounded-full
                         bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300"
            >
              {{ deviceStatus.online() }} / {{ deviceStatus.total() }} {{ 'DEVICES.CONNECTED' | translate }}
            </span>
          }
          <button
            (click)="openPairing()"
            class="text-sm font-semibold px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black
                   hover:opacity-90 active:scale-[0.98] transition flex items-center gap-1.5"
          >
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
        <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">
          {{ 'DEVICES.NO_DEVICES' | translate }}
        </p>
      } @else {
        <div
          class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden"
        >
          <table class="w-full text-sm">
            <thead>
              <tr
                class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                         text-xs uppercase tracking-wider"
              >
                <th class="px-3 py-2.5">{{ 'COMMON.NAME' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.TYPE' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.DEVICE_ID' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.LAST_SEEN' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.CONNECTION' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.ASSIGNMENT' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'COMMON.STATUS_ACTIVE' | translate }}</th>
                <th class="px-3 py-2.5 text-right">{{ 'COMMON.ACTIONS' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (device of devices(); track device._id) {
                <tr
                  class="border-b border-slate-200/50 dark:border-gray-800/50 hover:bg-slate-50 dark:hover:bg-gray-800/30 transition"
                >
                  <td class="px-3 py-2.5 font-medium truncate max-w-48">{{ device.name }}</td>
                  <td class="px-3 py-2.5">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                                 text-slate-600 dark:text-gray-300"
                    >
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
                      <span
                        class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20
                                   dark:bg-green-900/30 dark:text-green-300 dark:ring-green-500/30"
                      >
                        <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        {{ 'DEVICES.ONLINE' | translate }}
                      </span>
                    } @else {
                      <span
                        class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-500/20
                                   dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-500/30"
                      >
                        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                        {{ 'DEVICES.OFFLINE' | translate }}
                      </span>
                    }
                  </td>
                  <td class="px-3 py-2.5">
                    @if (isAssigned(device)) {
                      <span
                        class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-indigo-50 text-indigo-700 ring-indigo-600/20
                                   dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-500/30"
                        [title]="assignedNames(device)"
                      >
                        <span
                          class="material-symbols-outlined"
                          style="font-size: 14px; line-height: 1"
                          aria-hidden="true"
                        >
                          person
                        </span>
                        {{ assignedLabel(device) }}
                      </span>
                    } @else {
                      <span class="text-xs text-slate-400 dark:text-gray-500">
                        {{ 'DEVICES.ASSIGNMENT_SHARED' | translate }}
                      </span>
                    }
                  </td>
                  <td class="px-3 py-2.5">
                    @if (device.active) {
                      <span
                        class="inline-block w-2 h-2 rounded-full bg-green-400"
                        [title]="'COMMON.STATUS_ACTIVE' | translate"
                      ></span>
                    } @else {
                      <span class="inline-block w-2 h-2 rounded-full bg-slate-300 dark:bg-gray-600"></span>
                    }
                  </td>
                  <td class="px-3 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      (click)="openAssignment(device)"
                      class="text-xs px-2.5 py-1 rounded-lg text-slate-500 dark:text-gray-400
                             hover:bg-slate-100 dark:hover:bg-gray-800 transition"
                    >
                      {{ 'DEVICES.ASSIGNMENT_EDIT' | translate }}
                    </button>
                    <button
                      type="button"
                      (click)="pendingDelete.set(device)"
                      class="text-xs px-2.5 py-1 rounded-lg text-red-500 dark:text-red-400
                             hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                    >
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
          <div
            class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-8 w-full max-w-sm shadow-xl text-center"
            (click)="$event.stopPropagation()"
          >
            <h2 class="text-lg font-bold mb-1">{{ 'DEVICES.PAIRING_TITLE' | translate }}</h2>
            <p class="text-sm text-slate-500 dark:text-gray-400 mb-6">{{ 'DEVICES.PAIRING_HINT' | translate }}</p>

            @if (pairingLoading()) {
              <p class="text-slate-400 dark:text-gray-500 text-sm py-12">
                {{ 'DEVICES.PAIRING_GENERATING' | translate }}
              </p>
            } @else if (pairingError()) {
              <p class="text-red-500 text-sm py-10">{{ 'DEVICES.PAIRING_ERROR' | translate }}</p>
            } @else {
              <div class="flex items-center justify-center gap-2 mb-5">
                <span class="text-4xl font-mono font-bold tracking-[0.3em]">{{ pairingCode() }}</span>
                <button
                  type="button"
                  (click)="copyCode()"
                  [title]="'DEVICES.PAIRING_COPY' | translate"
                  [class]="
                    codeCopied()
                      ? 'shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg text-green-600 dark:text-green-400 transition'
                      : 'shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800 transition'
                  "
                >
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

              <!-- Zuweisung VOR dem Code festlegen: Sie reist im Code-Record,
                   nicht im Redeem-Body. Eine Aenderung erzeugt deshalb einen
                   neuen Code — der alte traegt noch die alte Zuweisung. -->
              @if (pairingSupportsAssignment()) {
                <div class="border-t border-slate-200 dark:border-gray-800 pt-5 mb-2">
                  <app-device-assignment-picker
                    [users]="posUsers()"
                    [mode]="pairingMode()"
                    [selected]="pairingSelected()"
                    (modeChange)="onPairingModeChange($event)"
                    (selectedChange)="onPairingSelectionChange($event)"
                  />
                  @if (pairingAssignmentDirty()) {
                    <button
                      type="button"
                      (click)="regeneratePairing()"
                      [disabled]="pairingLoading() || !pairingSelectionValid()"
                      class="w-full mt-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium
                             hover:opacity-90 transition disabled:opacity-50"
                    >
                      {{ 'DEVICES.ASSIGNMENT_APPLY_TO_CODE' | translate }}
                    </button>
                  }
                </div>
              }
            }

            <div class="flex gap-3">
              <button
                (click)="closePairing()"
                class="flex-1 py-2.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-200 font-medium hover:bg-slate-200 dark:hover:bg-gray-700 transition text-sm"
              >
                {{ 'COMMON.CLOSE' | translate }}
              </button>
              <button
                (click)="regeneratePairing()"
                [disabled]="pairingLoading()"
                class="flex-1 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black font-medium hover:opacity-90 transition disabled:opacity-50 text-sm"
              >
                {{ 'DEVICES.PAIRING_REGENERATE' | translate }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (assignTarget(); as device) {
        <!-- Gleicher Aufbau wie das Pairing-Modal (Backdrop schliesst, innerer
             Klick-Stop). a11y-Klick-Regeln bewusst deaktiviert — Repo-Muster. -->
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" (click)="closeAssignment()">
          <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          <div
            class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-8 w-full max-w-md shadow-xl"
            (click)="$event.stopPropagation()"
          >
            <h2 class="text-lg font-bold mb-1">{{ 'DEVICES.ASSIGNMENT_TITLE' | translate }}</h2>
            <p class="text-sm text-slate-500 dark:text-gray-400 mb-6">{{ device.name }}</p>

            <app-device-assignment-picker
              [users]="posUsers()"
              [mode]="assignMode()"
              [selected]="assignSelected()"
              (modeChange)="assignMode.set($event)"
              (selectedChange)="assignSelected.set($event)"
            />

            @if (lastSharedTerminal()) {
              <!-- Beratend, keine Sperre: Das Personalnummer-Stempel-Panel ist
                   nur auf geteilten Geraeten sichtbar. Wird das letzte davon
                   zugewiesen, hat der Standort keine Stempel-Station mehr. -->
              <div
                class="mt-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3"
              >
                <p class="text-xs text-amber-700 dark:text-amber-300">
                  {{ 'DEVICES.ASSIGNMENT_LAST_SHARED_WARNING' | translate }}
                </p>
              </div>
            }

            @if (assignError()) {
              <p class="mt-4 text-sm text-red-500">{{ assignError() }}</p>
            }

            <div class="flex gap-3 mt-6">
              <button
                (click)="closeAssignment()"
                class="flex-1 py-2.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-200 font-medium hover:bg-slate-200 dark:hover:bg-gray-700 transition text-sm"
              >
                {{ 'COMMON.CANCEL' | translate }}
              </button>
              <button
                (click)="saveAssignment()"
                [disabled]="assignSaving() || !assignSelectionValid()"
                class="flex-1 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black font-medium hover:opacity-90 transition disabled:opacity-50 text-sm"
              >
                {{ 'COMMON.SAVE' | translate }}
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
          (cancelled)="pendingDelete.set(null)"
        />
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

  // Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001). Dieser Admin ist der
  // wichtigere der beiden: Gepairte POS-Geraete leben in der Edge-SQLite und
  // werden nicht in die Cloud gesynct — im lokalen Hub-Betrieb ist das hier der
  // einzige Ort, an dem sich eine Zuweisung pflegen laesst.
  protected posUsers = signal<PosUser[]>([])
  protected assignTarget = signal<Device | null>(null)
  protected assignMode = signal<DeviceAccessModeValue>(DeviceAccessMode.SHARED)
  protected assignSelected = signal<string[]>([])
  protected assignSaving = signal(false)
  protected assignError = signal<string | null>(null)

  /** Zuweisung, die ein per Pairing-Code angelegtes Geraet bekommen soll. */
  protected pairingMode = signal<DeviceAccessModeValue>(DeviceAccessMode.SHARED)
  protected pairingSelected = signal<string[]>([])
  /** Zuweisung im Dialog geaendert, aber noch kein neuer Code dafuer geholt. */
  protected pairingAssignmentDirty = signal(false)
  /**
   * Faehigkeits-Sonde: Ein aelterer Edge kennt die Zuweisung nicht und echot
   * `deviceAccessMode` in der `request-code`-Antwort folglich nicht. Dann wird
   * der Picker ausgeblendet, statt eine Auswahl anzubieten, die beim Redeem
   * stillschweigend verloren ginge.
   */
  protected pairingSupportsAssignment = signal(true)

  /** `assigned` ohne Mitarbeiter waere ein Geraet, an dem sich niemand anmelden kann. */
  private selectionValid = (mode: DeviceAccessModeValue, selected: string[]): boolean =>
    mode !== DeviceAccessMode.ASSIGNED || selected.length > 0

  protected assignSelectionValid = computed(() => this.selectionValid(this.assignMode(), this.assignSelected()))
  protected pairingSelectionValid = computed(() => this.selectionValid(this.pairingMode(), this.pairingSelected()))

  /**
   * True, wenn das gerade bearbeitete Geraet das letzte `shared`-Terminal seines
   * Standorts ist und zugewiesen werden soll. Beratend, keine Sperre — aber ohne
   * ein geteiltes Terminal hat der Standort keine Stempel-Station mehr, weil das
   * Personalnummer-Panel nur dort erscheint.
   */
  protected lastSharedTerminal = computed(() => {
    const target = this.assignTarget()
    if (!target || this.assignMode() !== DeviceAccessMode.ASSIGNED) return false
    if (isDeviceAssigned(target)) return false // war schon zugewiesen, aendert nichts

    return !this.devices().some(
      device =>
        device._id !== target._id && device.active && !isDeviceAssigned(device) && this.sameLocation(device, target),
    )
  })

  private sameLocation(a: Device, b: Device): boolean {
    // Ohne locationId (aeltere Edge-Antwort) lieber zusammenfassen als die
    // Warnung faelschlich zu unterdruecken.
    return !a.locationId || !b.locationId || a.locationId === b.locationId
  }

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
    await Promise.all([this.loadDevices(), this.loadPosUsers(), this.deviceStatus.refresh()])
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

  private async loadPosUsers() {
    try {
      const result = await this.api.find<PosUser>('users', {
        isPosUser: true,
        status: 'ACTIVE',
        $limit: 200,
        $sort: { firstName: 1 },
      })
      this.posUsers.set(result.data)
    } catch {
      // Recht fehlt / Service nicht erreichbar — der Picker zeigt seinen
      // Leer-Hinweis, die Zuweisung bleibt unbedienbar statt halb bedienbar.
    }
  }

  //#region Zuweisung
  protected isAssigned(device: Device): boolean {
    return isDeviceAssigned(device)
  }

  protected assignedLabel(device: Device): string {
    const ids = resolveAssignedUserIds(device)
    if (ids.length === 1) return this.userName(ids[0])
    return `${ids.length}`
  }

  /** Volle Namensliste als Tooltip — die Spalte selbst bleibt schmal. */
  protected assignedNames(device: Device): string {
    return resolveAssignedUserIds(device)
      .map(id => this.userName(id))
      .join(', ')
  }

  private userName(id: string): string {
    const user = this.posUsers().find(entry => entry._id === id)
    if (!user) return id
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || id
  }

  protected openAssignment(device: Device) {
    this.assignTarget.set(device)
    this.assignMode.set(resolveDeviceAccessMode(device))
    this.assignSelected.set(resolveAssignedUserIds(device))
    this.assignError.set(null)
  }

  protected closeAssignment() {
    this.assignTarget.set(null)
    this.assignError.set(null)
  }

  protected async saveAssignment() {
    const device = this.assignTarget()
    if (!device || !this.assignSelectionValid()) return

    this.assignSaving.set(true)
    this.assignError.set(null)
    try {
      const assigned = this.assignMode() === DeviceAccessMode.ASSIGNED
      await this.api.patch<Device>('devices', device._id, {
        deviceAccessMode: this.assignMode(),
        // Beim Zurueckschalten auf `shared` die Liste mitleeren: Eine
        // stehengebliebene Liste wuerde beim naechsten Blick in die DB wie eine
        // aktive Zuweisung aussehen.
        assignedUserIds: assigned ? this.assignSelected() : [],
      })
      this.assignTarget.set(null)
      await this.refreshAll()
    } catch (e: unknown) {
      this.assignError.set(formatApiError(e))
    } finally {
      this.assignSaving.set(false)
    }
  }

  protected onPairingModeChange(mode: DeviceAccessModeValue) {
    this.pairingMode.set(mode)
    if (mode === DeviceAccessMode.SHARED) this.pairingSelected.set([])
    this.pairingAssignmentDirty.set(true)
  }

  protected onPairingSelectionChange(selected: string[]) {
    this.pairingSelected.set(selected)
    this.pairingAssignmentDirty.set(true)
  }
  //#endregion

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
    this.pairingMode.set(DeviceAccessMode.SHARED)
    this.pairingSelected.set([])
    this.pairingAssignmentDirty.set(false)
    await this.generateCode()
  }

  protected closePairing() {
    this.pairingOpen.set(false)
    this.pairingCode.set('')
    this.qrPayload.set('')
    this.pairingError.set(false)
    this.codeCopied.set(false)
    this.pairingAssignmentDirty.set(false)
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
   *
   * Die Zuweisung geht MIT dem Code-Request raus, nicht spaeter beim Redeem —
   * sie reist im Code-Record. Die QR-Payload bleibt deshalb unveraendert
   * `{url, code}`: Das Terminal braucht nichts davon zu wissen.
   */
  private async generateCode() {
    this.pairingLoading.set(true)
    this.pairingError.set(false)
    this.pairingCode.set('')
    this.qrPayload.set('')
    this.codeCopied.set(false)
    try {
      const assigned = this.pairingMode() === DeviceAccessMode.ASSIGNED
      const body: Record<string, unknown> = assigned
        ? { deviceAccessMode: DeviceAccessMode.ASSIGNED, assignedUserIds: this.pairingSelected() }
        : {}
      const res = await this.api.create<{ code: string; deviceAccessMode?: string }>(
        'device-pairing/request-code',
        body as never,
      )
      // Faehigkeits-Sonde (siehe pairingSupportsAssignment): fehlendes Echo =
      // Edge ohne Zuweisungs-Unterstuetzung.
      this.pairingSupportsAssignment.set(res.deviceAccessMode !== undefined)
      this.pairingAssignmentDirty.set(false)
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
