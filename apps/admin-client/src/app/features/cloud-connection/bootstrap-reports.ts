import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit, signal } from '@angular/core'

import { ApiService } from '../../core/api.service'

type BootstrapReportStatus = 'in-progress' | 'done' | 'failed'
type BootstrapReportDirection = 'bootstrap-edge-to-cloud' | 'pull-cloud-to-edge' | 'merge-by-external-id'

interface RestampDetail {
  skipped: boolean
  reason?: string
  locationsTableUpdated: boolean
  affectedTables: string[]
  updatedRowsTotal: number
  perTable?: Record<string, number>
  backupPath?: string
  durationMs: number
}

interface ConsistencyCheck {
  isHealthy: boolean
  ghostLocations: string[]
  tenantIdMismatchCount: number
  locationIdMismatchCount: number
  issues: Array<{ severity: 'WARN' | 'ERROR'; message: string }>
}

interface BootstrapReportRow {
  _id: string
  cloudConnectionId: string
  tenantId: string | null
  startedAt: string
  completedAt?: string
  status: BootstrapReportStatus
  direction: BootstrapReportDirection
  errorMessage?: string
  identity: {
    edgeTenantIdBefore: string | null
    cloudTenantId: string
    edgeLocationIdBefore: string | null
    cloudLocationId: string | null
  }
  preState: { locations: Array<{ _id: string; tenantId: string }>; counts: Record<string, number> }
  postState?: { locations: Array<{ _id: string; tenantId: string }>; counts: Record<string, number> }
  restamp?: RestampDetail
  syncRunIds: string[]
  consistencyCheck?: ConsistencyCheck
  jsonExportPath?: string
}

const REFRESH_INTERVAL_MS = 30_000

const DIRECTION_LABEL: Record<BootstrapReportDirection, string> = {
  'bootstrap-edge-to-cloud': '→ Cloud (Edge ist Quelle)',
  'pull-cloud-to-edge': '← Cloud (Cloud ist Quelle)',
  'merge-by-external-id': '↔ Merge per externalId',
}

@Component({
  selector: 'app-bootstrap-reports',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bg-surface-panel dark:bg-surface-bg/50 border border-line-soft rounded-xl flex flex-col">
      <header class="px-4 py-3 border-b border-line-soft flex items-center justify-between flex-none">
        <div>
          <h2 class="text-sm font-semibold">Bootstrap-Reports</h2>
          <p class="text-xs text-ink-muted mt-0.5">
            Diagnose-Persistenz pro Pairing — Pre/Post-State, Restamp-Detail, Konsistenz-Check.
          </p>
        </div>
        <button
          (click)="reload()"
          class="text-ink-muted text-xs hover:text-ink px-2 py-1"
          [disabled]="loading()"
          title="Aktualisieren"
        >
          ⟳
        </button>
      </header>

      @if (loading() && rows().length === 0) {
        <div class="flex items-center gap-3 py-10 justify-center">
          <span class="w-5 h-5 border-2 border-line-strong border-t-ink rounded-full animate-spin"></span>
          <span class="text-ink-faint text-sm">Lade Reports …</span>
        </div>
      } @else if (rows().length === 0) {
        <div class="px-4 py-8 text-center">
          <p class="text-sm text-ink-muted">
            Keine Bootstrap-Reports vorhanden. Beim naechsten Pairing wird ein Report erzeugt.
          </p>
        </div>
      } @else {
        <ul class="divide-y divide-line-soft">
          @for (row of rows(); track row._id) {
            <li class="px-4 py-3">
              <button
                type="button"
                (click)="toggleExpand(row._id)"
                class="w-full flex items-center justify-between gap-3 text-left"
              >
                <div class="flex items-center gap-3 min-w-0">
                  @switch (row.status) {
                    @case ('done') {
                      @if (row.consistencyCheck?.isHealthy) {
                        <span
                          class="inline-flex items-center justify-center w-2 h-2 rounded-full bg-emerald-500 flex-none"
                        ></span>
                      } @else {
                        <span
                          class="inline-flex items-center justify-center w-2 h-2 rounded-full bg-amber-500 flex-none"
                        ></span>
                      }
                    }
                    @case ('failed') {
                      <span
                        class="inline-flex items-center justify-center w-2 h-2 rounded-full bg-red-500 flex-none"
                      ></span>
                    }
                    @default {
                      <span
                        class="inline-flex items-center justify-center w-2 h-2 rounded-full bg-ink-faint flex-none animate-pulse"
                      ></span>
                    }
                  }
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium truncate">{{ directionLabel(row.direction) }}</p>
                    <p class="text-xs text-ink-muted mt-0.5">
                      {{ formatDate(row.startedAt) }} · Status:
                      <span [class.text-red-600]="row.status === 'failed'">{{ row.status }}</span>
                      @if (row.consistencyCheck) {
                        ·
                        @if (row.consistencyCheck.isHealthy) {
                          <span class="text-emerald-700 dark:text-emerald-400">Konsistent</span>
                        } @else {
                          <span class="text-amber-700 dark:text-amber-400"
                            >{{ row.consistencyCheck.issues.length }} Issue(s)</span
                          >
                        }
                      }
                    </p>
                  </div>
                </div>
                <span class="text-ink-faint text-xs flex-none">{{ expanded() === row._id ? '▴' : '▾' }}</span>
              </button>

              @if (expanded() === row._id) {
                <div class="mt-3 space-y-3 text-xs">
                  <!-- Identity -->
                  <div class="bg-surface-elevated dark:bg-surface-elevated/40 rounded p-3 space-y-1 font-mono">
                    <div>
                      <span class="text-ink-muted">edgeTenantIdBefore:</span>
                      {{ row.identity.edgeTenantIdBefore || '—' }}
                    </div>
                    <div><span class="text-ink-muted">cloudTenantId:</span> {{ row.identity.cloudTenantId }}</div>
                    <div>
                      <span class="text-ink-muted">edgeLocationIdBefore:</span>
                      {{ row.identity.edgeLocationIdBefore || '—' }}
                    </div>
                    <div>
                      <span class="text-ink-muted">cloudLocationId:</span> {{ row.identity.cloudLocationId || '—' }}
                    </div>
                  </div>

                  <!-- Restamp -->
                  @if (row.restamp; as r) {
                    <div class="bg-surface-input border border-line rounded p-3 space-y-1">
                      <p class="font-semibold mb-1">Restamp</p>
                      @if (r.skipped) {
                        <p class="text-ink-muted dark:text-ink">Uebersprungen — {{ r.reason || 'Grund unbekannt' }}</p>
                      } @else {
                        <p>
                          locations-Tabelle umgestempelt:
                          <strong
                            [class.text-emerald-700]="r.locationsTableUpdated"
                            [class.text-red-700]="!r.locationsTableUpdated"
                            >{{ r.locationsTableUpdated ? 'JA' : 'NEIN' }}</strong
                          >
                        </p>
                        <p>
                          Updated rows total: <strong>{{ r.updatedRowsTotal }}</strong>
                        </p>
                        <p>
                          Affected tables: <span class="font-mono">{{ r.affectedTables.join(', ') || '—' }}</span>
                        </p>
                        <p>Dauer: {{ r.durationMs }}ms</p>
                        @if (r.backupPath) {
                          <p class="font-mono text-[11px] break-all">Backup: {{ r.backupPath }}</p>
                        }
                      }
                    </div>
                  }

                  <!-- Pre/Post-State -->
                  <div class="grid grid-cols-2 gap-3">
                    <div class="bg-surface-input border border-line rounded p-3">
                      <p class="font-semibold mb-1">Pre-State</p>
                      <p class="text-[11px] text-ink-muted mb-1">locations._id</p>
                      <ul class="font-mono text-[11px] mb-2">
                        @for (l of row.preState.locations; track l._id) {
                          <li class="break-all">{{ l._id }}</li>
                        }
                      </ul>
                      @for (entry of asEntries(row.preState.counts); track entry[0]) {
                        @if (entry[1] > 0) {
                          <p>
                            {{ entry[0] }}: <strong>{{ entry[1] }}</strong>
                          </p>
                        }
                      }
                    </div>
                    <div class="bg-surface-input border border-line rounded p-3">
                      <p class="font-semibold mb-1">Post-State</p>
                      @if (row.postState; as ps) {
                        <p class="text-[11px] text-ink-muted mb-1">locations._id</p>
                        <ul class="font-mono text-[11px] mb-2">
                          @for (l of ps.locations; track l._id) {
                            <li class="break-all">{{ l._id }}</li>
                          }
                        </ul>
                        @for (entry of asEntries(ps.counts); track entry[0]) {
                          @if (entry[1] > 0) {
                            <p>
                              {{ entry[0] }}: <strong>{{ entry[1] }}</strong>
                            </p>
                          }
                        }
                      } @else {
                        <p class="text-ink-faint">— Bootstrap nicht abgeschlossen</p>
                      }
                    </div>
                  </div>

                  <!-- Consistency-Check -->
                  @if (row.consistencyCheck; as c) {
                    <div
                      class="rounded p-3 space-y-1 border"
                      [class.bg-emerald-50]="c.isHealthy"
                      [class.dark:bg-emerald-950/20]="c.isHealthy"
                      [class.border-emerald-200]="c.isHealthy"
                      [class.bg-amber-50]="!c.isHealthy"
                      [class.dark:bg-amber-950/20]="!c.isHealthy"
                      [class.border-amber-300]="!c.isHealthy"
                    >
                      <p class="font-semibold mb-1">Konsistenz-Check</p>
                      <p>
                        isHealthy: <strong>{{ c.isHealthy ? 'JA' : 'NEIN' }}</strong>
                      </p>
                      <p>Ghost-Locations: {{ c.ghostLocations.length }}</p>
                      <p>tenantId-Mismatches: {{ c.tenantIdMismatchCount }}</p>
                      <p>locationId-Mismatches: {{ c.locationIdMismatchCount }}</p>
                      @if (c.issues.length > 0) {
                        <ul class="mt-2 space-y-1">
                          @for (issue of c.issues; track issue.message) {
                            <li
                              class="font-mono text-[11px]"
                              [class.text-red-700]="issue.severity === 'ERROR'"
                              [class.text-amber-700]="issue.severity === 'WARN'"
                            >
                              [{{ issue.severity }}] {{ issue.message }}
                            </li>
                          }
                        </ul>
                      }
                    </div>
                  }

                  <!-- Sync-Runs Korrelation -->
                  @if (row.syncRunIds.length > 0) {
                    <div class="bg-surface-input border border-line rounded p-3">
                      <p class="font-semibold mb-1">Verlinkte Sync-Runs ({{ row.syncRunIds.length }})</p>
                      <p class="text-[11px] text-ink-muted font-mono break-all">
                        {{ row.syncRunIds.join(' · ') }}
                      </p>
                    </div>
                  }

                  @if (row.errorMessage) {
                    <div class="bg-red-50 dark:bg-red-950/20 border border-red-200 rounded p-3">
                      <p class="font-semibold text-red-700 dark:text-red-400 mb-1">Fehler</p>
                      <p class="font-mono text-[11px] text-red-700 dark:text-red-300 break-all">
                        {{ row.errorMessage }}
                      </p>
                    </div>
                  }

                  <div class="flex items-center justify-between pt-1">
                    <span class="text-[11px] text-ink-faint font-mono">Report-ID: {{ row._id }}</span>
                    <button type="button" (click)="downloadJson(row)" class="text-xs text-ink hover:text-ink underline">
                      Als JSON herunterladen
                    </button>
                  </div>
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class BootstrapReportsComponent implements OnInit, OnDestroy {
  private api = inject(ApiService)

  loading = signal(false)
  rows = signal<BootstrapReportRow[]>([])
  expanded = signal<string | null>(null)

  private timer: ReturnType<typeof setInterval> | null = null

  async ngOnInit() {
    await this.reload()
    this.timer = setInterval(() => void this.reload(true), REFRESH_INTERVAL_MS)
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  toggleExpand(id: string) {
    this.expanded.update(prev => (prev === id ? null : id))
  }

  async reload(silent = false) {
    if (!silent) this.loading.set(true)
    try {
      const result = await this.api.find<BootstrapReportRow>('bootstrap-reports', {
        $sort: { startedAt: -1 },
        $limit: 20,
      })
      this.rows.set(Array.isArray(result.data) ? result.data : [])
    } catch {
      // silent fail
    } finally {
      this.loading.set(false)
    }
  }

  downloadJson(row: BootstrapReportRow) {
    const json = JSON.stringify(row, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bootstrap-report-${row._id}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  directionLabel(d: BootstrapReportDirection): string {
    return DIRECTION_LABEL[d] ?? d
  }

  asEntries(obj: Record<string, number> | undefined): Array<[string, number]> {
    if (!obj) return []
    return Object.entries(obj).sort((a, b) => b[1] - a[1])
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }
}
