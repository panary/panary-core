import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'

type PairingStatus = 'disconnected' | 'pairing' | 'connected' | 'error'

interface CloudConnectionInfo {
  _id: string
  cloudUrl: string
  pairingStatus: PairingStatus
  connectedAt?: string
  lastSyncAt?: string
  syncEnabled: boolean
  errorMessage?: string
  edgeName?: string
  cloudEdgeId?: string
}

const DEFAULT_CLOUD_URL = 'https://cloud.panary.io'

@Component({
  selector: 'app-cloud-connection',
  standalone: true,
  imports: [FormsModule, ConfirmDialogComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-2xl space-y-4 h-full overflow-y-auto">

      <!-- Header -->
      <div>
        <div class="flex items-center justify-between min-h-9">
          <h1 class="text-xl font-bold tracking-tight">{{ 'CLOUD.TITLE' | translate }}</h1>
        </div>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1.5 leading-relaxed">
          {{ 'CLOUD.DESCRIPTION' | translate }}
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center gap-3 py-12 justify-center">
          <span class="w-5 h-5 border-2 border-slate-300 dark:border-gray-600 border-t-slate-900
                       dark:border-t-white rounded-full animate-spin"></span>
          <span class="text-slate-400 dark:text-gray-500 text-sm">{{ 'CLOUD.LOADING_STATUS' | translate }}</span>
        </div>
      } @else {
        @switch (connectionState()) {
          <!-- ============================================ -->
          <!-- DISCONNECTED                                 -->
          <!-- ============================================ -->
          @case ('disconnected') {
            <div class="space-y-6">

              <!-- Visueller Kopplungs-Ablauf -->
              <div class="py-4">
                <p class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-5">
                  {{ 'CLOUD.STEPS_TITLE' | translate }}
                </p>

                <div class="flex items-start gap-0">
                  <!-- Schritt 1 -->
                  <div class="flex-1 flex flex-col items-center text-center">
                    <div class="w-11 h-11 rounded-xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center
                                text-slate-500 dark:text-gray-400 text-lg mb-2.5">
                      ☁
                    </div>
                    <p class="text-xs font-bold text-slate-900 dark:text-white">Cloud-Dashboard</p>
                    <p class="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5 leading-snug max-w-28">
                      "Edge-Server hinzufügen" klicken
                    </p>
                  </div>

                  <!-- Verbindungslinie 1 -->
                  <div class="flex items-center pt-5 px-1">
                    <div class="w-8 h-px bg-slate-200 dark:bg-gray-700"></div>
                    <div class="text-slate-300 dark:text-gray-600 text-xs">›</div>
                    <div class="w-8 h-px bg-slate-200 dark:bg-gray-700"></div>
                  </div>

                  <!-- Schritt 2 -->
                  <div class="flex-1 flex flex-col items-center text-center">
                    <div class="w-11 h-11 rounded-xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center
                                text-slate-500 dark:text-gray-400 text-lg font-bold mb-2.5">
                      #
                    </div>
                    <p class="text-xs font-bold text-slate-900 dark:text-white">Code eingeben</p>
                    <p class="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5 leading-snug max-w-28">
                      6-stelligen Code hier eintragen
                    </p>
                  </div>

                  <!-- Verbindungslinie 2 -->
                  <div class="flex items-center pt-5 px-1">
                    <div class="w-8 h-px bg-slate-200 dark:bg-gray-700"></div>
                    <div class="text-slate-300 dark:text-gray-600 text-xs">›</div>
                    <div class="w-8 h-px bg-slate-200 dark:bg-gray-700"></div>
                  </div>

                  <!-- Schritt 3 -->
                  <div class="flex-1 flex flex-col items-center text-center">
                    <div class="w-11 h-11 rounded-xl bg-green-50 dark:bg-green-950/30 flex items-center justify-center
                                text-green-600 dark:text-green-400 text-lg mb-2.5">
                      ✓
                    </div>
                    <p class="text-xs font-bold text-slate-900 dark:text-white">Verbunden</p>
                    <p class="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5 leading-snug max-w-28">
                      Enterprise-Funktionen aktiv
                    </p>
                  </div>
                </div>
              </div>

              <!-- Formular -->
              <div class="space-y-4">
                <!-- Pairing-Code -->
                <div class="space-y-1.5">
                  <label for="pairingCode" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                    {{ 'CLOUD.PAIRING_CODE' | translate }}
                  </label>
                  <input id="pairingCode" [(ngModel)]="pairingCode" name="pairingCode" type="text"
                    maxlength="6" pattern="[0-9]*" inputmode="numeric"
                    placeholder="000000"
                    class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4
                           text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                           focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none
                           font-mono text-2xl text-center tracking-[0.5em]
                           placeholder-slate-300 dark:placeholder-gray-700" />
                </div>

                <!-- Cloud-URL + Edge-Name in Grid -->
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <label for="cloudUrl" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                      {{ 'CLOUD.CLOUD_URL' | translate }}
                    </label>
                    <input id="cloudUrl" [(ngModel)]="cloudUrl" name="cloudUrl" type="url"
                      class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                             text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                             focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none font-mono text-xs" />
                    <p class="text-slate-400 dark:text-gray-600 text-[10px]">
                      Nur für On-Premise-Installationen ändern
                    </p>
                  </div>
                  <div class="space-y-1">
                    <label for="edgeName" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                      {{ 'CLOUD.EDGE_NAME' | translate }}
                    </label>
                    <input id="edgeName" [(ngModel)]="edgeName" name="edgeName" type="text"
                      placeholder="Wird in der Cloud angezeigt"
                      class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                             text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                             focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none text-sm
                             placeholder-slate-400 dark:placeholder-gray-600" />
                    <p class="text-slate-400 dark:text-gray-600 text-[10px]">
                      Identifiziert diesen Edge-Server
                    </p>
                  </div>
                </div>
              </div>

              <!-- Fehler -->
              @if (errors().length > 0) {
                <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50
                            rounded-lg p-4 space-y-1">
                  @for (err of errors(); track err) {
                    <p class="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
                      <span class="shrink-0 mt-0.5">✕</span>
                      <span>{{ err }}</span>
                    </p>
                  }
                </div>
              }

              <!-- Aktionen -->
              <div class="flex items-center gap-3">
                <button (click)="onPair()" [disabled]="pairing() || pairingCode.length < 6"
                  class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm
                         hover:bg-slate-800 dark:hover:bg-gray-200 transition
                         disabled:opacity-50 disabled:cursor-not-allowed">
                  @if (pairing()) {
                    <span class="inline-flex items-center gap-2">
                      <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      {{ 'CLOUD.CONNECTING' | translate }}
                    </span>
                  } @else {
                    {{ 'CLOUD.PAIR' | translate }}
                  }
                </button>
                <button (click)="onTestConnection()" [disabled]="testing()"
                  class="text-slate-500 dark:text-gray-400 text-sm hover:text-slate-900 dark:hover:text-white transition
                         disabled:opacity-50">
                  @if (testing()) {
                    {{ 'CLOUD.TESTING' | translate }}
                  } @else {
                    {{ 'CLOUD.TEST_CONNECTION' | translate }}
                  }
                </button>

                @if (testResult()) {
                  <span [class]="testResult() === 'ok'
                    ? 'text-green-600 dark:text-green-400 text-xs'
                    : 'text-red-500 dark:text-red-400 text-xs'">
                    @if (testResult() === 'ok') {
                      ✓ {{ 'CLOUD.REACHABLE' | translate }}
                    } @else {
                      ✕ {{ testResult() }}
                    }
                  </span>
                }
              </div>

              <!-- Enterprise-Features Vorschau -->
              <div class="border-t border-slate-200 dark:border-gray-800 pt-6">
                <p class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  {{ 'CLOUD.ENTERPRISE_FEATURES' | translate }}
                </p>
                <div class="grid grid-cols-2 gap-2.5">
                  @for (feature of enterpriseFeatures; track feature.label) {
                    <div class="flex items-start gap-2.5 bg-slate-50 dark:bg-gray-900/50 rounded-lg p-3">
                      <span class="text-base mt-px shrink-0">{{ feature.icon }}</span>
                      <div>
                        <p class="text-xs font-medium text-slate-700 dark:text-gray-200">{{ feature.label }}</p>
                        <p class="text-[10px] text-slate-400 dark:text-gray-500 leading-snug mt-0.5">{{ feature.desc }}</p>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- ============================================ -->
          <!-- CONNECTED                                    -->
          <!-- ============================================ -->
          @case ('connected') {
            <div class="space-y-5">
              <!-- Status-Banner -->
              <div class="flex items-center gap-3 bg-green-50 dark:bg-green-950/20 border border-green-200
                          dark:border-green-900/50 rounded-xl p-4">
                <div class="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                <div>
                  <span class="text-sm text-green-700 dark:text-green-400 font-medium">{{ 'CLOUD.CONNECTED' | translate }}</span>
                  <span class="text-xs text-green-600/70 dark:text-green-400/50 ml-2">{{ 'CLOUD.ENTERPRISE_ACTIVE' | translate }}</span>
                </div>
              </div>

              <!-- Verbindungsdetails -->
              <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800
                          rounded-xl divide-y divide-slate-200 dark:divide-gray-800">
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{ 'CLOUD.CLOUD_URL' | translate }}</span>
                  <span class="text-sm text-slate-900 dark:text-white font-mono">{{ connectionInfo()?.cloudUrl }}</span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{ 'LOCATION.TITLE' | translate }}</span>
                  <span class="text-sm text-slate-900 dark:text-white">{{ connectionInfo()?.edgeName || '—' }}</span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{ 'CLOUD.CONNECTED_SINCE' | translate }}</span>
                  <span class="text-sm text-slate-900 dark:text-white">{{ formatDate(connectionInfo()?.connectedAt) }}</span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{ 'CLOUD.LAST_SYNC' | translate }}</span>
                  <span class="text-sm text-slate-900 dark:text-white">
                    {{ connectionInfo()?.lastSyncAt ? formatDate(connectionInfo()?.lastSyncAt) : ('CLOUD.NOT_SYNCED' | translate) }}
                  </span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Edge-ID</span>
                  <span class="text-sm text-slate-500 dark:text-gray-400 font-mono text-xs">
                    {{ connectionInfo()?.cloudEdgeId || '—' }}
                  </span>
                </div>
              </div>

              <button (click)="confirmingDisconnect.set(true)"
                class="text-red-500 dark:text-red-400 text-sm hover:text-red-700 dark:hover:text-red-300 transition">
                {{ 'CLOUD.DISCONNECT' | translate }}
              </button>
            </div>

            @if (confirmingDisconnect()) {
              <app-confirm-dialog
                [title]="'CLOUD.DISCONNECT_TITLE' | translate"
                [message]="'CLOUD.DISCONNECT_CONFIRM' | translate"
                [confirmLabel]="'CLOUD.DISCONNECT' | translate"
                [dismissLabel]="'COMMON.CANCEL' | translate"
                (confirmed)="onDisconnect()"
                (dismissed)="confirmingDisconnect.set(false)"
                (cancelled)="confirmingDisconnect.set(false)" />
            }
          }

          <!-- ============================================ -->
          <!-- ERROR                                        -->
          <!-- ============================================ -->
          @case ('error') {
            <div class="space-y-5">
              <div class="flex items-center gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200
                          dark:border-red-900/50 rounded-xl p-4">
                <div class="w-3 h-3 rounded-full bg-red-400"></div>
                <div>
                  <span class="text-sm text-red-700 dark:text-red-400 font-medium block">{{ 'CLOUD.CONNECTION_ERROR' | translate }}</span>
                  @if (connectionInfo()?.errorMessage) {
                    <span class="text-xs text-red-500 dark:text-red-400/70">{{ connectionInfo()?.errorMessage }}</span>
                  }
                </div>
              </div>

              <div class="flex gap-3">
                <button (click)="onRetry()"
                  class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm
                         hover:bg-slate-800 dark:hover:bg-gray-200 transition">
                  {{ 'CLOUD.RETRY' | translate }}
                </button>
                <button (click)="onReset()"
                  class="bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                         text-slate-600 dark:text-gray-300 px-6 py-3 rounded-xl text-sm
                         hover:bg-slate-200 dark:hover:bg-gray-800 transition">
                  {{ 'CLOUD.RESET' | translate }}
                </button>
              </div>
            </div>
          }
        }
      }
    </div>
  `,
})
export class CloudConnectionComponent implements OnInit {
  private api = inject(ApiService)
  private cdr = inject(ChangeDetectorRef)

  readonly DEFAULT_CLOUD_URL = DEFAULT_CLOUD_URL

  loading = signal(true)
  connectionState = signal<PairingStatus>('disconnected')
  connectionInfo = signal<CloudConnectionInfo | null>(null)
  pairing = signal(false)
  testing = signal(false)
  testResult = signal<string | null>(null)
  errors = signal<string[]>([])
  confirmingDisconnect = signal(false)

  cloudUrl = DEFAULT_CLOUD_URL
  pairingCode = ''
  edgeName = ''

  readonly enterpriseFeatures = [
    { icon: '⇄', label: 'Echtzeit-Sync', desc: 'Produkte, Bestellungen und Stammdaten automatisch abgleichen' },
    { icon: '◫', label: 'Filial-Reporting', desc: 'Umsätze und KPIs aller Standorte zentral auswerten' },
    { icon: '◉', label: 'Zentrale Verwaltung', desc: 'Benutzer, Produkte und Preise standortübergreifend pflegen' },
    { icon: '⚿', label: 'Remote-Updates', desc: 'Konfigurationen und Menüs aus der Cloud auf alle Kassen verteilen' },
  ]

  formatDate(iso?: string): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  async ngOnInit() {
    await this.loadConnection()
  }

  private async loadConnection() {
    try {
      const result = await this.api.find<CloudConnectionInfo>('cloud-connection', { $limit: 1 })
      if (result.data.length > 0) {
        const conn = result.data[0]
        this.connectionInfo.set(conn)
        this.connectionState.set(conn.pairingStatus)
        this.cloudUrl = conn.cloudUrl || DEFAULT_CLOUD_URL
        this.edgeName = conn.edgeName || ''
      }
    } catch {
      // Kein Eintrag vorhanden = disconnected
    }

    // Standort-Name als Vorschlag laden, falls noch kein Edge-Name gesetzt
    if (!this.edgeName) {
      try {
        const locResult = await this.api.find<{ name: string }>('locations', { $limit: 1 })
        if (locResult.data.length > 0 && locResult.data[0].name) {
          this.edgeName = locResult.data[0].name
        }
      } catch {
        // Standort konnte nicht geladen werden — Feld bleibt leer
      }
    }

    this.loading.set(false)
    this.cdr.markForCheck()
  }

  async onPair() {
    if (this.pairingCode.length < 6) return

    this.pairing.set(true)
    this.errors.set([])
    this.testResult.set(null)

    try {
      const result = await this.api.create<CloudConnectionInfo>('cloud-connection', {
        cloudUrl: this.cloudUrl,
        pairingCode: this.pairingCode,
        edgeName: this.edgeName || undefined,
      } as any)

      this.connectionInfo.set(result)
      this.connectionState.set(result.pairingStatus)
      this.pairingCode = ''
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.pairing.set(false)
    this.cdr.markForCheck()
  }

  async onTestConnection() {
    this.testing.set(true)
    this.testResult.set(null)

    try {
      const url = this.cloudUrl.replace(/\/+$/, '')
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10000) })
      if (response.ok) {
        this.testResult.set('ok')
      } else {
        this.testResult.set(`Server antwortet mit Status ${response.status}`)
      }
    } catch (e: any) {
      this.testResult.set(e.message || 'Server nicht erreichbar')
    }
    this.testing.set(false)
    this.cdr.markForCheck()
  }

  async onDisconnect() {
    this.confirmingDisconnect.set(false)
    const conn = this.connectionInfo()
    if (!conn) return

    try {
      await this.api.remove('cloud-connection', conn._id)
      this.connectionInfo.set(null)
      this.connectionState.set('disconnected')
      this.pairingCode = ''
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.cdr.markForCheck()
  }

  async onRetry() {
    const conn = this.connectionInfo()
    if (conn) {
      await this.api.remove('cloud-connection', conn._id).catch(() => { /* noop */ })
    }
    this.connectionInfo.set(null)
    this.connectionState.set('disconnected')
    this.errors.set([])
    this.cdr.markForCheck()
  }

  async onReset() {
    const conn = this.connectionInfo()
    if (conn) {
      await this.api.remove('cloud-connection', conn._id).catch(() => { /* noop */ })
    }
    this.connectionInfo.set(null)
    this.connectionState.set('disconnected')
    this.cloudUrl = DEFAULT_CLOUD_URL
    this.pairingCode = ''
    this.edgeName = ''
    this.errors.set([])
    this.testResult.set(null)
    this.cdr.markForCheck()
  }
}
