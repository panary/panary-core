import { ChangeDetectionStrategy, Component, effect, inject, OnInit, signal, WritableSignal } from '@angular/core'
import { Router } from '@angular/router'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatDialog } from '@angular/material/dialog'
import {
  getCombinations,
  getUnbundledLineItems,
  Order,
  OrderLineItem,
  OrderService,
  OrderStatus,
  PrintDialogComponent,
  CancelOrderDialogComponent,
} from '@panary/orders/data-access'
import { ExtendedParams } from '@panary/shared-common'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

type TimeRange = 'today' | 'yesterday' | 'week' | 'custom'

@Component({
  selector: 'lib-order-history',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './order-history.component.html',
  styleUrls: ['./order-history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderHistoryComponent implements OnInit {
  protected readonly OrderStatus = OrderStatus
  #orderService = inject(OrderService)
  #router = inject(Router)
  #translate = inject(TranslateService)
  #dialog = inject(MatDialog)
  // MatSnackBar wird im CancelOrderDialogComponent verwendet, nicht hier direkt

  // Signals
  searchQuery: WritableSignal<string> = signal('')
  selectedTimeRange: WritableSignal<TimeRange> = signal('today')
  orders: WritableSignal<Order[]> = signal([])
  loading: WritableSignal<boolean> = signal(false)
  selectedOrder: WritableSignal<Order | null> = signal(null)

  // Custom Date Range
  customStartDate: Date | null = null
  customEndDate: Date | null = null

  constructor() {
    effect(() => {
      const range = this.selectedTimeRange()
      if (range !== 'custom') {
        this.fetchOrders()
      }
    })
  }

  ngOnInit() {
    this.fetchOrders()
  }

  goBack() {
    this.#router.navigate(['/dashboard'])
  }

  //#region Drucken & Storno

  printOrder(): void {
    const order = this.selectedOrder()
    if (!order) return
    this.#dialog.open(PrintDialogComponent, {
      data: order,
      panelClass: 'rounded-dialog',
    })
  }

  cancelOrder(): void {
    const order = this.selectedOrder()
    if (!order || order.status === OrderStatus.ABORTED) return

    const ref = this.#dialog.open(CancelOrderDialogComponent, {
      data: order,
      panelClass: 'rounded-dialog',
    })

    ref.afterClosed().subscribe(result => {
      if (result?.success) {
        this.fetchOrders()
        this.selectedOrder.set(null)
      }
    })
  }

  //#endregion

  async fetchOrders() {
    this.loading.set(true)
    this.selectedOrder.set(null)

    try {
      const { start, end } = this.getDateRange()
      const queryText = this.searchQuery().trim()
      const queryPrice = queryText ? parseFloat(queryText.replace(',', '.')) : NaN
      const isPriceQuery = !isNaN(queryPrice) && queryPrice > 0

      const mongoQuery: any = {
        recordingDate: {
          $gte: start.toISOString(),
          $lte: end.toISOString(),
        },
      }

      const limit = queryText ? 1000 : 100

      const params: ExtendedParams = {
        query: {
          ...mongoQuery,
          $sort: { recordingDate: -1 },
          $limit: limit,
        },
      }

      const result = await this.#orderService.find(params)
      let fetchedOrders: Order[] = []

      if (Array.isArray(result)) {
        fetchedOrders = result
      } else {
        fetchedOrders = result.data
      }

      if (queryText) {
        const searchLower = queryText.toLowerCase()
        fetchedOrders = fetchedOrders.filter(order => {
          const matchesText =
            (order.customerPaymentInfo?.customerName || '').toLowerCase().includes(searchLower) ||
            (order.staffPaymentInfo?.userName || '').toLowerCase().includes(searchLower) ||
            String(order.orderChannel || '').toLowerCase().includes(searchLower) ||
            order.dailySequenceNumber?.toString() === queryText

          let matchesPrice = false
          if (isPriceQuery) {
            const total = this.calculateTotal(order)
            matchesPrice = Math.abs(total - queryPrice) < 0.01
          }

          return matchesText || matchesPrice
        })
      }

      this.orders.set(fetchedOrders)
    } catch (error) {
      console.error('Error fetching orders:', error)
      this.orders.set([])
    } finally {
      this.loading.set(false)
    }
  }

  getDateRange(): { start: Date; end: Date } {
    const now = new Date()
    const start = new Date(now)
    const end = new Date(now)

    switch (this.selectedTimeRange()) {
      case 'today':
        start.setHours(0, 0, 0, 0)
        end.setHours(23, 59, 59, 999)
        break
      case 'yesterday':
        start.setDate(start.getDate() - 1)
        start.setHours(0, 0, 0, 0)
        end.setDate(end.getDate() - 1)
        end.setHours(23, 59, 59, 999)
        break
      case 'week': {
        const day = start.getDay() || 7
        if (day !== 1) start.setHours(-24 * (day - 1))
        start.setHours(0, 0, 0, 0)
        end.setHours(23, 59, 59, 999)
        break
      }
      case 'custom':
        if (this.customStartDate && this.customEndDate) {
          return { start: this.customStartDate, end: this.customEndDate }
        }
        break
    }
    return { start, end }
  }

  selectTimeRange(range: TimeRange) {
    this.selectedTimeRange.set(range)
  }

  toggleOrderSelection(order: Order) {
    if (this.selectedOrder()?._id === order._id) {
      this.selectedOrder.set(null)
    } else {
      this.selectedOrder.set(order)
    }
  }

  getOrderTitle(order: Order): string {
    if (order.customerPaymentInfo) return order.customerPaymentInfo.customerName
    if (order.staffPaymentInfo) return order.staffPaymentInfo.userName
    return `${this.#translate.instant('ENTITY.ORDER')} #${order.dailySequenceNumber}`
  }

  calculateTotal(order: Order): number {
    let total = 0
    if (order.lineItems) {
      total += order.lineItems.reduce((acc: number, item: any) => acc + item.price * item.amount, 0)
      order.lineItems.forEach((item: any) => {
        if (item.extras) {
          total += item.extras.reduce((acc: number, extra: any) => acc + extra.price * Math.abs(extra.amount), 0)
        }
      })
    }
    return total
  }

  getCombinations(order: Order): OrderLineItem[][] {
    return getCombinations(order)
  }

  getUnbundledLineItems(order: Order): OrderLineItem[] {
    return getUnbundledLineItems(order)
  }
}
