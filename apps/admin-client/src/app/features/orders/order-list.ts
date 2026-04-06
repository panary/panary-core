import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { OrderDetailComponent } from './order-detail'

type TimeRange = 'today' | 'yesterday' | 'week' | 'month'

interface TimeRangeOption {
  key: TimeRange
  labelKey: string
}

const TIME_RANGES: TimeRangeOption[] = [
  { key: 'today', labelKey: 'ORDERS.TIME_TODAY' },
  { key: 'yesterday', labelKey: 'ORDERS.TIME_YESTERDAY' },
  { key: 'week', labelKey: 'ORDERS.TIME_WEEK' },
  { key: 'month', labelKey: 'ORDERS.TIME_MONTH' },
]

function getTimeRangeFilter(range: TimeRange): Record<string, any> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  switch (range) {
    case 'today':
      return { createdAt: { $gte: todayStart } }
    case 'yesterday': {
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      return { createdAt: { $gte: yesterday.toISOString(), $lt: todayStart } }
    }
    case 'week': {
      const day = now.getDay()
      const diff = day === 0 ? 6 : day - 1
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
      return { createdAt: { $gte: monday.toISOString() } }
    }
    case 'month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      return { createdAt: { $gte: monthStart.toISOString() } }
    }
  }
}

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [TranslateModule, OrderDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full overflow-hidden">
      <!-- Linke Seite: Tabelle -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between min-h-9">
            <h1 class="text-xl font-bold tracking-tight">{{ 'ORDERS.TITLE' | translate }}</h1>
            <span class="text-xs text-slate-400 dark:text-gray-500 tabular-nums">{{ totalOrders() }}</span>
          </div>

          <!-- Zeitfilter -->
          <div class="flex gap-2">
            @for (range of timeRanges; track range.key) {
              <button (click)="onTimeRangeChange(range.key)"
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition"
                [class]="timeRange() === range.key
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-black'
                  : 'text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-gray-800'">
                {{ range.labelKey | translate }}
              </button>
            }
          </div>

          <!-- Tabelle -->
          @if (loading()) {
            <div class="flex items-center justify-center py-16">
              <span class="w-5 h-5 border-2 border-slate-300 dark:border-gray-600
                           border-t-slate-900 dark:border-t-white rounded-full animate-spin"></span>
            </div>
          } @else if (orders().length === 0) {
            <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">
              {{ 'ORDERS.NO_ORDERS' | translate }}
            </p>
          } @else {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-gray-800">
                    <th class="text-left px-4 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">#</th>
                    <th class="text-left px-3 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.STATUS' | translate }}</th>
                    <th class="text-left px-3 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.CHANNEL' | translate }}</th>
                    <th class="text-left px-3 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.DINE_LOCATION' | translate }}</th>
                    <th class="text-left px-3 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.PERSON' | translate }}</th>
                    <th class="text-right px-3 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.AMOUNT' | translate }}</th>
                    <th class="text-right px-4 py-2.5 text-[11px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.DATE' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (order of orders(); track order._id) {
                    <tr (click)="selectOrder(order._id)"
                      class="border-b border-slate-100 dark:border-gray-800/50 cursor-pointer transition"
                      [class]="selectedId() === order._id
                        ? 'bg-slate-100 dark:bg-gray-800'
                        : 'hover:bg-slate-50 dark:hover:bg-gray-900/50'">
                      <td class="px-4 py-2.5 text-sm font-bold text-slate-900 dark:text-white tabular-nums">{{ order.dailySequenceNumber }}</td>
                      <td class="px-3 py-2.5">
                        <span class="inline-flex px-2.5 py-0.5 rounded-full border text-xs font-medium" [class]="statusBadge(order.status)">
                          {{ statusLabel(order.status) }}
                        </span>
                      </td>
                      <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-gray-400">{{ channelLabel(order.orderChannel) }}</td>
                      <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-gray-400">{{ order.dineLocation === 'dine-in' ? 'Vor Ort' : 'Mitnehmen' }}</td>
                      <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-gray-400">
                        @if (order.staffPaymentInfo?.userName) {
                          <span class="inline-flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px] text-amber-500">restaurant</span>
                            {{ order.staffPaymentInfo.userName }}
                          </span>
                        } @else if (order.customerPaymentInfo?.customerName) {
                          {{ order.customerPaymentInfo.customerName }}
                        } @else {
                          –
                        }
                      </td>
                      <td class="px-3 py-2.5 text-sm text-slate-900 dark:text-white text-right tabular-nums font-medium">{{ formatAmount(order) }}</td>
                      <td class="px-4 py-2.5 text-sm text-slate-500 dark:text-gray-400 text-right tabular-nums">{{ formatTime(order.createdAt) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Pagination -->
            @if (totalPages() > 1) {
              <div class="flex items-center justify-center gap-4 pt-2">
                <button (click)="prevPage()" [disabled]="currentPage() === 0"
                  class="text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 transition">
                  <span class="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                <span class="text-xs text-slate-400 dark:text-gray-500 tabular-nums">
                  {{ currentPage() + 1 }} / {{ totalPages() }}
                </span>
                <button (click)="nextPage()" [disabled]="currentPage() >= totalPages() - 1"
                  class="text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 transition">
                  <span class="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            }
          }
        </div>
      </div>

      <!-- Rechte Seite: Detail-Panel -->
      @if (selectedId(); as id) {
        <div class="w-80 shrink-0 border-l border-slate-200 dark:border-gray-800 flex flex-col overflow-hidden">
          <!-- Panel Header -->
          <div class="shrink-0 bg-slate-50 dark:bg-gray-950 border-b border-slate-200 dark:border-gray-800
                      px-4 py-2.5 flex items-center gap-2">
            <span class="text-xs text-slate-400 dark:text-gray-500">
              {{ 'ORDERS.DETAIL_TITLE' | translate }}
            </span>
            <div class="flex-1"></div>
            <button (click)="selectedId.set(null)"
              class="text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white w-8 h-8
                     flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ✕
            </button>
          </div>

          <!-- Detail-Inhalt -->
          <div class="flex-1 overflow-y-auto">
            <app-order-detail
              [orderId]="id"
              (closed)="selectedId.set(null)"
              (deleted)="onOrderDeleted()" />
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderListComponent implements OnInit {
  private api = inject(ApiService)
  private t = inject(TranslateService)

  timeRanges = TIME_RANGES
  pageSize = 25

  orders = signal<any[]>([])
  loading = signal(true)
  selectedId = signal<string | null>(null)
  timeRange = signal<TimeRange>('today')
  currentPage = signal(0)
  totalOrders = signal(0)

  totalPages = computed(() => Math.max(1, Math.ceil(this.totalOrders() / this.pageSize)))

  async ngOnInit() {
    await this.loadOrders()
  }

  async onTimeRangeChange(range: TimeRange) {
    this.timeRange.set(range)
    this.currentPage.set(0)
    this.selectedId.set(null)
    await this.loadOrders()
  }

  selectOrder(id: string) {
    this.selectedId.set(this.selectedId() === id ? null : id)
  }

  async onOrderDeleted() {
    this.selectedId.set(null)
    await this.loadOrders()
  }

  async prevPage() {
    if (this.currentPage() > 0) {
      this.currentPage.update(p => p - 1)
      await this.loadOrders()
    }
  }

  async nextPage() {
    if (this.currentPage() < this.totalPages() - 1) {
      this.currentPage.update(p => p + 1)
      await this.loadOrders()
    }
  }

  private async loadOrders() {
    this.loading.set(true)
    try {
      const filter = getTimeRangeFilter(this.timeRange())
      const result = await this.api.find<any>('orders', {
        ...filter,
        $sort: { createdAt: -1 },
        $limit: this.pageSize,
        $skip: this.currentPage() * this.pageSize,
      })
      this.orders.set(result.data)
      this.totalOrders.set(result.total)
    } catch {
      this.orders.set([])
      this.totalOrders.set(0)
    } finally {
      this.loading.set(false)
    }
  }

  statusBadge(status: string): string {
    switch (status) {
      case 'active':     return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      case 'production': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
      case 'completed':  return 'bg-green-500/10 text-green-400 border-green-500/20'
      case 'aborted':    return 'bg-red-500/10 text-red-400 border-red-500/20'
      default:           return 'bg-gray-500/10 text-gray-400 border-gray-500/20'
    }
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'active':     return this.t.instant('ORDERS.STATUS_ACTIVE')
      case 'production': return this.t.instant('ORDERS.STATUS_PRODUCTION')
      case 'completed':  return this.t.instant('ORDERS.STATUS_COMPLETED')
      case 'aborted':    return this.t.instant('ORDERS.STATUS_ABORTED')
      case 'unclaimed':  return this.t.instant('ORDERS.STATUS_UNCLAIMED')
      default:           return status ?? '–'
    }
  }

  channelLabel(ch: string): string {
    switch (ch) {
      case 'telephone': return 'Telefon'
      case 'pos':       return 'POS'
      case 'online':    return 'Online'
      case 'app':       return 'App'
      default:          return ch ?? '–'
    }
  }

  formatAmount(order: any): string {
    const brutto = order.taxSnapshot?.brutto
    return brutto != null ? brutto.toFixed(2).replace('.', ',') + ' €' : '–'
  }

  formatTime(iso: string): string {
    if (!iso) return '–'
    const d = new Date(iso)
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
}
