import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core'

import { ApiService } from '../../core/api.service'

type SyncRunPhase = 'bootstrap' | 'push' | 'pull' | 'heartbeat' | 'reconcile'
type SyncRunDirection = 'edge-to-cloud' | 'cloud-to-edge'
type SyncRunOutcome = 'success' | 'partial' | 'failure'
type FilterMode = 'all' | 'pull' | 'push' | 'errors'

interface SyncRunRow {
  _id: string
  phase: SyncRunPhase
  direction: SyncRunDirection
  service: string | null
  recordCount: number
  accepted?: number
  rejected?: number
  archived?: number
  durationMs: number
  outcome: SyncRunOutcome
  errorMessage?: string
  triggeredBy: string
  startedAt: string
  finishedAt: string
}

const REFRESH_INTERVAL_MS = 30_000

const PHASE_LABEL: Record<SyncRunPhase, string> = {
  bootstrap: 'Bootstrap',
  push: 'Push',
  pull: 'Pull',
  heartbeat: 'Heartbeat',
  reconcile: 'Reconcile',
}

const DIRECTION_LABEL: Record<SyncRunDirection, string> = {
  'edge-to-cloud': '→ Cloud',
  'cloud-to-edge': '← Cloud',
}

const SERVICE_LABEL: Record<string, string> = {
  users: 'Personal',
  products: 'Produkte',
  'product-groups': 'Produktgruppen',
  customers: 'Kunden',
  'corporate-customers': 'Firmenkunden',
  orders: 'Bestellungen',
  'order-interactions': 'Order-Interaktionen',
  'working-times': 'Arbeitszeiten',
}

@Component({
  selector: 'app-sync-history',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl flex flex-col">
      <header class="px-4 py-3 border-b border-slate-200 dark:border-gray-800 flex items-center justify-between flex-none">
        <div>
          <h2 class="text-sm font-semibold">Sync-Historie</h2>
          @if (lastRunAt(); as last) {
            <p class="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Letzter Sync: {{ formatRelative(last) }}</p>
          } @else {
            <p class="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Noch keine Sync-Vorgaenge.</p>
          }
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center bg-slate-100 dark:bg-gray-800 rounded-lg p-0.5 text-xs">
            @for (m of filterModes; track m.value) {
              <button
                type="button"
                (click)="setFilter(m.value)"
                [class.bg-white]="filter() === m.value"
                [class.dark:bg-gray-700]="filter() === m.value"
                [class.shadow-sm]="filter() === m.value"
                [class.text-slate-900]="filter() === m.value"
                [class.dark:text-white]="filter() === m.value"
                [class.text-slate-500]="filter() !== m.value"
                [class.dark:text-gray-400]="filter() !== m.value"
                class="px-2.5 py-1 rounded-md transition">
                {{ m.label }}
              </button>
            }
          </div>
          <button
            (click)="reload()"
            class="text-slate-500 dark:text-gray-400 text-xs hover:text-slate-900 dark:hover:text-white px-2 py-1"
            [disabled]="loading()"
            title="Aktualisieren">
            ⟳
          </button>
        </div>
      </header>

      @if (loading() && rows().length === 0) {
        <div class="flex items-center gap-3 py-10 justify-center">
          <span class="w-5 h-5 border-2 border-slate-300 dark:border-gray-600 border-t-slate-900 dark:border-t-white rounded-full animate-spin"></span>
          <span class="text-slate-400 dark:text-gray-500 text-sm">Lade Historie …</span>
        </div>
      } @else if (total() === 0) {
        <div class="px-4 py-8 text-center">
          <p class="text-sm text-slate-500 dark:text-gray-400">
            @if (filter() === 'all') {
              Noch keine fachlich relevanten Sync-Vorgaenge protokolliert.
            } @else {
              Keine Eintraege fuer diesen Filter.
            }
          </p>
        </div>
      } @else {
        <div class="overflow-auto" style="max-height: 480px">
          <table class="w-full text-xs">
            <thead class="bg-slate-50 dark:bg-gray-900/40 text-slate-500 dark:text-gray-400 uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Zeit</th>
                <th class="text-left px-3 py-2 font-medium">Phase</th>
                <th class="text-left px-3 py-2 font-medium">Service</th>
                <th class="text-left px-3 py-2 font-medium">Richtung</th>
                <th class="text-right px-3 py-2 font-medium">Records</th>
                <th class="text-right px-3 py-2 font-medium">Dauer</th>
                <th class="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-gray-800">
              @for (row of pagedRows(); track row._id) {
                <tr class="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                  <td class="px-4 py-2 text-slate-700 dark:text-gray-200 whitespace-nowrap">
                    {{ formatDate(row.startedAt) }}
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-gray-200">
                    <span class="font-medium">{{ phaseLabel(row.phase) }}</span>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-gray-200">
                    {{ serviceLabel(row.service) }}
                  </td>
                  <td class="px-3 py-2 font-mono text-slate-500 dark:text-gray-400">{{ directionLabel(row.direction) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-gray-200">
                    {{ row.recordCount }}
                    @if (row.rejected && row.rejected > 0) {
                      <span class="text-red-600 dark:text-red-400 ml-1">({{ row.rejected }} rej.)</span>
                    }
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-gray-400">{{ row.durationMs }}ms</td>
                  <td class="px-4 py-2">
                    @switch (row.outcome) {
                      @case ('success') {
                        <span class="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40 px-2 py-0.5 rounded text-[11px]">OK</span>
                      }
                      @case ('partial') {
                        <span class="inline-flex items-center gap-1 text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40 px-2 py-0.5 rounded text-[11px]">Teilweise</span>
                      }
                      @case ('failure') {
                        <span
                          class="inline-flex items-center gap-1 text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40 px-2 py-0.5 rounded text-[11px]"
                          [title]="row.errorMessage || ''">
                          Fehler
                        </span>
                      }
                    }
                  </td>
                </tr>
                @if (row.errorMessage) {
                  <tr class="bg-red-50/30 dark:bg-red-950/20">
                    <td colspan="7" class="px-4 py-2 text-[11px] text-red-700 dark:text-red-300 font-mono">
                      ↳ {{ row.errorMessage }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <footer class="px-4 py-2 border-t border-slate-200 dark:border-gray-800 flex items-center justify-between text-xs text-slate-600 dark:text-gray-400 flex-none">
          <div>
            {{ rangeLabel() }}
            @if (loading()) {
              <span class="ml-2 inline-flex items-center gap-1 text-slate-400 dark:text-gray-500">
                <span class="w-3 h-3 border border-slate-300 dark:border-gray-600 border-t-slate-700 dark:border-t-white rounded-full animate-spin"></span>
                Laden …
              </span>
            }
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              (click)="goToPage(1)"
              [disabled]="page() === 1 || loading()"
              class="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Erste Seite">
              «
            </button>
            <button
              type="button"
              (click)="goToPage(page() - 1)"
              [disabled]="page() === 1 || loading()"
              class="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Vorige Seite">
              ‹
            </button>
            <span class="px-2 tabular-nums">
              Seite {{ page() }} / {{ totalPages() }}
            </span>
            <button
              type="button"
              (click)="goToPage(page() + 1)"
              [disabled]="page() >= totalPages() || loading()"
              class="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Naechste Seite">
              ›
            </button>
            <button
              type="button"
              (click)="goToPage(totalPages())"
              [disabled]="page() >= totalPages() || loading()"
              class="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Letzte Seite">
              »
            </button>
          </div>
        </footer>
      }
    </section>
  `,
})
export class SyncHistoryComponent implements OnInit, OnDestroy {
  private api = inject(ApiService)

  loading = signal(false)
  rows = signal<SyncRunRow[]>([])
  total = signal(0)
  page = signal(1)
  filter = signal<FilterMode>('all')

  readonly pageSize = 25

  filterModes: Array<{ value: FilterMode; label: string }> = [
    { value: 'all', label: 'Alle' },
    { value: 'pull', label: 'Pull' },
    { value: 'push', label: 'Push' },
    { value: 'errors', label: 'Fehler' },
  ]

  // Filterung passiert auf der Server-Seite ueber Query-Parameter, damit
  // recordCount/Total konsistent mit dem aktiven Filter sind. Hier wird
  // die geladene Page direkt durchgereicht.
  pagedRows = computed(() => this.rows())

  totalPages = computed(() => {
    const t = this.total()
    if (t <= 0) return 1
    return Math.max(1, Math.ceil(t / this.pageSize))
  })

  rangeLabel = computed(() => {
    const t = this.total()
    if (t === 0) return '0 Eintraege'
    const from = (this.page() - 1) * this.pageSize + 1
    const to = Math.min(this.page() * this.pageSize, t)
    return `${from}–${to} von ${t}`
  })

  lastRunAt = computed(() => {
    // Bei page=1 ist row[0] der neueste Eintrag. Auf Folgeseiten zeigt der
    // Header-"Letzter Sync"-Vermerk nicht zwingend den globalen letzten Run —
    // pragmatisch akzeptiert: Header bleibt korrekt nach jedem Reload (page=1).
    const list = this.rows()
    return list.length > 0 ? list[0].startedAt : null
  })

  private timer: ReturnType<typeof setInterval> | null = null

  async ngOnInit() {
    await this.reload()
    this.timer = setInterval(() => void this.reload(true), REFRESH_INTERVAL_MS)
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  setFilter(mode: FilterMode) {
    this.filter.set(mode)
    this.page.set(1)
    void this.reload()
  }

  goToPage(target: number) {
    const clamped = Math.max(1, Math.min(target, this.totalPages()))
    if (clamped === this.page()) return
    this.page.set(clamped)
    void this.reload()
  }

  async reload(silent = false) {
    if (!silent) this.loading.set(true)
    try {
      const skip = (this.page() - 1) * this.pageSize
      const baseQuery: Record<string, unknown> = {
        $sort: { startedAt: -1 },
        $limit: this.pageSize,
        $skip: skip,
      }
      const filterQuery = this.buildFilterQuery()
      const result = await this.api.find<SyncRunRow>('sync-runs', { ...baseQuery, ...filterQuery })
      const list = Array.isArray(result.data) ? result.data : []
      this.rows.set(list)
      this.total.set(result.total ?? list.length)
      // Falls die aktuelle Seite jenseits der jetzt vorhandenen Daten liegt
      // (z. B. Filter wechselte und reduziert die Treffer), zurueck auf die
      // letzte gueltige Seite.
      const maxPage = this.totalPages()
      if (this.page() > maxPage) {
        this.page.set(maxPage)
        await this.reload(silent)
      }
    } catch {
      // Silent fail — UI bleibt mit bisherigen Daten stehen.
    } finally {
      this.loading.set(false)
    }
  }

  private buildFilterQuery(): Record<string, unknown> {
    // Der Edge-`sync-runs`-Service-Validator erlaubt `$or` nicht (das laesst
    // der TypeBox-Query-Schema mit `additionalProperties: false` blocken).
    // Fuer Push/Pull filtern wir deshalb pragmatisch ueber `direction` —
    // bootstrap-Eintraege haben dieselbe direction und werden so mit-erfasst,
    // ohne dass wir $or brauchen.
    const mode = this.filter()
    if (mode === 'all') return {}
    if (mode === 'errors') {
      return { outcome: { $ne: 'success' } }
    }
    if (mode === 'push') {
      return { direction: 'edge-to-cloud' }
    }
    if (mode === 'pull') {
      return { direction: 'cloud-to-edge' }
    }
    return {}
  }

  phaseLabel(p: SyncRunPhase): string {
    return PHASE_LABEL[p] ?? p
  }

  directionLabel(d: SyncRunDirection): string {
    return DIRECTION_LABEL[d] ?? d
  }

  serviceLabel(s: string | null): string {
    if (!s) return '—'
    return SERVICE_LABEL[s] ?? s
  }

  formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  formatRelative(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime()
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return `vor ${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `vor ${min}min`
    const h = Math.floor(min / 60)
    if (h < 24) return `vor ${h}h`
    const days = Math.floor(h / 24)
    return `vor ${days}d`
  }
}
