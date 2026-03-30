import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { ApiService, Paginated } from '../../core/api.service'

type SystemMode = 'standalone' | 'connected' | 'cloud'
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

const CLOUD_STATUS_CONFIG: Record<CloudStatus, { label: string; icon: string; pill: string; dot: string }> = {
  standalone:   { label: 'Standalone-Modus',  icon: 'lan',        pill: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',           dot: 'bg-slate-400' },
  connected:    { label: 'Cloud verbunden',   icon: 'cloud_done', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900', dot: 'bg-emerald-500 animate-pulse' },
  pairing:      { label: 'Kopplung läuft…',   icon: 'cloud_sync', pill: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',             dot: 'bg-amber-500 animate-pulse' },
  disconnected: { label: 'Cloud getrennt',    icon: 'cloud_off',  pill: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',             dot: 'bg-slate-400' },
  error:        { label: 'Verbindungsfehler', icon: 'cloud_off',  pill: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',                        dot: 'bg-red-500' },
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-4 h-full overflow-y-auto">

      <!-- Header -->
      <div class="flex items-center justify-between min-h-9">
        <h1 class="text-xl font-bold tracking-tight">Dashboard</h1>
        <div class="flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold border transition-colors"
          [class]="statusConfig().pill">
          <div class="w-2 h-2 rounded-full shrink-0" [class]="statusConfig().dot"></div>
          <span class="material-symbols-outlined" style="font-size: 14px; line-height: 1">{{ statusConfig().icon }}</span>
          {{ statusConfig().label }}
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (kpi of kpis(); track kpi.label) {
          <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-5 flex items-center gap-4 hover:border-slate-300 dark:hover:border-gray-700 transition-colors">
            <div class="p-3 rounded-xl shrink-0" [style.background-color]="kpi.iconBg">
              <span class="material-symbols-outlined text-[22px]" [style.color]="kpi.iconColor">{{ kpi.icon }}</span>
            </div>
            <div>
              <p class="text-xs font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-widest">{{ kpi.label }}</p>
              <p class="text-3xl font-bold mt-0.5 text-slate-900 dark:text-white tabular-nums">{{ kpi.value }}</p>
            </div>
          </div>
        }
      </div>

    </div>
  `,
})
export class DashboardComponent implements OnInit {
  #api = inject(ApiService)
  #http = inject(HttpClient)

  cloudStatus = signal<CloudStatus>('standalone')
  statusConfig = computed(() => CLOUD_STATUS_CONFIG[this.cloudStatus()])

  kpis = signal<KpiCard[]>([
    { label: 'Benutzer',       value: '–', icon: 'people',        iconColor: '#2563eb', iconBg: '#eff6ff' },
    { label: 'Standorte',      value: '–', icon: 'store',         iconColor: '#7c3aed', iconBg: '#f5f3ff' },
    { label: 'Produkte',       value: '–', icon: 'inventory_2',   iconColor: '#059669', iconBg: '#ecfdf5' },
    { label: 'Produktgruppen', value: '–', icon: 'category',      iconColor: '#d97706', iconBg: '#fffbeb' },
    { label: 'API-Keys',       value: '–', icon: 'key',           iconColor: '#e11d48', iconBg: '#fff1f2' },
    { label: 'Bestellungen',   value: '–', icon: 'receipt_long',  iconColor: '#4f46e5', iconBg: '#eef2ff' },
  ])

  async ngOnInit() {
    const [kpiResults, healthResult, cloudResult] = await Promise.all([
      Promise.allSettled([
        this.#api.find('users',          { $limit: 0 }),
        this.#api.find('locations',      { $limit: 0 }),
        this.#api.find('products',       { $limit: 0 }),
        this.#api.find('product-groups', { $limit: 0 }),
        this.#api.find('apikeys',        { $limit: 0 }),
        this.#api.find('orders',         { $limit: 0 }),
      ]),
      lastValueFrom(this.#http.get<{ systemMode: SystemMode }>('http://localhost:3030/health')).catch(() => null),
      this.#api.find<CloudConnection>('cloud-connection', { $limit: 1 }).catch(() => null),
    ])

    const val = (r: PromiseSettledResult<Paginated<unknown>>) =>
      r.status === 'fulfilled' ? String(r.value.total) : '–'

    this.kpis.update(cards => cards.map((card, i) => ({ ...card, value: val(kpiResults[i]) })))

    if (healthResult?.systemMode === 'standalone') {
      this.cloudStatus.set('standalone')
    } else {
      const pairingStatus = cloudResult?.data[0]?.pairingStatus
      this.cloudStatus.set(pairingStatus ?? 'disconnected')
    }
  }
}
