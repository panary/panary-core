import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { formatApiError } from '../../core/error-helper'

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [TranslateModule, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-full flex flex-col overflow-hidden">
      @if (loading()) {
        <div class="flex-1 flex items-center justify-center">
          <span class="w-5 h-5 border-2 border-slate-300 dark:border-gray-600
                       border-t-slate-900 dark:border-t-white rounded-full animate-spin"></span>
        </div>
      } @else if (order()) {
        <div class="flex-1 overflow-y-auto p-6 space-y-4">

          <!-- Status + Bestellnr. -->
          <div class="flex items-center justify-between">
            <span class="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              #{{ order()!.dailySequenceNumber }}
            </span>
            <span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" [class]="statusBadge()">
              {{ statusLabel() }}
            </span>
          </div>

          <!-- Info-Grid -->
          <div class="space-y-3">
            @for (row of infoRows(); track row.label) {
              <div class="flex justify-between items-baseline">
                <span class="text-xs text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ row.label }}</span>
                <span class="text-sm font-medium text-slate-900 dark:text-white tabular-nums">{{ row.value }}</span>
              </div>
            }
          </div>

          <!-- Steuer-Details -->
          @if (order()!.taxSnapshot; as tax) {
            <div class="border-t border-slate-200 dark:border-gray-800 pt-3 space-y-2">
              <div class="flex justify-between items-baseline">
                <span class="text-xs text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.NET' | translate }}</span>
                <span class="text-sm font-medium text-slate-900 dark:text-white tabular-nums">{{ formatCurrency(tax.netto) }}</span>
              </div>
              @for (t of tax.taxes; track t.taxRate) {
                <div class="flex justify-between items-baseline">
                  <span class="text-xs text-slate-400 dark:text-gray-500 uppercase tracking-wider">{{ 'ORDERS.TAX' | translate }} {{ t.taxRate }}%</span>
                  <span class="text-sm font-medium text-slate-900 dark:text-white tabular-nums">{{ formatCurrency(t.tax) }}</span>
                </div>
              }
              <div class="flex justify-between items-baseline font-bold">
                <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{ 'ORDERS.GROSS' | translate }}</span>
                <span class="text-sm text-slate-900 dark:text-white tabular-nums">{{ formatCurrency(tax.brutto) }}</span>
              </div>
            </div>
          }
        </div>

        <!-- Löschen-Button -->
        <div class="p-6 border-t border-slate-200 dark:border-gray-800">
          <button (click)="showDeleteConfirm.set(true)"
            class="w-full py-2.5 rounded-xl text-sm font-medium
                   text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800
                   hover:bg-red-50 dark:hover:bg-red-950/30 transition">
            {{ 'ORDERS.DELETE_CONFIRM' | translate }}
          </button>
        </div>
      } @else {
        <div class="flex-1 flex items-center justify-center text-slate-400 dark:text-gray-500 text-sm">
          {{ 'COMMON.ERROR' | translate }}
        </div>
      }
    </div>

    @if (showDeleteConfirm()) {
      <app-confirm-dialog
        [title]="t.instant('ORDERS.DELETE_TITLE')"
        [message]="t.instant('ORDERS.DELETE_MESSAGE', { seq: order()?.dailySequenceNumber })"
        [confirmLabel]="t.instant('ORDERS.DELETE_CONFIRM')"
        [dismissLabel]="t.instant('ORDERS.DELETE_CANCEL')"
        (confirmed)="onDelete()"
        (dismissed)="showDeleteConfirm.set(false)"
        (cancelled)="showDeleteConfirm.set(false)" />
    }
  `,
})
export class OrderDetailComponent {
  private api = inject(ApiService)
  protected t = inject(TranslateService)

  orderId = input.required<string>()
  closed = output<void>()
  deleted = output<void>()

  order = signal<any | null>(null)
  loading = signal(true)
  showDeleteConfirm = signal(false)

  constructor() {
    effect(() => this.loadOrder(this.orderId()))
  }

  statusBadge = computed(() => {
    const s = this.order()?.status
    switch (s) {
      case 'active':     return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
      case 'production': return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
      case 'completed':  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
      case 'aborted':    return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'
      default:           return 'bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-400'
    }
  })

  statusLabel = computed(() => {
    const s = this.order()?.status
    switch (s) {
      case 'active':     return this.t.instant('ORDERS.STATUS_ACTIVE')
      case 'production': return this.t.instant('ORDERS.STATUS_PRODUCTION')
      case 'completed':  return this.t.instant('ORDERS.STATUS_COMPLETED')
      case 'aborted':    return this.t.instant('ORDERS.STATUS_ABORTED')
      case 'unclaimed':  return this.t.instant('ORDERS.STATUS_UNCLAIMED')
      default:           return s ?? '–'
    }
  })

  infoRows = computed(() => {
    const o = this.order()
    if (!o) return []
    return [
      { label: this.t.instant('ORDERS.CHANNEL'), value: this.channelLabel(o.orderChannel) },
      { label: this.t.instant('ORDERS.DINE_LOCATION'), value: o.dineLocation === 'dine-in' ? 'Vor Ort' : 'Mitnehmen' },
      { label: this.t.instant('ORDERS.ITEMS_COUNT'), value: String(o.lineItems?.length ?? 0) },
      { label: this.t.instant('ORDERS.CREATED_AT'), value: this.formatDate(o.recordingDate || o.createdAt) },
      { label: this.t.instant('ORDERS.PAYMENT_STATUS'), value: this.paymentLabel(o.payment?.state) },
    ]
  })

  private async loadOrder(id: string) {
    this.loading.set(true)
    try {
      const order = await this.api.get('orders', id)
      this.order.set(order)
    } catch {
      this.order.set(null)
    } finally {
      this.loading.set(false)
    }
  }

  async onDelete() {
    this.showDeleteConfirm.set(false)
    try {
      await this.api.remove('orders', this.orderId())
      this.deleted.emit()
    } catch (err) {
      console.error(formatApiError(err))
    }
  }

  formatCurrency(value: number): string {
    return value?.toFixed(2).replace('.', ',') + ' €'
  }

  private formatDate(iso: string): string {
    if (!iso) return '–'
    const d = new Date(iso)
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  private channelLabel(ch: string): string {
    switch (ch) {
      case 'telephone': return 'Telefon'
      case 'pos':       return 'POS'
      case 'online':    return 'Online'
      case 'app':       return 'App'
      default:          return ch ?? '–'
    }
  }

  private paymentLabel(state: string | undefined): string {
    switch (state) {
      case 'paid':           return this.t.instant('ORDERS.PAYMENT_PAID')
      case 'pending':        return this.t.instant('ORDERS.PAYMENT_PENDING')
      case 'partially_paid': return this.t.instant('ORDERS.PAYMENT_PARTIAL')
      case 'refunded':       return this.t.instant('ORDERS.PAYMENT_REFUNDED')
      default:               return '–'
    }
  }
}
