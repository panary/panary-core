import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit, signal } from '@angular/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { SyncProblemCountService } from '../../core/sync-problem-count.service'

type SyncConflictStatus = 'open' | 'resolved'
type SyncConflictResolution = 'use-cloud' | 'use-edge' | 'discard'

interface SyncConflictRow {
  _id: string
  service: string
  edgeRecordId: string
  cloudRecordId?: string
  reason:
    | 'external-id-mismatch'
    | 'external-id-missing'
    | 'ambiguous-name-match'
    | 'push-rejected'
    | 'push-forbidden'
    | 'push-concurrent-write'
  edgePayload?: Record<string, unknown>
  cloudPayload?: Record<string, unknown>
  status: SyncConflictStatus
  resolution?: SyncConflictResolution
  createdAt: string
}

// Outbox-Row Read-Model — `SyncOutboxEntry` aus dem Schema, hier lokal
// dupliziert um keinen Import auf den Workspace-Root brauchen zu muessen.
interface SyncOutboxRow {
  _id: string
  service: string
  op: 'create' | 'patch' | 'remove'
  entityId: string
  payload?: unknown
  occurredAt: string
  status: 'pending' | 'in-flight' | 'acked' | 'rejected'
  attempts: number
  lastAttemptAt?: string
  nextAttemptAt?: string
  lastError?: string
  terminalAt?: string
  linkedConflictId?: string
  createdAt: string
}

type TabKey = 'all' | 'retrying' | 'rejected' | 'conflicts'

const SERVICE_LABELS: Record<string, string> = {
  products: 'Produkte',
  'product-groups': 'Produktgruppen',
  pricelists: 'Preislisten',
  users: 'Personal',
  'corporate-customers': 'Firmenkunden',
  orders: 'Bestellungen',
  'order-interactions': 'Bestellaenderungen',
  'working-times': 'Arbeitszeiten',
  'audit-events': 'Audit-Eintraege',
}

const REASON_LABELS: Record<string, string> = {
  'external-id-mismatch': 'externalId-Konflikt',
  'external-id-missing': 'Keine externalId — manueller Match noetig',
  'ambiguous-name-match': 'Mehrdeutiger Name-Match',
  'push-rejected': 'Cloud lehnte Push wiederholt ab',
  'push-forbidden': 'Tenant-/Berechtigungs-Konflikt',
  'push-concurrent-write': 'Gleichzeitig an zwei Stellen geaendert',
}

const OP_LABELS: Record<string, string> = {
  create: 'angelegt',
  patch: 'geaendert',
  remove: 'geloescht',
}

const labelForService = (service: string): string => SERVICE_LABELS[service] ?? service

/**
 * Rejects, die durch eine fixe Cloud-Policy entstehen (z.B. tenant:owner-User
 * werden vom Cloud-Receiver bewusst abgewiesen). „Erneut versuchen" hilft
 * hier nie — der Operator sollte den Eintrag verwerfen oder die Aktion in
 * der Cloud-Admin-UI nachholen.
 */
const isPolicyBlockedReject = (row: SyncOutboxRow): boolean => {
  const err = row.lastError ?? ''
  return err.includes('Cloud verwaltet diese Rolle selbst') || err.includes('user_role_blocked')
}

const problemText = (row: SyncOutboxRow): string => {
  const err = row.lastError ?? ''
  if (isPolicyBlockedReject(row))
    return 'Diese Daten werden zentral in der Online-Datenbank gepflegt und nicht von hier aus hochgeladen.'
  if (err.includes('additionalProperties')) return 'Daten-Format wird von der Cloud nicht akzeptiert'
  if (err.includes('validation failed')) return 'Daten-Format wird von der Cloud nicht akzeptiert'
  if (err.includes('fetch failed') || err.includes('ECONNREFUSED'))
    return 'Cloud zeitweise nicht erreichbar'
  if (err.includes('No record found')) return 'Cloud-Datensatz nicht (mehr) vorhanden'
  return err.length > 100 ? err.slice(0, 98) + '…' : err || 'Nicht hochgeladen'
}

const isRetryOnCooldown = (row: SyncOutboxRow): boolean => {
  if ((row.attempts ?? 0) < 3) return false
  if (!row.lastAttemptAt) return false
  return Date.now() - new Date(row.lastAttemptAt).getTime() < 5 * 60_000
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
          <h1 class="text-xl font-bold tracking-tight">Sync-Status</h1>
          <p class="text-slate-500 dark:text-gray-400 text-sm mt-1">
            Datenabgleich zwischen diesem Standort und der Online-Datenbank.
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (rejectedRows().length > 1) {
            <button
              (click)="retryAllRejected()"
              [disabled]="bulkBusy()"
              class="bg-slate-900 dark:bg-white dark:text-slate-900 text-white text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
              title="Alle abgelehnten Eintraege erneut zum Hochladen freigeben"
            >
              Alle erneut versuchen ({{ rejectedRows().length }})
            </button>
          }
          <button
            (click)="reload()"
            [disabled]="loading()"
            class="text-slate-500 text-xs hover:text-slate-900 disabled:opacity-50"
          >
            ⟳ Aktualisieren
          </button>
        </div>
      </header>

      <!-- Tab-Switcher -->
      <div class="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
        @for (tab of tabs; track tab.key) {
          <button
            type="button"
            (click)="activeTab.set(tab.key)"
            [class.text-slate-900]="activeTab() === tab.key"
            [class.dark:text-white]="activeTab() === tab.key"
            [class.border-slate-900]="activeTab() === tab.key"
            [class.dark:border-white]="activeTab() === tab.key"
            class="text-xs px-3 py-2 border-b-2 border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            {{ tab.label }} <span class="ml-1 opacity-60">{{ countFor(tab.key) }}</span>
          </button>
        }
      </div>

      @if (loading()) {
        <div class="flex items-center gap-3 py-12 justify-center">
          <span
            class="w-5 h-5 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin"
          ></span>
          <span class="text-slate-400 text-sm">Lade Sync-Status …</span>
        </div>
      } @else if (filteredItems().length === 0) {
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <p class="text-2xl mb-2">✓</p>
          <p class="text-sm text-slate-700 dark:text-gray-200 font-medium">Alles synchron</p>
          <p class="text-xs text-slate-500 mt-1">
            Keine ausstehenden Sync-Probleme zwischen diesem Standort und der Online-Datenbank.
          </p>
        </div>
      } @else {
        <!-- In Wiederholung (transiente Rejects im Backoff) -->
        @if (showRetrying()) {
          @for (row of retryingRows(); track row._id) {
            <article class="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-xs uppercase tracking-wider text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded">
                    In Wiederholung
                  </span>
                  <span class="text-sm font-medium">
                    {{ labelForServiceX(row.service) }} {{ opLabel(row.op) }}
                  </span>
                  <span class="text-xs font-mono text-slate-400">{{ row.entityId.slice(0, 8) }}…</span>
                </div>
                <span class="text-xs text-slate-400">Versuch {{ row.attempts }}/10 · nächster: {{ formatDate(row.nextAttemptAt) }}</span>
              </div>

              <p class="text-sm text-slate-600 dark:text-gray-300">{{ problemDescription(row) }}</p>

              @if (row.lastError) {
                <details class="text-xs">
                  <summary class="cursor-pointer text-slate-500 hover:text-slate-900">
                    Technische Details ({{ row.attempts }} Versuche)
                  </summary>
                  <pre class="mt-2 font-mono text-[11px] bg-slate-50 dark:bg-gray-950 rounded p-2 overflow-auto whitespace-pre-wrap break-all">{{ row.lastError }}</pre>
                </details>
              }

              <div class="flex items-center gap-2 pt-1">
                <button
                  (click)="forceRetryNow(row)"
                  [disabled]="rowBusy() === row._id"
                  title="Sofort erneut versuchen, ohne auf den Backoff zu warten"
                  class="bg-slate-900 dark:bg-white dark:text-slate-900 text-white text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-40"
                >
                  Jetzt erneut versuchen
                </button>
                <button
                  (click)="discardRetrying(row)"
                  [disabled]="rowBusy() === row._id"
                  class="text-red-500 text-xs px-3 py-1.5 hover:underline disabled:opacity-50"
                >
                  Verwerfen
                </button>
                @if (rowBusy() === row._id) {
                  <span class="text-xs text-slate-500">verarbeite …</span>
                }
              </div>
            </article>
          }
        }

        <!-- Rejected Outbox (Nicht hochgeladen) -->
        @if (showRejected()) {
          @for (row of rejectedRows(); track row._id) {
            <article class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-xs uppercase tracking-wider text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded">
                    Nicht hochgeladen
                  </span>
                  <span class="text-sm font-medium">
                    {{ labelForServiceX(row.service) }} {{ opLabel(row.op) }}
                  </span>
                  <span class="text-xs font-mono text-slate-400">{{ row.entityId.slice(0, 8) }}…</span>
                </div>
                <span class="text-xs text-slate-400">{{ formatDate(row.terminalAt ?? row.occurredAt) }}</span>
              </div>

              <p class="text-sm text-slate-600 dark:text-gray-300">{{ problemDescription(row) }}</p>

              @if (isPolicyBlocked(row)) {
                <!-- Erklaerender Banner fuer Policy-blockierte Rejects (z.B.
                     tenant:owner-User). Verhindert Support-Anfragen, weil
                     „Erneut versuchen" hier nie helfen wird — die Cloud lehnt
                     die Daten grundsaetzlich ab, da sie zentral verwaltet
                     werden. Verwerfen ist die richtige Aktion. -->
                <div class="flex gap-3 text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-md p-3">
                  <span class="text-amber-700 dark:text-amber-300 text-base leading-none">ⓘ</span>
                  <div class="space-y-1 text-amber-900 dark:text-amber-100">
                    <p class="font-medium">Das ist kein Fehler — sondern eine Sicherheitsregel.</p>
                    <p>
                      Bestimmte Datentypen (z.B. <strong>Inhaber-Konten</strong>) werden
                      ausschliesslich im Online-Admin-Bereich gepflegt — nicht von hier
                      aus. Anpassungen bitte direkt im Cloud-Admin durchfuehren. Diesen
                      Eintrag kannst du gefahrlos verwerfen — er bleibt lokal erhalten.
                    </p>
                  </div>
                </div>
              }

              @if (row.lastError) {
                <details class="text-xs">
                  <summary class="cursor-pointer text-slate-500 hover:text-slate-900">
                    Technische Details ({{ row.attempts }} Versuche)
                  </summary>
                  <pre class="mt-2 font-mono text-[11px] bg-slate-50 dark:bg-gray-950 rounded p-2 overflow-auto whitespace-pre-wrap break-all">{{ row.lastError }}</pre>
                  @if (row.payload) {
                    <p class="text-slate-500 mt-2 mb-1 uppercase tracking-wider">Payload</p>
                    <pre class="font-mono text-[11px] bg-slate-50 dark:bg-gray-950 rounded p-2 overflow-auto whitespace-pre-wrap break-all max-h-60">{{ shortJson(row.payload) }}</pre>
                  }
                </details>
              }

              <div class="flex items-center gap-2 pt-1">
                <button
                  (click)="retryRejected(row)"
                  [disabled]="rowBusy() === row._id || retryDisabled(row)"
                  [title]="
                    isPolicyBlocked(row)
                      ? 'Diese Daten werden zentral in der Online-Datenbank gepflegt — Hochladen ist hier nicht moeglich.'
                      : retryDisabled(row)
                        ? 'Server lehnt diese Daten wiederholt ab. Warte oder kontaktiere den Support.'
                        : 'Push erneut versuchen mit der urspruenglich gespeicherten Payload'
                  "
                  class="bg-slate-900 dark:bg-white dark:text-slate-900 text-white text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-40"
                >
                  Erneut versuchen
                </button>
                <button
                  (click)="reEnqueueRejected(row)"
                  [disabled]="rowBusy() === row._id || isPolicyBlocked(row)"
                  [title]="
                    isPolicyBlocked(row)
                      ? 'Diese Daten werden zentral in der Online-Datenbank gepflegt — Hochladen ist hier nicht moeglich.'
                      : 'Aktuellen lokalen Stand frisch synchronisieren (laedt den Datensatz neu und stellt ihn in die Warteschlange)'
                  "
                  class="bg-emerald-700 dark:bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-40"
                >
                  Erneut einreihen
                </button>
                <button
                  (click)="discardRejected(row)"
                  [disabled]="rowBusy() === row._id"
                  title="Sync-Eintrag verwerfen. Der lokale Datensatz bleibt erhalten, wird aber nicht in die Online-Datenbank synchronisiert."
                  class="text-red-500 text-xs px-3 py-1.5 hover:underline disabled:opacity-50"
                >
                  Verwerfen
                </button>
                @if (rowBusy() === row._id) {
                  <span class="text-xs text-slate-500">verarbeite …</span>
                }
              </div>
            </article>
          }
        }

        <!-- Konflikte -->
        @if (showConflicts()) {
          @for (group of conflictsGroupedByService(); track group.service) {
            <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <header class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h2 class="text-sm font-semibold">{{ labelForServiceX(group.service) }}</h2>
                <span class="text-xs text-slate-500">
                  {{ group.rows.length }} Konflikt{{ group.rows.length === 1 ? '' : 'e' }}
                </span>
              </header>
              @for (row of group.rows; track row._id) {
                <article class="border-b border-gray-100 dark:border-gray-800 last:border-b-0 px-4 py-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="text-xs uppercase tracking-wider text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded">
                        {{ labelForReason(row.reason) }}
                      </span>
                      <span class="text-xs font-mono text-slate-400">{{ row.edgeRecordId.slice(0, 8) }}…</span>
                    </div>
                    <span class="text-xs text-slate-400">{{ formatDate(row.createdAt) }}</span>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="bg-slate-50 dark:bg-gray-900/40 rounded-lg p-3">
                      <p class="text-xs uppercase tracking-wider text-slate-500 mb-1">Dieser Standort</p>
                      @if (row.edgePayload) {
                        <pre class="text-[11px] font-mono text-slate-700 dark:text-gray-200 whitespace-pre-wrap break-all">{{ shortJson(row.edgePayload) }}</pre>
                      } @else {
                        <p class="text-xs text-slate-400">—</p>
                      }
                    </div>
                    <div class="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3">
                      <p class="text-xs uppercase tracking-wider text-slate-500 mb-1">Online-Datenbank</p>
                      @if (row.cloudPayload) {
                        <pre class="text-[11px] font-mono text-slate-700 dark:text-gray-200 whitespace-pre-wrap break-all">{{ shortJson(row.cloudPayload) }}</pre>
                      } @else {
                        <p class="text-xs text-slate-400">— (kein Cloud-Pendant)</p>
                      }
                    </div>
                  </div>

                  <div class="flex items-center gap-2 pt-1">
                    @if (row.cloudPayload) {
                      <button
                        (click)="resolveConflict(row, 'use-cloud')"
                        [disabled]="rowBusy() === row._id"
                        class="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        Online-Version uebernehmen
                      </button>
                    }
                    <button
                      (click)="resolveConflict(row, 'use-edge')"
                      [disabled]="rowBusy() === row._id"
                      class="bg-slate-900 dark:bg-white dark:text-slate-900 text-white text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
                    >
                      Diesen Standort behalten
                    </button>
                    <button
                      (click)="resolveConflict(row, 'discard')"
                      [disabled]="rowBusy() === row._id"
                      class="text-red-500 text-xs px-3 py-1.5 hover:underline disabled:opacity-50"
                    >
                      Verwerfen
                    </button>
                    @if (rowBusy() === row._id) {
                      <span class="text-xs text-slate-500">verarbeite …</span>
                    }
                  </div>
                </article>
              }
            </section>
          }
        }
      }

      @if (errors().length > 0) {
        <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3">
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
  private syncProblemCount = inject(SyncProblemCountService)

  protected readonly loading = signal(true)
  protected readonly rejectedRows = signal<SyncOutboxRow[]>([])
  protected readonly retryingRows = signal<SyncOutboxRow[]>([])
  protected readonly conflicts = signal<SyncConflictRow[]>([])
  protected readonly errors = signal<string[]>([])
  protected readonly rowBusy = signal<string | null>(null)
  protected readonly bulkBusy = signal(false)
  protected readonly activeTab = signal<TabKey>('all')

  protected readonly tabs: ReadonlyArray<{ key: TabKey; label: string }> = [
    { key: 'all', label: 'Alle' },
    { key: 'retrying', label: 'In Wiederholung' },
    { key: 'rejected', label: 'Nicht hochgeladen' },
    { key: 'conflicts', label: 'Datenkonflikte' },
  ]

  protected readonly showRetrying = computed(() =>
    this.activeTab() === 'all' || this.activeTab() === 'retrying',
  )
  protected readonly showRejected = computed(() =>
    this.activeTab() === 'all' || this.activeTab() === 'rejected',
  )
  protected readonly showConflicts = computed(() =>
    this.activeTab() === 'all' || this.activeTab() === 'conflicts',
  )

  protected readonly filteredItems = computed(() => {
    const items: Array<{ kind: 'retrying' | 'rejected' | 'conflict'; id: string }> = []
    if (this.showRetrying()) {
      this.retryingRows().forEach(r => items.push({ kind: 'retrying', id: r._id }))
    }
    if (this.showRejected()) {
      this.rejectedRows().forEach(r => items.push({ kind: 'rejected', id: r._id }))
    }
    if (this.showConflicts()) {
      this.conflicts().forEach(c => items.push({ kind: 'conflict', id: c._id }))
    }
    return items
  })

  protected readonly conflictsGroupedByService = computed(() => {
    const map = new Map<string, SyncConflictRow[]>()
    for (const r of this.conflicts()) {
      const list = map.get(r.service) ?? []
      list.push(r)
      map.set(r.service, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([service, rows]) => ({ service, rows }))
  })

  protected countFor(tab: TabKey): number {
    switch (tab) {
      case 'retrying':
        return this.retryingRows().length
      case 'rejected':
        return this.rejectedRows().length
      case 'conflicts':
        return this.conflicts().length
      default:
        return this.retryingRows().length + this.rejectedRows().length + this.conflicts().length
    }
  }

  protected labelForServiceX(s: string): string {
    return labelForService(s)
  }

  protected labelForReason(r: string): string {
    return REASON_LABELS[r] ?? r
  }

  protected opLabel(op: string): string {
    return OP_LABELS[op] ?? op
  }

  protected problemDescription(row: SyncOutboxRow): string {
    return problemText(row)
  }

  /**
   * Hinweis-Banner-Sichtbarkeit fuer Policy-blockierte Rejects. Wenn `true`,
   * blendet das Template eine erklaerende Info-Box ein UND deaktiviert
   * „Erneut versuchen" — Retry hilft hier nie, weil die Cloud diese Daten
   * grundsaetzlich nicht annimmt.
   */
  protected isPolicyBlocked(row: SyncOutboxRow): boolean {
    return isPolicyBlockedReject(row)
  }

  protected retryDisabled(row: SyncOutboxRow): boolean {
    return isRetryOnCooldown(row) || isPolicyBlockedReject(row)
  }

  protected formatDate(iso: string | undefined): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('de-DE')
    } catch {
      return iso
    }
  }

  protected shortJson(obj: unknown): string {
    if (!obj) return ''
    try {
      const parsed = typeof obj === 'string' ? JSON.parse(obj) : obj
      const json = JSON.stringify(parsed, null, 2)
      return json.length > 800 ? json.slice(0, 800) + '…' : json
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
      // Sort ueber `_id` (uuidv7 = chronologisch). Funktional identisch zu
      // createdAt/terminalAt-Sort, aber `_id` ist in beiden Query-Property-
      // Whitelists garantiert vorhanden — andere Felder wuerden je nach
      // Server-Version mit „additionalProperties" abgelehnt.
      const now = new Date().toISOString()
      const [outbox, retrying, conflicts] = await Promise.all([
        this.api
          .find<SyncOutboxRow>('sync-outbox', {
            status: 'rejected',
            $sort: { _id: -1 },
            $limit: 200,
          } as Record<string, unknown>)
          .catch(err => {
            this.errors.update(arr => [...arr, `Outbox: ${formatApiError(err)}`])
            return { data: [] as SyncOutboxRow[] } as { data: SyncOutboxRow[] }
          }),
        // „In Wiederholung": pending mit nextAttemptAt in der Zukunft = im
        // Backoff (mind. ein Fehlversuch). Frisch-pending (nie versucht) hat
        // nextAttemptAt in der Vergangenheit und wird hier bewusst NICHT
        // gezeigt. Identische Semantik wie der Dashboard-Retry-Counter.
        this.api
          .find<SyncOutboxRow>('sync-outbox', {
            status: 'pending',
            nextAttemptAt: { $gt: now },
            $sort: { _id: -1 },
            $limit: 200,
          } as Record<string, unknown>)
          .catch(err => {
            this.errors.update(arr => [...arr, `Wiederholungen: ${formatApiError(err)}`])
            return { data: [] as SyncOutboxRow[] } as { data: SyncOutboxRow[] }
          }),
        this.api
          .find<SyncConflictRow>('sync-conflicts', {
            status: 'open',
            $sort: { _id: -1 },
          } as Record<string, unknown>)
          .catch(err => {
            this.errors.update(arr => [...arr, `Konflikte: ${formatApiError(err)}`])
            return { data: [] as SyncConflictRow[] } as { data: SyncConflictRow[] }
          }),
      ])
      this.rejectedRows.set(outbox.data)
      this.retryingRows.set(retrying.data)
      this.conflicts.set(conflicts.data)
    } finally {
      this.loading.set(false)
      this.cdr.markForCheck()
    }
  }

  /**
   * Retry-Patch fuer einen Outbox-Eintrag. `null` wird vom Schema
   * (`Type.Optional(Type.String())`) abgelehnt — daher die alten
   * lastError/terminalAt/linkedConflictId-Felder einfach weglassen. Worker
   * ueberschreibt sie beim naechsten Push-Ergebnis. status='pending' +
   * attempts=0 + nextAttemptAt='in der Vergangenheit' reicht damit der
   * Worker den Eintrag sofort wieder zieht.
   */
  private async patchRetry(row: SyncOutboxRow): Promise<void> {
    await this.api.patch('sync-outbox', row._id, {
      status: 'pending',
      attempts: 0,
      nextAttemptAt: row.occurredAt,
    } as Record<string, unknown>)
  }

  async retryRejected(row: SyncOutboxRow) {
    if (this.retryDisabled(row)) return
    this.rowBusy.set(row._id)
    try {
      await this.patchRetry(row)
      this.rejectedRows.update(rows => rows.filter(r => r._id !== row._id))
      this.syncProblemCount.refresh()
    } catch (err) {
      this.errors.update(arr => [...arr, formatApiError(err)])
    } finally {
      this.rowBusy.set(null)
      this.cdr.markForCheck()
    }
  }

  /** „Jetzt erneut versuchen" fuer einen im Backoff wartenden Eintrag —
   *  macht ihn sofort faellig (patchRetry setzt nextAttemptAt in die
   *  Vergangenheit + attempts=0). */
  async forceRetryNow(row: SyncOutboxRow) {
    this.rowBusy.set(row._id)
    try {
      await this.patchRetry(row)
      this.retryingRows.update(rows => rows.filter(r => r._id !== row._id))
      this.syncProblemCount.refresh()
    } catch (err) {
      this.errors.update(arr => [...arr, formatApiError(err)])
    } finally {
      this.rowBusy.set(null)
      this.cdr.markForCheck()
    }
  }

  async discardRetrying(row: SyncOutboxRow) {
    if (!confirm(`Eintrag verwerfen?\n\nDieser ${labelForService(row.service)}-Datensatz bleibt nur an diesem Standort gespeichert und wird NICHT in die Online-Datenbank uebernommen. Diese Aktion kann nicht rueckgaengig gemacht werden.`)) return
    this.rowBusy.set(row._id)
    try {
      await this.api.remove('sync-outbox', row._id)
      this.retryingRows.update(rows => rows.filter(r => r._id !== row._id))
      this.syncProblemCount.refresh()
    } catch (err) {
      this.errors.update(arr => [...arr, formatApiError(err)])
    } finally {
      this.rowBusy.set(null)
      this.cdr.markForCheck()
    }
  }

  async discardRejected(row: SyncOutboxRow) {
    if (!confirm(`Eintrag verwerfen?\n\nDieser ${labelForService(row.service)}-Datensatz bleibt nur an diesem Standort gespeichert und wird NICHT in die Online-Datenbank uebernommen. Diese Aktion kann nicht rueckgaengig gemacht werden.`)) return
    this.rowBusy.set(row._id)
    try {
      await this.api.remove('sync-outbox', row._id)
      this.rejectedRows.update(rows => rows.filter(r => r._id !== row._id))
      this.syncProblemCount.refresh()
    } catch (err) {
      this.errors.update(arr => [...arr, formatApiError(err)])
    } finally {
      this.rowBusy.set(null)
      this.cdr.markForCheck()
    }
  }

  /**
   * Stellt den AKTUELLEN Stand des lokalen Datensatzes als frischen pending-
   * Outbox-Eintrag in die Sync-Schlange. Unterschied zu `retryRejected`:
   *   - retryRejected schickt die alte (abgelehnte) Payload erneut — sinnvoll
   *     bei transienten Fehlern (Netzwerk, Cloud-Outage), die spaeter als
   *     terminal eskaliert wurden.
   *   - reEnqueueRejected laedt den Edge-Record neu und pusht den AKTUELLEN
   *     Stand — sinnvoll bei Schema-Mismatch, wenn der Operator den lokalen
   *     Datensatz inzwischen korrigiert hat.
   * Die alte rejected-Row wird serverseitig entfernt, sobald die neue pending-
   * Row angelegt ist.
   */
  async reEnqueueRejected(row: SyncOutboxRow) {
    if (this.isPolicyBlocked(row)) return
    const label = labelForService(row.service)
    if (!confirm(`Aktuellen ${label}-Datensatz erneut in die Online-Datenbank uebernehmen?\n\nDer lokale Stand wird frisch geladen und neu in die Sync-Warteschlange gestellt.`)) return
    this.rowBusy.set(row._id)
    try {
      await this.api.customMethod<SyncOutboxRow>('sync-outbox', 'reEnqueue', { id: row._id })
      this.rejectedRows.update(rows => rows.filter(r => r._id !== row._id))
      this.syncProblemCount.refresh()
    } catch (err) {
      this.errors.update(arr => [...arr, formatApiError(err)])
    } finally {
      this.rowBusy.set(null)
      this.cdr.markForCheck()
    }
  }

  async retryAllRejected() {
    const count = this.rejectedRows().length
    if (!confirm(`${count} Eintraege erneut zum Hochladen freigeben?\n\nFehlgeschlagene bleiben in der Liste.`)) return
    this.bulkBusy.set(true)
    try {
      for (const row of [...this.rejectedRows()]) {
        if (this.retryDisabled(row)) continue
        try {
          await this.patchRetry(row)
        } catch {
          // einzelner Fehler bricht Bulk nicht ab
        }
      }
      await this.reload()
      this.syncProblemCount.refresh()
    } finally {
      this.bulkBusy.set(false)
      this.cdr.markForCheck()
    }
  }

  async resolveConflict(row: SyncConflictRow, resolution: SyncConflictResolution) {
    this.rowBusy.set(row._id)
    try {
      await this.api.patch('sync-conflicts', row._id, { resolution } as Record<string, unknown>)
      this.conflicts.update(rows => rows.filter(r => r._id !== row._id))
      this.syncProblemCount.refresh()
    } catch (err) {
      this.errors.update(arr => [...arr, formatApiError(err)])
    } finally {
      this.rowBusy.set(null)
      this.cdr.markForCheck()
    }
  }
}
