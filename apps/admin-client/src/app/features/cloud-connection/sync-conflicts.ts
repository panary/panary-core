import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal, OnInit, computed } from '@angular/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

type SyncConflictStatus = 'open' | 'resolved'
type SyncConflictResolution = 'use-cloud' | 'use-edge' | 'discard'

interface SyncConflictRow {
  _id: string
  service: string
  edgeRecordId: string
  cloudRecordId?: string
  reason: 'external-id-mismatch' | 'external-id-missing' | 'ambiguous-name-match' | 'push-rejected'
  edgePayload?: Record<string, unknown>
  cloudPayload?: Record<string, unknown>
  status: SyncConflictStatus
  resolution?: SyncConflictResolution
  createdAt: string
}

const SERVICE_LABELS: Record<string, string> = {
  products: 'Produkte',
  'product-groups': 'Produktgruppen',
  pricelists: 'Preislisten',
  users: 'Personal',
  'corporate-customers': 'Firmenkunden',
}

const REASON_LABELS: Record<string, string> = {
  'external-id-mismatch': 'externalId-Konflikt',
  'external-id-missing': 'Keine externalId — manueller Match noetig',
  'ambiguous-name-match': 'Mehrdeutiger Name-Match',
  'push-rejected': 'Cloud lehnte Push ab',
}

@Component({
  selector: 'app-sync-conflicts',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-5xl space-y-4 h-full overflow-y-auto">
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold tracking-tight">Sync-Konflikte</h1>
          <p class="text-slate-500 dark:text-gray-400 text-sm mt-1">
            Records aus dem Bootstrap-Merge, die manuelle Entscheidung erfordern.
          </p>
        </div>
        <button (click)="reload()" class="text-slate-500 text-xs hover:text-slate-900">⟳ Aktualisieren</button>
      </header>

      @if (loading()) {
        <div class="flex items-center gap-3 py-12 justify-center">
          <span class="w-5 h-5 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin"></span>
          <span class="text-slate-400 text-sm">Lade Konflikte …</span>
        </div>
      } @else if (groupedByService().length === 0) {
        <div class="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p class="text-sm text-slate-500">Keine offenen Sync-Konflikte. Alles synchron.</p>
        </div>
      } @else {
        @for (group of groupedByService(); track group.service) {
          <section class="bg-white border border-gray-200 rounded-xl">
            <header class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 class="text-sm font-semibold">{{ labelForService(group.service) }}</h2>
              <span class="text-xs text-slate-500">{{ group.rows.length }} Konflikt{{ group.rows.length === 1 ? '' : 'e' }}</span>
            </header>
            @for (row of group.rows; track row._id) {
              <article class="border-b border-gray-100 last:border-b-0 px-4 py-3 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-xs uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                      {{ labelForReason(row.reason) }}
                    </span>
                    <span class="text-xs font-mono text-slate-400">{{ row.edgeRecordId.slice(0, 8) }}…</span>
                  </div>
                  <span class="text-xs text-slate-400">{{ formatDate(row.createdAt) }}</span>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="bg-slate-50 dark:bg-gray-900/40 rounded-lg p-3">
                    <p class="text-xs uppercase tracking-wider text-slate-500 mb-1">Edge (lokal)</p>
                    @if (row.edgePayload) {
                      <pre class="text-[11px] font-mono text-slate-700 dark:text-gray-200 whitespace-pre-wrap break-all">{{ shortJson(row.edgePayload) }}</pre>
                    } @else {
                      <p class="text-xs text-slate-400">—</p>
                    }
                  </div>
                  <div class="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3">
                    <p class="text-xs uppercase tracking-wider text-slate-500 mb-1">Cloud</p>
                    @if (row.cloudPayload) {
                      <pre class="text-[11px] font-mono text-slate-700 dark:text-gray-200 whitespace-pre-wrap break-all">{{ shortJson(row.cloudPayload) }}</pre>
                    } @else {
                      <p class="text-xs text-slate-400">— (kein Cloud-Pendant)</p>
                    }
                  </div>
                </div>

                <div class="flex items-center gap-2 pt-1">
                  @if (row.cloudPayload) {
                    <button (click)="resolve(row, 'use-cloud')" [disabled]="resolving() === row._id"
                      class="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50">
                      Cloud uebernehmen
                    </button>
                  }
                  <button (click)="resolve(row, 'use-edge')" [disabled]="resolving() === row._id"
                    class="bg-slate-900 text-white text-xs px-3 py-1.5 rounded-md hover:bg-slate-800 disabled:opacity-50">
                    Edge behalten + in Cloud anlegen
                  </button>
                  <button (click)="resolve(row, 'discard')" [disabled]="resolving() === row._id"
                    class="text-red-500 text-xs px-3 py-1.5 hover:underline disabled:opacity-50">
                    Verwerfen
                  </button>
                  @if (resolving() === row._id) {
                    <span class="text-xs text-slate-500">verarbeite …</span>
                  }
                </div>
              </article>
            }
          </section>
        }
      }

      @if (errors().length > 0) {
        <div class="bg-red-50 border border-red-200 rounded-lg p-3">
          @for (err of errors(); track err) {
            <p class="text-red-500 text-sm">✕ {{ err }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class SyncConflictsComponent implements OnInit {
  private api = inject(ApiService)
  private cdr = inject(ChangeDetectorRef)

  loading = signal(true)
  rows = signal<SyncConflictRow[]>([])
  errors = signal<string[]>([])
  resolving = signal<string | null>(null)

  groupedByService = computed(() => {
    const map = new Map<string, SyncConflictRow[]>()
    for (const r of this.rows()) {
      const list = map.get(r.service) ?? []
      list.push(r)
      map.set(r.service, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([service, rows]) => ({ service, rows }))
  })

  labelForService(s: string): string {
    return SERVICE_LABELS[s] ?? s
  }

  labelForReason(r: string): string {
    return REASON_LABELS[r] ?? r
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('de-DE')
    } catch {
      return iso
    }
  }

  shortJson(obj: unknown): string {
    if (!obj) return ''
    try {
      const json = JSON.stringify(obj, null, 2)
      return json.length > 500 ? json.slice(0, 500) + '…' : json
    } catch {
      return String(obj)
    }
  }

  async ngOnInit() {
    await this.reload()
  }

  async reload() {
    this.loading.set(true)
    this.errors.set([])
    try {
      const result = await this.api.find<SyncConflictRow>('sync-conflicts', { status: 'open', $sort: { createdAt: -1 } } as any)
      this.rows.set(result.data)
    } catch (e: any) {
      this.errors.set(formatApiError(e).split('\n'))
    }
    this.loading.set(false)
    this.cdr.markForCheck()
  }

  async resolve(row: SyncConflictRow, resolution: SyncConflictResolution) {
    this.resolving.set(row._id)
    try {
      await this.api.patch('sync-conflicts', row._id, { resolution } as any)
      this.rows.set(this.rows().filter(r => r._id !== row._id))
    } catch (e: any) {
      this.errors.set(formatApiError(e).split('\n'))
    }
    this.resolving.set(null)
    this.cdr.markForCheck()
  }
}
