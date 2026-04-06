import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService, Paginated } from '../../core/api.service'

type PairingStatus = 'connected' | 'disconnected' | 'pairing' | 'error'
type CloudStatus = 'standalone' | PairingStatus

interface CloudConnection {
  _id: string
  pairingStatus: PairingStatus
}

interface KpiCard {
  label: string
  value: string
  icon: string
  iconColor: string
  iconBg: string
}

interface EdgeServerInfo {
  status: string
  timestamp: string
  uptime: number
  version: string
  systemMode: string
  nodeVersion: string
  platform: string
  hostname: string
  memory: { rss: number; heapUsed: number; heapTotal: number }
  localIp: string
  port: number
  database: { type: string }
}

const CLOUD_STATUS_CONFIG: Record<CloudStatus, { labelKey: string; icon: string; pill: string; dot: string }> = {
  standalone:   { labelKey: 'DASHBOARD.STATUS_STANDALONE',    icon: 'lan',        pill: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',           dot: 'bg-slate-400' },
  connected:    { labelKey: 'DASHBOARD.STATUS_CONNECTED',     icon: 'cloud_done', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900', dot: 'bg-emerald-500 animate-pulse' },
  pairing:      { labelKey: 'DASHBOARD.STATUS_PAIRING',       icon: 'cloud_sync', pill: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',             dot: 'bg-amber-500 animate-pulse' },
  disconnected: { labelKey: 'DASHBOARD.STATUS_DISCONNECTED',  icon: 'cloud_off',  pill: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',             dot: 'bg-slate-400' },
  error:        { labelKey: 'DASHBOARD.STATUS_ERROR',         icon: 'cloud_off',  pill: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',                        dot: 'bg-red-500' },
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-4 h-full overflow-y-auto">

      <!-- Header -->
      <div class="flex items-center justify-between min-h-9">
        <h1 class="text-xl font-bold tracking-tight">{{ 'DASHBOARD.TITLE' | translate }}</h1>
        <div class="flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold border transition-colors"
          [class]="statusConfig().pill">
          <div class="w-2 h-2 rounded-full shrink-0" [class]="statusConfig().dot"></div>
          <span class="material-symbols-outlined" style="font-size: 14px; line-height: 1">{{ statusConfig().icon }}</span>
          {{ statusConfig().labelKey | translate }}
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        @if (loading()) {
          @for (i of [1,2,3,4,5,6]; track i) {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-5 flex items-center gap-4">
              <div class="w-[46px] h-[46px] rounded-xl bg-slate-100 dark:bg-gray-800 animate-pulse shrink-0"></div>
              <div class="space-y-2 flex-1">
                <div class="h-3 w-24 bg-slate-100 dark:bg-gray-800 rounded animate-pulse"></div>
                <div class="h-8 w-16 bg-slate-100 dark:bg-gray-800 rounded animate-pulse"></div>
              </div>
            </div>
          }
        } @else {
          @for (kpi of kpis(); track kpi.label) {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-5 flex items-center gap-4 hover:border-slate-300 dark:hover:border-gray-700 transition-colors">
              <div class="p-3 rounded-xl shrink-0" [style.background-color]="kpi.iconBg">
                <span class="material-symbols-outlined text-[22px]" [style.color]="kpi.iconColor">{{ kpi.icon }}</span>
              </div>
              <div>
                <p class="text-xs font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-widest">{{ kpi.label | translate }}</p>
                <p class="text-3xl font-bold mt-0.5 text-slate-900 dark:text-white tabular-nums">{{ kpi.value }}</p>
              </div>
            </div>
          }
        }
      </div>

      <!-- Edge Server Info -->
      @if (loading()) {
        <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="p-2.5 rounded-xl bg-slate-100 dark:bg-gray-800 animate-pulse">
                <div class="w-[22px] h-[22px]"></div>
              </div>
              <div class="space-y-1.5">
                <div class="h-4 w-28 bg-slate-100 dark:bg-gray-800 rounded animate-pulse"></div>
                <div class="h-3 w-40 bg-slate-100 dark:bg-gray-800 rounded animate-pulse"></div>
              </div>
            </div>
            <div class="h-6 w-16 bg-slate-100 dark:bg-gray-800 rounded-full animate-pulse"></div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            @for (i of [1,2,3,4,5,6,7,8,9]; track i) {
              <div class="space-y-1.5">
                <div class="h-2.5 w-16 bg-slate-100 dark:bg-gray-800 rounded animate-pulse"></div>
                <div class="h-4 w-24 bg-slate-100 dark:bg-gray-800 rounded animate-pulse"></div>
              </div>
            }
          </div>
        </div>
      } @else if (edgeInfo(); as info) {
        <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-5">

          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="p-2.5 rounded-xl bg-slate-900 dark:bg-white">
                <span class="material-symbols-outlined text-[22px] text-white dark:text-slate-900">dns</span>
              </div>
              <div>
                <p class="text-sm font-bold text-slate-900 dark:text-white">{{ 'DASHBOARD.EDGE_SERVER' | translate }}</p>
                <p class="text-xs text-slate-400 dark:text-gray-500">{{ info.hostname }}</p>
              </div>
            </div>
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
                        bg-emerald-50 text-emerald-700 border border-emerald-200
                        dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900">
              <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              {{ 'DASHBOARD.ACTIVE' | translate }}
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            @for (row of edgeRows(); track row.label) {
              <div>
                <p class="text-[11px] text-slate-400 dark:text-gray-500 uppercase tracking-widest">{{ row.label }}</p>
                <p class="text-sm font-medium text-slate-900 dark:text-white mt-0.5 tabular-nums font-mono">{{ row.value }}</p>
              </div>
            }
          </div>

        </div>
      } @else {
        <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-5">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-xl bg-red-50 dark:bg-red-950">
              <span class="material-symbols-outlined text-[22px] text-red-500">dns</span>
            </div>
            <div>
              <p class="text-sm font-bold text-slate-900 dark:text-white">{{ 'DASHBOARD.EDGE_SERVER' | translate }}</p>
              <p class="text-xs text-red-500">{{ 'DASHBOARD.UNREACHABLE' | translate }}</p>
            </div>
          </div>
        </div>
      }

    </div>
  `,
})
export class DashboardComponent implements OnInit {
  #api = inject(ApiService)
  #http = inject(HttpClient)
  #t = inject(TranslateService)

  loading = signal(true)
  cloudStatus = signal<CloudStatus>('standalone')
  statusConfig = computed(() => CLOUD_STATUS_CONFIG[this.cloudStatus()])

  edgeInfo = signal<EdgeServerInfo | null>(null)

  edgeRows = computed(() => {
    const info = this.edgeInfo()
    if (!info) return []
    return [
      { label: this.#t.instant('DASHBOARD.VERSION'),   value: `v${info.version}` },
      { label: this.#t.instant('DASHBOARD.UPTIME'),    value: formatUptime(info.uptime) },
      { label: 'Node.js',                              value: info.nodeVersion },
      { label: this.#t.instant('DASHBOARD.PLATFORM'),  value: info.platform },
      { label: 'IP',                                   value: `${info.localIp}:${info.port}` },
      { label: this.#t.instant('DASHBOARD.MODE'),      value: info.systemMode },
      { label: this.#t.instant('DASHBOARD.DATABASE'),  value: info.database.type.toUpperCase() },
      { label: 'RAM (RSS)',                             value: formatBytes(info.memory.rss) },
      { label: 'Heap',                                 value: `${formatBytes(info.memory.heapUsed)} / ${formatBytes(info.memory.heapTotal)}` },
    ]
  })

  kpis = signal<KpiCard[]>([
    { label: 'DASHBOARD.KPI_USERS',           value: '–', icon: 'people',        iconColor: '#2563eb', iconBg: '#eff6ff' },
    { label: 'DASHBOARD.KPI_LOCATIONS',        value: '–', icon: 'store',         iconColor: '#7c3aed', iconBg: '#f5f3ff' },
    { label: 'DASHBOARD.KPI_PRODUCTS',         value: '–', icon: 'inventory_2',   iconColor: '#059669', iconBg: '#ecfdf5' },
    { label: 'DASHBOARD.KPI_PRODUCT_GROUPS',   value: '–', icon: 'category',      iconColor: '#d97706', iconBg: '#fffbeb' },
    { label: 'DASHBOARD.KPI_API_KEYS',         value: '–', icon: 'key',           iconColor: '#e11d48', iconBg: '#fff1f2' },
    { label: 'DASHBOARD.KPI_ORDERS',           value: '–', icon: 'receipt_long',  iconColor: '#4f46e5', iconBg: '#eef2ff' },
  ])

  async ngOnInit() {
    const minDelay = new Promise(r => setTimeout(r, 300))

    const [kpiResults, healthResult, cloudResult] = await Promise.all([
      Promise.allSettled([
        this.#api.find('users',          { $limit: 0 }),
        this.#api.find('locations',      { $limit: 0 }),
        this.#api.find('products',       { $limit: 0 }),
        this.#api.find('product-groups', { $limit: 0 }),
        this.#api.find('apikeys',        { $limit: 0 }),
        this.#api.find('orders',         { $limit: 0 }),
      ]),
      lastValueFrom(this.#http.get<EdgeServerInfo>(`${window.location.origin}/health`)).catch(() => null),
      this.#api.find<CloudConnection>('cloud-connection', { $limit: 1 }).catch(() => null),
      minDelay,
    ] as const)

    const val = (r: PromiseSettledResult<Paginated<unknown>>) =>
      r.status === 'fulfilled' ? String(r.value.total) : '–'

    this.kpis.update(cards => cards.map((card, i) => ({ ...card, value: val(kpiResults[i]) })))

    if (healthResult) {
      this.edgeInfo.set(healthResult)
    }

    if (healthResult?.systemMode === 'standalone') {
      this.cloudStatus.set('standalone')
    } else {
      const pairingStatus = cloudResult?.data[0]?.pairingStatus
      this.cloudStatus.set(pairingStatus ?? 'disconnected')
    }

    this.loading.set(false)
  }
}
