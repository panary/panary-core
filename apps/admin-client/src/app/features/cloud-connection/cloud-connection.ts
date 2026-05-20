import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { SyncHistoryComponent } from './sync-history'
import { BootstrapReportsComponent } from './bootstrap-reports'

type PairingStatus = 'disconnected' | 'pairing' | 'connected' | 'error'

type InitialDirection = 'bootstrap-edge-to-cloud' | 'pull-cloud-to-edge' | 'merge-by-external-id'

type BootstrapStatus = 'idle' | 'in-progress' | 'done' | 'failed'

type SyncMode = 'auto' | 'scheduled' | 'manual' | 'disabled'

type WizardStep = 'input' | 'preflight-result' | 'user-selection' | 'progress'

// Tabs sind nur im Connected-State sichtbar — der Wizard belegt im
// Disconnected-/Pairing-/Error-State den ganzen Bildschirm. URL-Query-Param
// `?tab=history` aktiviert direkt den History-Tab (Deep-Linking).
type ConnectionTab = 'connection' | 'history' | 'reports'

interface EdgeUserOption {
  _id: string
  loginname: string
  firstName?: string
  lastName?: string
  email?: string
  role: string
  blocked: boolean
  blockedReason?: string
}

// Cloud blockiert diese Rollen serverseitig im Edge→Cloud-Push und der
// Edge-Bootstrap-Runner filtert sie zusaetzlich vor dem Push (Defense in
// Depth). Im UI deaktivieren wir die Auswahl, um dem Admin zu signalisieren,
// dass diese User ohnehin nicht synchronisiert werden — gleiche Liste wie
// `SYNC_PUSH_BLOCKED_USER_ROLES` in @panary/users/domain.
const isCloudManagedRole = (role: string): boolean => {
  // platform:*-Praefix faengt auch zukuenftige Subrollen mit ab.
  if (role.startsWith('platform:')) return true
  return role === 'tenant:owner'
}

interface MasterDataInventory {
  products: number
  productGroups: number
  users: number
  corporateCustomers: number
  customers: number
}

interface PreflightSnapshot {
  cloudTenantId: string
  cloudTenantName: string
  cloudLocationId?: string
  cloudInventory: MasterDataInventory
  edgeInventory: MasterDataInventory
  suggestedDirection: InitialDirection
  requiresTenantIdRestamp: boolean
}

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
  initialDirection?: InitialDirection
  bootstrapStatus?: BootstrapStatus
  bootstrapError?: string
  preflightSnapshot?: PreflightSnapshot
  syncMode?: SyncMode
  syncIntervalSec?: number
  lastClockSkewMs?: number
}

interface PreflightResult {
  cloudTenantId: string
  cloudTenantName: string
  cloudLocationId?: string
  cloudInventory: MasterDataInventory
  edgeInventory: MasterDataInventory
  suggestedDirection: InitialDirection
  requiresTenantIdRestamp: boolean
}

const DEFAULT_CLOUD_URL = 'https://cloud.panary.io'
const SYNC_MODE_OPTIONS: { value: SyncMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Automatisch', description: 'Sync laeuft regelmaessig im Hintergrund' },
  { value: 'scheduled', label: 'Zeitplan', description: 'Sync zu festen Uhrzeiten (z. B. nach Feierabend)' },
  { value: 'manual', label: 'Nur manuell', description: 'Sync nur auf Knopfdruck' },
  { value: 'disabled', label: 'Deaktiviert', description: 'Kein Sync — Edge sammelt nur lokal' },
]

const directionLabel = (dir: InitialDirection): string => {
  switch (dir) {
    case 'bootstrap-edge-to-cloud':
      return 'Lokale Daten in die Cloud schieben'
    case 'pull-cloud-to-edge':
      return 'Cloud-Daten lokal uebernehmen (lokale Daten gehen verloren)'
    case 'merge-by-external-id':
      return 'Per externalId zusammenfuehren — Konflikte werden im Edge-Admin geprueft'
  }
}

@Component({
  selector: 'app-cloud-connection',
  standalone: true,
  imports: [FormsModule, RouterLink, ConfirmDialogComponent, TranslateModule, SyncHistoryComponent, BootstrapReportsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-3xl space-y-4 h-full overflow-y-auto">
      <div>
        <h1 class="text-xl font-bold tracking-tight">{{ 'CLOUD.TITLE' | translate }}</h1>
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
          <!-- DISCONNECTED — Wizard-Flow -->
          @case ('disconnected') {
            @switch (wizardStep()) {
              @case ('input') {
                <div class="space-y-5">
                  <div class="space-y-1.5">
                    <label for="pairingCode" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                      {{ 'CLOUD.PAIRING_CODE' | translate }}
                    </label>
                    <input id="pairingCode" [(ngModel)]="pairingCode" name="pairingCode" type="text"
                      maxlength="6" pattern="[0-9]*" inputmode="numeric" placeholder="000000"
                      class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4
                             font-mono text-2xl text-center tracking-[0.5em]" />
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label for="cloudUrl" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                        {{ 'CLOUD.CLOUD_URL' | translate }}
                      </label>
                      <input id="cloudUrl" [(ngModel)]="cloudUrl" name="cloudUrl" type="url"
                        class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                               font-mono text-xs" />
                    </div>
                    <div class="space-y-1">
                      <label for="edgeName" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                        {{ 'CLOUD.EDGE_NAME' | translate }}
                      </label>
                      <input id="edgeName" [(ngModel)]="edgeName" name="edgeName" type="text"
                        placeholder="Hauptstandort"
                        class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3 text-sm" />
                    </div>
                  </div>

                  @if (errors().length > 0) {
                    <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1">
                      @for (err of errors(); track err) {
                        <p class="text-red-500 dark:text-red-400 text-sm">✕ {{ err }}</p>
                      }
                    </div>
                  }

                  <div class="flex items-center gap-3">
                    <button (click)="onRunPreflight()" [disabled]="preflighting() || pairingCode.length < 6 || !edgeName"
                      class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm">
                      @if (preflighting()) {
                        <span class="inline-flex items-center gap-2">
                          <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                          Pruefe Cloud …
                        </span>
                      } @else {
                        Mit Cloud verbinden
                      }
                    </button>
                  </div>
                </div>
              }

              @case ('preflight-result') {
                @if (preflightResult(); as pf) {
                  <div class="space-y-5">
                    <div class="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-xl p-4">
                      <p class="text-sm text-blue-700 dark:text-blue-300">
                        @if (pf.cloudTenantName) {
                          Cloud-Tenant: <span class="font-medium">{{ pf.cloudTenantName }}</span>
                        } @else {
                          Cloud-Tenant: <span class="font-mono text-xs">{{ pf.cloudTenantId || '—' }}</span>
                        }
                      </p>
                      @if (pf.cloudTenantName && pf.cloudTenantId) {
                        <p class="text-xs text-blue-600/80 dark:text-blue-400/70 font-mono mt-1">{{ pf.cloudTenantId }}</p>
                      }
                      @if (pf.requiresTenantIdRestamp) {
                        <p class="text-xs text-amber-700 dark:text-amber-400 mt-2">
                          ⚠ Hinweis: Lokale tenantId weicht ab — beim Bootstrap wird ein DB-Backup angelegt und alle
                          lokalen Records auf die Cloud-tenantId umgestempelt.
                        </p>
                      }
                    </div>

                    @if (pf.edgeInventory && pf.cloudInventory) {
                      <div class="grid grid-cols-2 gap-3">
                        <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4">
                          <p class="text-xs uppercase tracking-wider text-slate-500 mb-2">Edge (lokal)</p>
                          <table class="w-full text-sm">
                            <tbody>
                              <tr><td class="text-slate-500">Produkte</td><td class="text-right font-mono">{{ pf.edgeInventory.products }}</td></tr>
                              <tr><td class="text-slate-500">Produktgruppen</td><td class="text-right font-mono">{{ pf.edgeInventory.productGroups }}</td></tr>
                              <tr><td class="text-slate-500">Personal</td><td class="text-right font-mono">{{ pf.edgeInventory.users }}</td></tr>
                              <tr><td class="text-slate-500">Firmenkunden</td><td class="text-right font-mono">{{ pf.edgeInventory.corporateCustomers }}</td></tr>
                              <tr><td class="text-slate-500">Kunden</td><td class="text-right font-mono">{{ pf.edgeInventory.customers }}</td></tr>
                            </tbody>
                          </table>
                        </div>
                        <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4">
                          <p class="text-xs uppercase tracking-wider text-slate-500 mb-2">Cloud</p>
                          <table class="w-full text-sm">
                            <tbody>
                              <tr><td class="text-slate-500">Produkte</td><td class="text-right font-mono">{{ pf.cloudInventory.products }}</td></tr>
                              <tr><td class="text-slate-500">Produktgruppen</td><td class="text-right font-mono">{{ pf.cloudInventory.productGroups }}</td></tr>
                              <tr><td class="text-slate-500">Personal</td><td class="text-right font-mono">{{ pf.cloudInventory.users }}</td></tr>
                              <tr><td class="text-slate-500">Firmenkunden</td><td class="text-right font-mono">{{ pf.cloudInventory.corporateCustomers }}</td></tr>
                              <tr><td class="text-slate-500">Kunden</td><td class="text-right font-mono">{{ pf.cloudInventory.customers }}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    } @else {
                      <div class="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl p-4">
                        <p class="text-sm text-amber-800 dark:text-amber-300">
                          ⚠ Inventardaten konnten nicht geladen werden. Die Cloud antwortet, aber liefert keinen Bestandsvergleich
                          — Bootstrap ist trotzdem moeglich. Empfohlene Sync-Richtung: <span class="font-medium">{{ pf.suggestedDirection }}</span>.
                        </p>
                      </div>
                    }

                    <div class="space-y-2">
                      <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Initiale Sync-Richtung</p>
                      @for (opt of directionOptions(); track opt.value) {
                        <label class="flex items-start gap-3 p-3 border border-slate-200 dark:border-gray-800 rounded-lg
                                       hover:bg-slate-50 dark:hover:bg-gray-900/30"
                               [class.cursor-pointer]="!opt.disabled"
                               [class.cursor-not-allowed]="opt.disabled"
                               [class.opacity-50]="opt.disabled"
                               [class.ring-2]="selectedDirection() === opt.value"
                               [class.ring-slate-900]="selectedDirection() === opt.value">
                          <input type="radio" name="direction" [value]="opt.value"
                                 [checked]="selectedDirection() === opt.value"
                                 [disabled]="opt.disabled"
                                 (change)="selectedDirection.set(opt.value)" class="mt-1" />
                          <div>
                            <p class="text-sm font-medium">{{ opt.label }}</p>
                            <p class="text-xs text-slate-500">{{ opt.description }}</p>
                            @if (opt.disabledReason) {
                              <p class="text-xs text-amber-700 dark:text-amber-400 mt-1">⚠ {{ opt.disabledReason }}</p>
                            }
                            @if (pf.suggestedDirection === opt.value && !opt.disabled) {
                              <span class="inline-block mt-1 text-[10px] uppercase font-bold text-emerald-600">Empfehlung</span>
                            }
                          </div>
                        </label>
                      }
                    </div>

                    @if (selectedDirection() === 'pull-cloud-to-edge') {
                      <label class="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg p-3 cursor-pointer">
                        <input type="checkbox" [checked]="confirmDataLoss()" (change)="confirmDataLoss.set(!confirmDataLoss())" class="mt-1" />
                        <span class="text-sm text-amber-800 dark:text-amber-300">
                          Ich verstehe, dass alle lokalen Stammdaten durch Cloud-Daten ersetzt werden.
                        </span>
                      </label>
                      <p class="text-xs text-slate-500 dark:text-slate-400 -mt-2 ml-1">
                        Vor dem Pull wird automatisch ein vollstaendiges DB-Backup unter <code class="text-[11px]">data/panary.sqlite.pre-pairing-&lt;timestamp&gt;.bak</code> angelegt.
                      </p>
                    }

                    @if (selectedDirection() === 'merge-by-external-id') {
                      <p class="text-xs text-slate-500 dark:text-slate-400 ml-1">
                        Vor dem Merge wird automatisch ein vollstaendiges DB-Backup unter <code class="text-[11px]">data/panary.sqlite.pre-pairing-&lt;timestamp&gt;.bak</code> angelegt.
                      </p>
                    }

                    @if (errors().length > 0) {
                      <div class="bg-red-50 border border-red-200 rounded-lg p-3">
                        @for (err of errors(); track err) {
                          <p class="text-red-500 text-sm">✕ {{ err }}</p>
                        }
                      </div>
                    }

                    <div class="flex items-center gap-3">
                      <button (click)="onStartBootstrap()" [disabled]="bootstrapping() || !canStart()"
                        class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                        @if (bootstrapping()) {
                          <span class="inline-flex items-center gap-2">
                            <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                            <span>Starte Bootstrap …</span>
                          </span>
                        } @else {
                          <span>Bootstrap starten</span>
                        }
                      </button>
                      <button (click)="onAbortWizard()" class="text-slate-500 text-sm hover:text-slate-900">Abbrechen</button>
                    </div>
                  </div>
                }
              }

              @case ('user-selection') {
                <div class="space-y-5">
                  <div>
                    <p class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                      User-Auswahl
                    </p>
                    <h2 class="text-base font-semibold mt-1">Welche lokalen User sollen in die Cloud uebernommen werden?</h2>
                    <p class="text-xs text-slate-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                      Default: alle Personal- und Geraete-User vorausgewaehlt. Owner- und Plattform-Rollen
                      werden grundsaetzlich nicht synchronisiert (Cloud verwaltet sie selbst).
                    </p>
                  </div>

                  @if (loadingUsers()) {
                    <div class="flex items-center gap-3 py-8 justify-center">
                      <span class="w-5 h-5 border-2 border-slate-300 dark:border-gray-600 border-t-slate-900
                                   dark:border-t-white rounded-full animate-spin"></span>
                      <span class="text-slate-400 dark:text-gray-500 text-sm">Lade lokale User …</span>
                    </div>
                  } @else {
                    @if (selectableUsers().length > 0) {
                      <div class="flex items-center gap-2 text-xs">
                        <button (click)="selectAllUsers()"
                          class="text-slate-700 dark:text-slate-300 hover:underline">
                          Alle auswaehlen
                        </button>
                        <span class="text-slate-300">·</span>
                        <button (click)="deselectAllUsers()"
                          class="text-slate-700 dark:text-slate-300 hover:underline">
                          Keine auswaehlen
                        </button>
                        <span class="ml-auto text-slate-500">
                          {{ selectedUserIds().size }} von {{ selectableUsers().length }} ausgewaehlt
                        </span>
                      </div>

                      <div class="bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800
                                  rounded-xl divide-y divide-slate-200 dark:divide-gray-800 overflow-hidden">
                        @for (user of selectableUsers(); track user._id) {
                          <label class="flex items-center gap-3 px-4 py-3 cursor-pointer
                                         hover:bg-slate-50 dark:hover:bg-gray-900/30">
                            <input type="checkbox"
                                   [checked]="isUserSelected(user._id)"
                                   (change)="toggleUser(user._id)"
                                   class="w-4 h-4" />
                            <div class="flex-1 min-w-0">
                              <div class="flex items-baseline gap-2 flex-wrap">
                                <span class="text-sm font-medium truncate">{{ user.loginname }}</span>
                                @if (user.firstName || user.lastName) {
                                  <span class="text-xs text-slate-500 truncate">
                                    {{ user.firstName }} {{ user.lastName }}
                                  </span>
                                }
                              </div>
                              <div class="flex items-center gap-2 mt-0.5">
                                <span class="text-[10px] uppercase tracking-wider font-mono text-slate-500">
                                  {{ user.role }}
                                </span>
                                @if (user.email) {
                                  <span class="text-xs text-slate-400 truncate">· {{ user.email }}</span>
                                }
                              </div>
                            </div>
                          </label>
                        }
                      </div>
                    } @else {
                      <div class="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl p-4">
                        <p class="text-sm text-amber-800 dark:text-amber-300">
                          Keine synchronisierbaren User vorhanden. Bootstrap startet ohne User-Push —
                          Cloud-Stammdaten bleiben unveraendert.
                        </p>
                      </div>
                    }

                    @if (blockedUsers().length > 0) {
                      <details class="bg-slate-50 dark:bg-gray-900/30 border border-slate-200 dark:border-gray-800
                                       rounded-xl">
                        <summary class="px-4 py-3 cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
                          {{ blockedUsers().length }} User werden nicht synchronisiert (Cloud-verwaltete Rollen)
                        </summary>
                        <div class="px-4 pb-3 pt-1">
                          <ul class="text-xs text-slate-500 space-y-1">
                            @for (user of blockedUsers(); track user._id) {
                              <li class="flex items-center gap-2">
                                <span class="font-mono text-[10px] uppercase tracking-wider">{{ user.role }}</span>
                                <span class="truncate">— {{ user.loginname }}</span>
                              </li>
                            }
                          </ul>
                          <p class="text-xs text-slate-400 mt-2 leading-relaxed">
                            Cloud verwaltet Owner- und Plattform-Identitaeten ueber das eigene Admin-Dashboard.
                            Edge-Backup-Accounts wuerden in der Cloud Login-Konflikte verursachen.
                          </p>
                        </div>
                      </details>
                    }
                  }

                  @if (errors().length > 0) {
                    <div class="bg-red-50 border border-red-200 rounded-lg p-3">
                      @for (err of errors(); track err) {
                        <p class="text-red-500 text-sm">✕ {{ err }}</p>
                      }
                    </div>
                  }

                  <div class="flex items-center gap-3">
                    <button (click)="confirmUserSelection()" [disabled]="bootstrapping() || loadingUsers()"
                      class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl
                             text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                      @if (bootstrapping()) {
                        <span class="inline-flex items-center gap-2">
                          <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                          <span>Starte Bootstrap …</span>
                        </span>
                      } @else {
                        <span>Bootstrap mit Auswahl starten</span>
                      }
                    </button>
                    <button (click)="backToPreflight()" [disabled]="bootstrapping()"
                      class="text-slate-500 text-sm hover:text-slate-900 disabled:opacity-50">
                      Zurueck
                    </button>
                    <button (click)="onAbortWizard()" [disabled]="bootstrapping()"
                      class="text-slate-500 text-sm hover:text-slate-900 disabled:opacity-50">
                      Abbrechen
                    </button>
                  </div>
                </div>
              }

              @case ('progress') {
                <div class="space-y-4">
                  <div class="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-xl p-4">
                    <span class="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></span>
                    <div>
                      <p class="text-sm text-blue-700 font-medium">Bootstrap laeuft …</p>
                      <p class="text-xs text-blue-600/70">{{ progressMessage() }}</p>
                    </div>
                  </div>
                </div>
              }
            }
          }

          <!-- CONNECTED -->
          @case ('connected') {
            <div class="space-y-5">
              <!-- Tab-Bar — trennt Verbindungs-Settings von der Sync-Historie.
                   Nur im Connected-State sichtbar; Wizard-/Pairing-/Error-States
                   zeigen weiterhin keine Tabs. -->
              <div role="tablist" aria-label="Cloud-Kopplung-Bereiche"
                   class="flex border-b border-slate-200 dark:border-gray-800">
                <button role="tab" type="button"
                        [attr.aria-selected]="activeTab() === 'connection'"
                        (click)="selectTab('connection')"
                        [class.border-slate-900]="activeTab() === 'connection'"
                        [class.dark:border-white]="activeTab() === 'connection'"
                        [class.text-slate-900]="activeTab() === 'connection'"
                        [class.dark:text-white]="activeTab() === 'connection'"
                        [class.text-slate-500]="activeTab() !== 'connection'"
                        [class.dark:text-gray-400]="activeTab() !== 'connection'"
                        class="px-4 py-2.5 -mb-px border-b-2 border-transparent text-sm font-medium
                               hover:text-slate-900 dark:hover:text-white transition">
                  Verbindung
                </button>
                <button role="tab" type="button"
                        [attr.aria-selected]="activeTab() === 'history'"
                        (click)="selectTab('history')"
                        [class.border-slate-900]="activeTab() === 'history'"
                        [class.dark:border-white]="activeTab() === 'history'"
                        [class.text-slate-900]="activeTab() === 'history'"
                        [class.dark:text-white]="activeTab() === 'history'"
                        [class.text-slate-500]="activeTab() !== 'history'"
                        [class.dark:text-gray-400]="activeTab() !== 'history'"
                        class="px-4 py-2.5 -mb-px border-b-2 border-transparent text-sm font-medium
                               hover:text-slate-900 dark:hover:text-white transition">
                  Sync-Historie
                </button>
                <button role="tab" type="button"
                        [attr.aria-selected]="activeTab() === 'reports'"
                        (click)="selectTab('reports')"
                        [class.border-slate-900]="activeTab() === 'reports'"
                        [class.dark:border-white]="activeTab() === 'reports'"
                        [class.text-slate-900]="activeTab() === 'reports'"
                        [class.dark:text-white]="activeTab() === 'reports'"
                        [class.text-slate-500]="activeTab() !== 'reports'"
                        [class.dark:text-gray-400]="activeTab() !== 'reports'"
                        class="px-4 py-2.5 -mb-px border-b-2 border-transparent text-sm font-medium
                               hover:text-slate-900 dark:hover:text-white transition">
                  Bootstrap-Reports
                </button>
              </div>

              @if (activeTab() === 'connection') {
              @if (connectionInfo()?.bootstrapStatus === 'failed') {
                <div class="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-4 space-y-3">
                  <div class="flex items-center gap-3">
                    <div class="w-3 h-3 rounded-full bg-red-500"></div>
                    <span class="text-sm text-red-700 dark:text-red-400 font-medium">
                      Bootstrap fehlgeschlagen — Verbindung in inkonsistentem Zustand
                    </span>
                  </div>
                  @if (connectionInfo()?.bootstrapError) {
                    <p class="text-xs text-red-600 dark:text-red-400 font-mono pl-6">
                      {{ connectionInfo()?.bootstrapError }}
                    </p>
                  }
                  <p class="text-xs text-red-600/80 dark:text-red-400/80 pl-6">
                    Empfohlene Aktion: Verbindung zuruecksetzen, neuen Pairing-Code generieren und neu pairen.
                  </p>
                  <div class="pl-6">
                    <button (click)="onForceReset()"
                      class="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
                      Verbindung zuruecksetzen
                    </button>
                  </div>
                </div>
              } @else {
                <div class="flex items-center gap-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50 rounded-xl p-4">
                  <div class="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                  <div>
                    <span class="text-sm text-green-700 dark:text-green-400 font-medium">Mit Cloud verbunden</span>
                    @if (connectionInfo()?.bootstrapStatus === 'in-progress') {
                      <span class="text-xs text-amber-700 ml-2">— Bootstrap laeuft</span>
                    }
                  </div>
                </div>
              }

              <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl divide-y divide-slate-200 dark:divide-gray-800">
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Cloud-URL</span>
                  <span class="text-sm font-mono">{{ connectionInfo()?.cloudUrl }}</span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Edge-Name</span>
                  <span class="text-sm">{{ connectionInfo()?.edgeName || '—' }}</span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Verbunden seit</span>
                  <span class="text-sm">{{ formatDate(connectionInfo()?.connectedAt) }}</span>
                </div>
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Letzter Sync</span>
                  <span class="text-sm">
                    {{ connectionInfo()?.lastSyncAt ? formatDate(connectionInfo()?.lastSyncAt) : 'Noch nicht synchronisiert' }}
                  </span>
                </div>
                @if (connectionInfo()?.lastClockSkewMs !== undefined) {
                  <div class="flex items-center justify-between px-4 py-3">
                    <span class="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Clock-Skew</span>
                    <span class="text-sm font-mono"
                          [class.text-amber-600]="abs(connectionInfo()?.lastClockSkewMs ?? 0) > 30000"
                          [class.dark:text-amber-400]="abs(connectionInfo()?.lastClockSkewMs ?? 0) > 30000"
                          [class.text-red-600]="abs(connectionInfo()?.lastClockSkewMs ?? 0) > 300000"
                          [class.dark:text-red-400]="abs(connectionInfo()?.lastClockSkewMs ?? 0) > 300000">
                      {{ formatSkew(connectionInfo()?.lastClockSkewMs) }}
                    </span>
                  </div>
                }
              </div>

              <!-- Sync-Mode-Settings -->
              <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
                <p class="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Sync-Verhalten</p>
                <select [(ngModel)]="syncMode" name="syncMode" (change)="onSaveSyncMode()"
                  class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-2 text-sm">
                  @for (opt of syncModeOptions; track opt.value) {
                    <option [value]="opt.value">{{ opt.label }} — {{ opt.description }}</option>
                  }
                </select>
                @if (syncMode === 'auto') {
                  <div class="space-y-1">
                    <label for="syncIntervalSec" class="text-xs text-slate-500 dark:text-gray-400">Intervall (Sekunden)</label>
                    <input id="syncIntervalSec" type="number" [(ngModel)]="syncIntervalSec" name="syncIntervalSec"
                      min="60" max="3600" (blur)="onSaveSyncMode()"
                      class="w-32 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-2 text-sm" />
                  </div>
                }
                <div class="flex items-center gap-3">
                  <button (click)="onSyncNow()" [disabled]="syncing()"
                    class="bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium">
                    @if (syncing()) { Synchronisiere … } @else { Jetzt synchronisieren }
                  </button>
                  @if (lastSyncResult(); as r) {
                    <span class="text-xs text-slate-500 dark:text-gray-400">
                      ↑ {{ r.pushed }} gesendet, ↓ {{ r.pulled }} empfangen, {{ r.durationMs }} ms
                    </span>
                  }
                </div>
              </div>

              @if (openConflictsCount() > 0) {
                <a routerLink="/cloud/conflicts"
                   class="block bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl p-4 hover:bg-amber-100 transition">
                  <p class="text-sm font-medium text-amber-800">
                    {{ openConflictsCount() }} offene Sync-Konflikte erfordern eine Entscheidung.
                  </p>
                  <p class="text-xs text-amber-700 mt-1">
                    Klicken zum Auflösen → Konflikt-Review öffnen
                  </p>
                </a>
              }

              <!-- Diagnose-Sektion: alle DB-Felder einsehbar, hilft beim Debug
                   ohne SQLite-Tool. Plus prominente Hard-Delete-Action.
                   Bewusst VOR der Sync-Historie platziert — Operatoren sehen
                   den DB-State zuerst, bevor sie die Historie durchsuchen. -->
              <details class="bg-slate-50 dark:bg-gray-900/30 border border-slate-200 dark:border-gray-800 rounded-xl">
                <summary class="px-4 py-3 cursor-pointer text-xs font-medium text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white">
                  Diagnose &amp; Erweiterte Aktionen
                </summary>
                <div class="px-4 pb-4 pt-3 space-y-4 border-t border-slate-200 dark:border-gray-800">
                  <div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
                    <div><span class="text-slate-500 dark:text-gray-400">_id:</span> {{ connectionInfo()?._id ?? '—' }}</div>
                    <div><span class="text-slate-500 dark:text-gray-400">cloudEdgeId:</span> {{ connectionInfo()?.cloudEdgeId ?? '—' }}</div>
                    <div><span class="text-slate-500 dark:text-gray-400">pairingStatus:</span> {{ connectionInfo()?.pairingStatus ?? '—' }}</div>
                    <div><span class="text-slate-500 dark:text-gray-400">bootstrapStatus:</span> {{ connectionInfo()?.bootstrapStatus ?? '—' }}</div>
                    <div><span class="text-slate-500 dark:text-gray-400">syncMode:</span> {{ connectionInfo()?.syncMode ?? '—' }}</div>
                    <div><span class="text-slate-500 dark:text-gray-400">syncIntervalSec:</span> {{ connectionInfo()?.syncIntervalSec ?? '—' }}</div>
                    <div class="col-span-2"><span class="text-slate-500 dark:text-gray-400">cloudUrl:</span> {{ connectionInfo()?.cloudUrl ?? '—' }}</div>
                    @if (connectionInfo()?.bootstrapError) {
                      <div class="col-span-2 text-red-600 dark:text-red-400"><span class="text-slate-500 dark:text-gray-400">bootstrapError:</span> {{ connectionInfo()?.bootstrapError }}</div>
                    }
                    @if (connectionInfo()?.errorMessage) {
                      <div class="col-span-2 text-red-600 dark:text-red-400"><span class="text-slate-500 dark:text-gray-400">errorMessage:</span> {{ connectionInfo()?.errorMessage }}</div>
                    }
                  </div>
                  <div class="pt-3 border-t border-slate-200 dark:border-gray-800">
                    <button (click)="confirmingHardDelete.set(true)"
                      class="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded-md">
                      Verbindung hart loeschen (lokal)
                    </button>
                    <p class="text-xs text-slate-500 dark:text-gray-400 mt-1.5">
                      Entfernt den lokalen DB-Eintrag bedingungslos — Cloud-Side wird best-effort
                      benachrichtigt. Verwende dies nur bei verwaisten Halbzustaenden.
                    </p>
                  </div>
                </div>
              </details>

              <button (click)="confirmingDisconnect.set(true)"
                class="text-red-500 text-sm hover:text-red-700">Verbindung trennen</button>
              }

              @if (activeTab() === 'history') {
                <!-- Sync-Historie: chronologische Liste aller fachlich relevanten
                     Sync-Vorgaenge (siehe sync-runs-Tabelle). Stille Heartbeats
                     und leere Pulls werden nicht aufgelistet. Komponente wird
                     bei Tab-Wechsel un-/gemounted — frischer Reload, kein
                     Hintergrund-Polling auf nicht-sichtbarem Tab. -->
                <app-sync-history />
              }

              @if (activeTab() === 'reports') {
                <!-- Bootstrap-Reports: Diagnose-Persistenz pro Pairing-Vorgang.
                     Pre/Post-State, Restamp-Detail, Konsistenz-Check, Sync-Run-
                     Korrelation. Hilft bei Drift-Analyse ohne SQLite-Forensik. -->
                <app-bootstrap-reports />
              }
            </div>

            @if (confirmingDisconnect()) {
              <app-confirm-dialog
                [title]="'Verbindung trennen'"
                [message]="'Edge-Server wird vom Cloud-Account abgekoppelt. Lokale Daten bleiben erhalten.'"
                [confirmLabel]="'Trennen'"
                [dismissLabel]="'Abbrechen'"
                (confirmed)="onDisconnect()"
                (dismissed)="confirmingDisconnect.set(false)"
                (cancelled)="confirmingDisconnect.set(false)" />
            }

            @if (confirmingHardDelete()) {
              <app-confirm-dialog
                [title]="'Verbindung hart loeschen?'"
                [message]="'Lokaler Verbindungs-Eintrag wird unwiderruflich entfernt. Cloud-Side wird per DELETE-Call benachrichtigt — bei Cloud-Unreachable bleibt der Cloud-Doc verwaist und muss im Cloud-Admin-Dashboard manuell entfernt werden.'"
                [confirmLabel]="'Hart loeschen'"
                [dismissLabel]="'Abbrechen'"
                (confirmed)="onHardDelete()"
                (dismissed)="confirmingHardDelete.set(false)"
                (cancelled)="confirmingHardDelete.set(false)" />
            }
          }

          @case ('pairing') {
            <div class="space-y-4">
              <div class="flex items-center gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl p-4">
                <span class="w-5 h-5 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin"></span>
                <div class="flex-1">
                  <p class="text-sm text-amber-800">Pairing laeuft …</p>
                  @if (connectionInfo()?.errorMessage) {
                    <p class="text-xs text-red-600 mt-1">{{ connectionInfo()?.errorMessage }}</p>
                  }
                </div>
              </div>
              <div class="flex gap-3">
                <button (click)="onReset()" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">
                  Zuruecksetzen
                </button>
                <p class="text-xs text-slate-500 self-center">
                  Setzt die Verbindung zurueck und beginnt das Pairing neu.
                </p>
              </div>
            </div>
          }

          @case ('error') {
            <div class="space-y-5">
              <div class="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                <div class="w-3 h-3 rounded-full bg-red-400"></div>
                <div>
                  <span class="text-sm text-red-700 font-medium block">Verbindungsfehler</span>
                  @if (connectionInfo()?.errorMessage) {
                    <span class="text-xs text-red-500">{{ connectionInfo()?.errorMessage }}</span>
                  }
                </div>
              </div>
              <div class="flex gap-3">
                <button (click)="onReset()" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">Zuruecksetzen</button>
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
  private route = inject(ActivatedRoute)
  private router = inject(Router)

  // Tab-Auswahl im Connected-View. URL-Query-Param `?tab=history` haelt den
  // Wert ueber Reloads hinweg; Default ohne Param ist 'connection'.
  activeTab = signal<ConnectionTab>('connection')

  loading = signal(true)
  connectionState = signal<PairingStatus>('disconnected')
  connectionInfo = signal<CloudConnectionInfo | null>(null)
  preflighting = signal(false)
  bootstrapping = signal(false)
  syncing = signal(false)
  errors = signal<string[]>([])
  confirmingDisconnect = signal(false)
  confirmingHardDelete = signal(false)

  wizardStep = signal<WizardStep>('input')
  preflightResult = signal<PreflightResult | null>(null)
  selectedDirection = signal<InitialDirection | null>(null)
  confirmDataLoss = signal(false)
  progressMessage = signal('Bootstrap-Phase initialisieren …')
  lastSyncResult = signal<{ pushed: number; pulled: number; durationMs: number } | null>(null)
  openConflictsCount = signal(0)

  // User-Auswahl-Schritt — nur fuer `bootstrap-edge-to-cloud` relevant.
  edgeUsers = signal<EdgeUserOption[]>([])
  selectedUserIds = signal<Set<string>>(new Set())
  loadingUsers = signal(false)
  selectableUsers = computed(() => this.edgeUsers().filter(u => !u.blocked))
  blockedUsers = computed(() => this.edgeUsers().filter(u => u.blocked))


  cloudUrl = DEFAULT_CLOUD_URL
  pairingCode = ''
  edgeName = ''
  syncMode: SyncMode = 'auto'
  syncIntervalSec = 300

  // Variante (c): bootstrap-edge-to-cloud wird im UI deaktiviert, wenn die
  // Cloud bereits Stammdaten enthaelt (Cloud ist Quelle der Wahrheit). Cloud-
  // Backend lehnt diesen Modus zusaetzlich autoritativ ab — UI ist nur UX.
  directionOptions = computed(() => {
    const pf = this.preflightResult()
    const cloudHasData = pf ? Object.values(pf.cloudInventory).some(c => c > 0) : false
    return (['bootstrap-edge-to-cloud', 'pull-cloud-to-edge', 'merge-by-external-id'] as InitialDirection[]).map(value => ({
      value,
      label: directionLabel(value),
      description:
        value === 'bootstrap-edge-to-cloud'
          ? 'Geeignet wenn Cloud noch leer ist'
          : value === 'pull-cloud-to-edge'
            ? 'Geeignet wenn Cloud bereits gepflegt ist'
            : 'Geeignet wenn beide Seiten gepflegt sind und externalIds gesetzt sind',
      disabled: value === 'bootstrap-edge-to-cloud' && cloudHasData,
      disabledReason:
        value === 'bootstrap-edge-to-cloud' && cloudHasData
          ? 'Cloud enthaelt bereits Stammdaten — Modus gesperrt.'
          : null,
    }))
  })

  readonly syncModeOptions = SYNC_MODE_OPTIONS

  canStart = computed(() => {
    const dir = this.selectedDirection()
    if (!dir) return false
    const opt = this.directionOptions().find(o => o.value === dir)
    if (opt?.disabled) return false
    if (dir === 'pull-cloud-to-edge' && !this.confirmDataLoss()) return false
    return true
  })

  abs(n: number | undefined): number {
    return n === undefined ? 0 : Math.abs(n)
  }

  formatDate(iso?: string): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  formatSkew(ms: number | undefined): string {
    if (ms === undefined) return '—'
    if (Math.abs(ms) < 1000) return `${ms} ms`
    return `${(ms / 1000).toFixed(1)} s`
  }

  async ngOnInit() {
    // Initiale Tab-Auswahl aus URL — 'history' und 'reports' werden akzeptiert,
    // alle anderen Werte fallen still auf den Default ('connection') zurueck.
    // Damit bleibt der Direktaufruf von /cloud unveraendert wie bisher.
    const urlTab = this.route.snapshot.queryParamMap.get('tab')
    if (urlTab === 'history' || urlTab === 'reports') {
      this.activeTab.set(urlTab)
    }
    await this.loadConnection()
    await this.loadConflictsCount()
  }

  selectTab(tab: ConnectionTab) {
    this.activeTab.set(tab)
    // `replaceUrl: true` vermeidet Eintraege im Browser-Back-Stack — der User
    // soll mit "Zurueck" zur vorherigen Seite kommen, nicht durch die Tabs
    // springen. `tab: null` entfernt den Param sauber, wenn auf Default
    // ('connection') gewechselt wird.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'connection' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    })
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
        this.syncMode = conn.syncMode ?? 'auto'
        this.syncIntervalSec = conn.syncIntervalSec ?? 300
        if (conn.bootstrapStatus === 'in-progress') {
          this.wizardStep.set('progress')
          void this.pollBootstrapProgress(conn._id)
        } else if (this.wizardStep() === 'progress') {
          // Safety-Net: wizardStep haengt von einem frueheren Bootstrap-Lauf
          // noch auf 'progress', obwohl gar kein Bootstrap mehr laeuft. Beim
          // Wechsel von 'connected' zurueck zu 'disconnected' (z.B. nach Sync-
          // 401) wuerde sonst der "Bootstrap laeuft"-Dialog wieder erscheinen.
          this.wizardStep.set('input')
        }
      }
    } catch {
      // kein Datensatz vorhanden
    }
    if (!this.edgeName) {
      await this.loadDefaultEdgeName()
    }
    this.loading.set(false)
    this.cdr.markForCheck()
  }

  private async loadConflictsCount() {
    try {
      const result = await this.api.find<unknown>('sync-conflicts', { $limit: 0, status: 'open' } as any)
      this.openConflictsCount.set((result as any)?.total ?? 0)
    } catch {
      this.openConflictsCount.set(0)
    }
  }

  async onRunPreflight() {
    if (this.pairingCode.length < 6) return
    this.preflighting.set(true)
    this.errors.set([])
    try {
      const result = await this.api.customMethod<PreflightResult>('cloud-connection', 'preflight', {
        cloudUrl: this.cloudUrl,
        pairingCode: this.pairingCode,
        edgeName: this.edgeName,
      })
      this.preflightResult.set(result)
      // Empfohlene Direction setzen — aber NICHT, falls sie durch Variante (c)
      // gesperrt waere (Cloud hat Daten, Edge will bootstrap-edge-to-cloud).
      // In dem Fall User aktiv waehlen lassen statt eine deaktivierte Option
      // vorzuselektieren.
      const suggested = this.directionOptions().find(o => o.value === result.suggestedDirection)
      this.selectedDirection.set(suggested && !suggested.disabled ? result.suggestedDirection : null)
      this.wizardStep.set('preflight-result')
    } catch (e: any) {
      this.errors.set(formatApiError(e).split('\n'))
    }
    this.preflighting.set(false)
    this.cdr.markForCheck()
  }

  async onStartBootstrap() {
    const pf = this.preflightResult()
    const dir = this.selectedDirection()
    if (!pf || !dir) return
    if (dir === 'pull-cloud-to-edge' && !this.confirmDataLoss()) {
      this.errors.set(['Bitte den Hinweis bestaetigen.'])
      return
    }
    // Bei `bootstrap-edge-to-cloud` zwischenschalten: User-Auswahl, damit der
    // Admin gezielt einzelne lokale User aus dem Cloud-Push ausschliessen kann.
    if (dir === 'bootstrap-edge-to-cloud') {
      await this.openUserSelection()
      return
    }
    await this.runBootstrapRequest(undefined)
  }

  private async openUserSelection() {
    this.errors.set([])
    this.loadingUsers.set(true)
    this.wizardStep.set('user-selection')
    try {
      // $limit grosszuegig bemessen — typische Edge-Setups haben < 50 User.
      // Grosse Datasets (Franchises mit hunderten Personalakten) bleiben
      // ausserhalb des Use-Cases — der Wizard ist fuer den Initial-Bootstrap
      // eines einzelnen Standorts gedacht.
      const result = await this.api.find<{
        _id: string
        loginname: string
        firstName?: string
        lastName?: string
        email?: string
        role: string
      }>('users', { $limit: 500, $sort: { loginname: 1 } })
      const users: EdgeUserOption[] = (result.data ?? []).map(u => {
        const blocked = isCloudManagedRole(u.role)
        return {
          _id: u._id,
          loginname: u.loginname,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          role: u.role,
          blocked,
          blockedReason: blocked ? 'Cloud verwaltet diese Rolle selbst.' : undefined,
        }
      })
      this.edgeUsers.set(users)
      // Default: alle nicht-blockierten User vorausgewaehlt.
      this.selectedUserIds.set(new Set(users.filter(u => !u.blocked).map(u => u._id)))
    } catch (e: unknown) {
      this.errors.set(formatApiError(e).split('\n'))
      this.edgeUsers.set([])
      this.selectedUserIds.set(new Set())
    }
    this.loadingUsers.set(false)
    this.cdr.markForCheck()
  }

  toggleUser(id: string) {
    const next = new Set(this.selectedUserIds())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.selectedUserIds.set(next)
  }

  isUserSelected(id: string): boolean {
    return this.selectedUserIds().has(id)
  }

  selectAllUsers() {
    this.selectedUserIds.set(new Set(this.selectableUsers().map(u => u._id)))
  }

  deselectAllUsers() {
    this.selectedUserIds.set(new Set())
  }

  backToPreflight() {
    this.wizardStep.set('preflight-result')
    this.errors.set([])
  }

  async confirmUserSelection() {
    // Selektion ist immer eine Teilmenge der nicht-blockierten User.
    const selectableIds = new Set(this.selectableUsers().map(u => u._id))
    const allSelectableSelected =
      selectableIds.size > 0 &&
      [...selectableIds].every(id => this.selectedUserIds().has(id)) &&
      this.selectedUserIds().size === selectableIds.size
    // Wenn der Admin die Default-Auswahl unveraendert bestaetigt → keine
    // Allowlist senden, damit der Server den Default-Pfad faehrt (alle
    // erlaubten Rollen). Allowlist nur senden, wenn der Admin aktiv abweicht.
    const allowlist = allSelectableSelected
      ? undefined
      : [...this.selectedUserIds()].filter(id => selectableIds.has(id))
    await this.runBootstrapRequest(allowlist)
  }

  private async runBootstrapRequest(allowlist: string[] | undefined) {
    const dir = this.selectedDirection()
    if (!dir) return
    this.bootstrapping.set(true)
    this.errors.set([])
    try {
      const updated = await this.api.customMethod<CloudConnectionInfo>('cloud-connection', 'startBootstrap', {
        cloudUrl: this.cloudUrl,
        pairingCode: this.pairingCode,
        edgeName: this.edgeName,
        initialDirection: dir,
        confirmDataLoss: this.confirmDataLoss(),
        ...(allowlist ? { bootstrapUserAllowlist: allowlist } : {}),
      })
      this.connectionInfo.set(updated)
      this.connectionState.set(updated.pairingStatus)
      this.wizardStep.set('progress')
      void this.pollBootstrapProgress(updated._id)
    } catch (e: unknown) {
      this.errors.set(formatApiError(e).split('\n'))
      // Bei Fehler im User-Selection-Pfad zurueck zum Auswahl-Screen, damit
      // der Admin die Selektion korrigieren oder abbrechen kann.
      if (this.wizardStep() === 'user-selection') {
        // bleibt auf user-selection
      }
    }
    this.bootstrapping.set(false)
    this.cdr.markForCheck()
  }

  private async pollBootstrapProgress(id: string) {
    for (let i = 0; i < 600; i++) {
      try {
        const conn = await this.api.get<CloudConnectionInfo>('cloud-connection', id)
        this.connectionInfo.set(conn)
        if (conn.bootstrapStatus === 'done') {
          this.connectionState.set('connected')
          // wizardStep zurueck auf 'input', damit ein spaeterer Disconnect
          // (z.B. durch Sync-401) nicht den haengen-gebliebenen 'progress'-
          // Step weiter rendert ("Bootstrap laeuft"-Dialog ohne Bootstrap).
          this.wizardStep.set('input')
          this.cdr.markForCheck()
          return
        }
        if (conn.bootstrapStatus === 'failed') {
          this.connectionState.set('error')
          this.errors.set([conn.bootstrapError ?? 'Bootstrap fehlgeschlagen.'])
          this.wizardStep.set('input')
          this.cdr.markForCheck()
          return
        }
        this.progressMessage.set(`Status: ${conn.bootstrapStatus} — Direction: ${conn.initialDirection}`)
      } catch {
        // ignore
      }
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  onAbortWizard() {
    this.wizardStep.set('input')
    this.preflightResult.set(null)
    this.selectedDirection.set(null)
    this.confirmDataLoss.set(false)
    this.edgeUsers.set([])
    this.selectedUserIds.set(new Set())
    this.errors.set([])
  }

  async onSaveSyncMode() {
    const conn = this.connectionInfo()
    if (!conn) return
    try {
      await this.api.patch('cloud-connection', conn._id, {
        syncMode: this.syncMode,
        syncIntervalSec: this.syncIntervalSec,
      } as any)
    } catch (e: any) {
      this.errors.set(formatApiError(e).split('\n'))
      this.cdr.markForCheck()
    }
  }

  async onSyncNow() {
    const conn = this.connectionInfo()
    if (!conn) return
    this.syncing.set(true)
    try {
      const result = await this.api.customMethod<{ pushed: number; pulled: number; durationMs: number }>(
        'cloud-connection',
        'syncNow',
        { cloudConnectionId: conn._id },
      )
      this.lastSyncResult.set(result)
      await this.loadConnection()
    } catch (e: any) {
      this.errors.set(formatApiError(e).split('\n'))
    }
    this.syncing.set(false)
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
      this.wizardStep.set('input')
      this.pairingCode = ''
    } catch (e: any) {
      this.errors.set(formatApiError(e).split('\n'))
    }
    this.cdr.markForCheck()
  }

  async onReset() {
    const conn = this.connectionInfo()
    if (conn) {
      await this.api.remove('cloud-connection', conn._id).catch(() => undefined)
    }
    this.connectionInfo.set(null)
    this.connectionState.set('disconnected')
    this.wizardStep.set('input')
    this.cloudUrl = DEFAULT_CLOUD_URL
    this.pairingCode = ''
    this.edgeName = ''
    this.errors.set([])
    // Edge-Name wieder aus der lokalen `locations`-Tabelle als Default befuellen,
    // damit der Wizard nach Reset nicht mit leerem Feld startet.
    await this.loadDefaultEdgeName()
    this.cdr.markForCheck()
  }

  /** Default-Wert fuer das Edge-Name-Feld aus der lokalen `locations`-Tabelle.
   *  Wird beim initialen Load und nach jedem Reset aufgerufen — sonst muesste
   *  der User den Standortnamen jedes Mal manuell wieder eintippen. */
  private async loadDefaultEdgeName() {
    try {
      const locResult = await this.api.find<{ name: string }>('locations', { $limit: 1 })
      if (locResult.data.length > 0 && locResult.data[0].name) {
        this.edgeName = locResult.data[0].name
      }
    } catch {
      // Keine Locations verfuegbar — Wizard bleibt mit leerem Feld
    }
  }

  // Identisch zu onReset, aber als gut sichtbarer Recovery-Pfad bei
  // bootstrapStatus === 'failed' im Connected-View. Trennt die Verbindung
  // hart (DELETE auf cloud-connection inkl. Cloud-Side-Notification ueber
  // notifyCloudOnDisconnect-Hook) und setzt den Wizard zurueck.
  async onForceReset() {
    await this.onReset()
  }

  // Hard-Delete aus dem Diagnose-Drawer im Connected-View. Funktional identisch
  // zu onReset (entfernt SQLite-Eintrag, notifyCloudOnDisconnect-Hook macht
  // Best-Effort-DELETE auf Cloud-Side); separater Confirm-Dialog mit klarer
  // Halbzustand-Warnung. Bei Cloud-Unreachable bleibt der Cloud-Doc verwaist —
  // der User kann ihn dann im Cloud-Admin-Dashboard manuell entfernen.
  async onHardDelete() {
    this.confirmingHardDelete.set(false)
    await this.onReset()
  }
}
