import { Component, computed, effect, inject, signal, WritableSignal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { uuidv7 } from 'uuidv7'
import { OrderDialogComponent } from '@panary-core/orders/feature-pos-order-dialog'
import {
  Order,
  OrderLineItemSchema,
  OrderService,
  OrderStatus,
  PaymentState,
  Payment,
  Transaction,
  TransactionMethod,
} from '@panary-core/orders/data-access'
import { PrintDialogComponent, CancelOrderDialogComponent } from '@panary-core/orders/data-access'
import { AuthService } from '@panary-core/auth/data-access'
import { UserService } from '@panary-core/users/data-access'
import { User } from '@panary-core/users/domain'
import { CorporateCustomerService } from '@panary-core/corporate-customers/data-access'
import { CorporateCustomer } from '@panary-core/corporate-customers/domain'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

type OverlayView = 'actions' | 'staff-meal' | 'discount' | 'corporate'

const DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30] as const

@Component({
  selector: 'lib-active-orders',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './active-orders.component.html',
  styleUrl: './active-orders.component.scss',
})
export class ActiveOrdersComponent {
  #orderService = inject(OrderService)
  #router = inject(Router)
  #authService = inject(AuthService)
  #matDialog = inject(MatDialog)
  #snackBar = inject(MatSnackBar)
  #userService = inject(UserService)
  #corporateCustomerService = inject(CorporateCustomerService)
  #translate = inject(TranslateService)

  // Sort orders by recordingDate descending (Newest first)
  sortedOrders = computed(() => {
    return this.#orderService.ordersActive().sort((a, b) => {
      return new Date(b.recordingDate).getTime() - new Date(a.recordingDate).getTime()
    })
  })

  orders = this.sortedOrders
  protected readonly OrderStatus = OrderStatus

  zoomLevel: WritableSignal<number> = signal(0.85)
  zoomOpen = signal(false)
  selectedOrderId: WritableSignal<string | null> = signal(null)

  // max-height der Karte in CSS-Koordinaten, korrigiert um den Zoom-Faktor:
  // Verfügbare visuelle Höhe = 100dvh − Main-Padding(3rem) (kein Page-Header mehr)
  // Im Zoom-Koordinatensystem: ÷ zoom − Buttons(3rem) − Gap(0.5rem)
  cardMaxHeight = computed(() => `calc((100dvh - 3rem) / ${this.zoomLevel()} - 3.5rem)`)

  // Steuert aktive Sub-Ansicht im Overlay
  overlayView: WritableSignal<OverlayView> = signal('actions')

  // Mitarbeiter mit Personalessen-Berechtigung
  staffEligibleUsers: WritableSignal<User[]> = signal([])
  staffUsersLoading: WritableSignal<boolean> = signal(false)

  // Storno (Flow im CancelOrderDialogComponent)

  // Rabatt
  discountPresets = DISCOUNT_PRESETS

  // Firma
  corporateCustomers = signal<CorporateCustomer[]>([])
  corporateCustomersLoading = signal(false)

  // Scroll-State pro Bestellung: trackt ob oben/unten noch Inhalt existiert
  #itemsScrollState = signal<Record<string, { atTop: boolean; atBottom: boolean }>>({})

  constructor() {
    // Nach jedem Render-Zyklus (orders-Änderung) Scroll-States neu prüfen
    effect(() => {
      this.sortedOrders()
      Promise.resolve().then(() => this.#checkAllScrollStates())
    })
  }

  #checkAllScrollStates() {
    document.querySelectorAll<HTMLElement>('[data-order-items]').forEach(el => {
      const orderId = el.dataset['orderId']
      if (orderId) this.#updateScrollState(el, orderId)
    })
  }

  #updateScrollState(el: HTMLElement, orderId: string) {
    const atTop = el.scrollTop <= 2
    const atBottom = el.scrollHeight <= el.clientHeight + 2 || el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    this.#itemsScrollState.update(s => ({ ...s, [orderId]: { atTop, atBottom } }))
  }

  onItemsScroll(event: Event, orderId: string) {
    this.#updateScrollState(event.target as HTMLElement, orderId)
  }

  hasMoreAbove(orderId: string): boolean {
    return !(this.#itemsScrollState()[orderId]?.atTop ?? true)
  }

  hasMoreBelow(orderId: string): boolean {
    return !(this.#itemsScrollState()[orderId]?.atBottom ?? true)
  }

  increaseZoom() {
    this.zoomLevel.update(z => Math.min(z + 0.1, 1.2))
  }

  decreaseZoom() {
    this.zoomLevel.update(z => Math.max(z - 0.1, 0.5))
  }

  toggleSelection(orderId: string) {
    if (this.selectedOrderId() === orderId) {
      this.selectedOrderId.set(null)
      this.overlayView.set('actions')
      this.staffEligibleUsers.set([])
      this.corporateCustomers.set([])
    } else {
      this.selectedOrderId.set(orderId)
      this.overlayView.set('actions')
    }
  }

  openQuickOrder() {
    this.#matDialog.open(OrderDialogComponent, {
      backdropClass: 'backdrop-blur',
      panelClass: 'fullscreen-dialog',
      width: '98vw',
      height: '95vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      restoreFocus: false,
      disableClose: true,
    })
  }

  // Actions
  printOrder(event: Event, order: Order) {
    event.stopPropagation()
    this.#matDialog.open(PrintDialogComponent, { data: order })
  }

  completeOrder(event: Event, order: Order) {
    event.stopPropagation()
    if (order._id) {
      this.#orderService.complete(order._id)
    }
  }

  checkoutOrder(event: Event, order: Order) {
    event.stopPropagation()
    if (!order._id) return

    const currentUser = this.#authService.user()
    if (!currentUser) {
      console.error('No user logged in')
      return
    }

    const total = this.calculateTotal(order)

    const transaction: Transaction = {
      _id: uuidv7(),
      method: TransactionMethod.CASH,
      amount: total,
      currency: 'EUR',
      timestamp: new Date().toISOString(),
      performedBy: currentUser._id.toString(),
    }

    const paymentInfo: Payment = {
      state: PaymentState.PAID,
      totalAmount: total,
      tipAmount: 0,
      transactions: [transaction],
    }

    this.#orderService
      .patch(order._id, {
        payment: paymentInfo,
        status: OrderStatus.COMPLETED,
      })
      .then(() => {
        this.#orderService.complete(order._id)
      })
  }

  // --- Personalessen-Flow ---

  openStaffMealView() {
    this.overlayView.set('staff-meal')
    this.loadStaffEligibleUsers()
  }

  async loadStaffEligibleUsers() {
    this.staffUsersLoading.set(true)
    try {
      const result = await this.#userService.find({ query: { $limit: 200 } })
      const users: User[] = Array.isArray(result) ? result : (result as any).data
      // SQLite speichert Booleans als 0/1 — truthy-Prüfung statt striktem Vergleich
      this.staffEligibleUsers.set(users.filter(u => !!u.allowStaffMealOrders))
    } catch (e) {
      console.error(e)
      this.staffEligibleUsers.set([])
    } finally {
      this.staffUsersLoading.set(false)
    }
  }

  async applyStaffMeal(order: Order, user: User) {
    const userName = `${user.firstName} ${user.lastName}`.trim() || user.loginname
    const patch: any = {
      staffPaymentInfo: {
        userId: user._id,
        userName,
        isPaid: false,
      },
    }
    if (user.discountDetails) {
      patch.discount = user.discountDetails
    }
    try {
      await this.#orderService.patch(order._id, patch)
      this.selectedOrderId.set(null)
      this.overlayView.set('actions')
      this.staffEligibleUsers.set([])
      this.#snackBar.open(this.#translate.instant('ACTIVE_ORDERS.STAFF_MEAL_BOOKED', { name: userName }), undefined, { duration: 2500 })
    } catch (e) {
      console.error(e)
      this.#snackBar.open(this.#translate.instant('ACTIVE_ORDERS.STAFF_MEAL_ERROR'), 'OK', { duration: 3000 })
    }
  }

  backToActions() {
    this.overlayView.set('actions')
    this.staffEligibleUsers.set([])
    this.corporateCustomers.set([])
  }

  getUserInitials(user: User): string {
    const first = user.firstName?.[0] ?? ''
    const last = user.lastName?.[0] ?? ''
    return (first + last).toUpperCase() || user.loginname.slice(0, 2).toUpperCase()
  }

  formatDiscount(user: User): string {
    if (!user.discountDetails) return this.#translate.instant('ACTIVE_ORDERS.NO_DISCOUNT')
    if (user.discountDetails.discountType === 'percent') {
      return `${user.discountDetails.discount} % ${this.#translate.instant('ACTIVE_ORDERS.DISCOUNT_LABEL')}`
    }
    return `${user.discountDetails.discount.toFixed(2)} € ${this.#translate.instant('ACTIVE_ORDERS.DISCOUNT_LABEL')}`
  }

  // --- Storno-Flow (delegiert an shared CancelOrderDialogComponent) ---

  cancelOrder(order: Order) {
    const ref = this.#matDialog.open(CancelOrderDialogComponent, {
      data: order,
      panelClass: 'rounded-dialog',
    })

    ref.afterClosed().subscribe(result => {
      if (result?.success) {
        this.resetOverlay()
      }
    })
  }

  // --- Rabatt-Flow ---

  enterDiscount() {
    this.overlayView.set('discount')
  }

  async applyDiscount(order: Order, percent: number) {
    try {
      await this.#orderService.patch(order._id, {
        discount: { discountType: 'percent', discount: percent },
      })
      this.resetOverlay()
      this.#snackBar.open(this.#translate.instant('ACTIVE_ORDERS.DISCOUNT_APPLIED', { percent }), undefined, { duration: 2500 })
    } catch (e) {
      console.error(e)
      this.#snackBar.open(this.#translate.instant('ACTIVE_ORDERS.DISCOUNT_ERROR'), 'OK', { duration: 3000 })
    }
  }

  // --- Firma-Flow ---

  recordCorporateOrder() {
    this.overlayView.set('corporate')
    this.loadCorporateCustomers()
  }

  private async loadCorporateCustomers() {
    this.corporateCustomersLoading.set(true)
    try {
      const result = await this.#corporateCustomerService.find({ query: { $limit: 200 } })
      const customers: CorporateCustomer[] = Array.isArray(result) ? result : (result as any).data
      this.corporateCustomers.set(customers)
    } catch (e) {
      console.error(e)
      this.corporateCustomers.set([])
    } finally {
      this.corporateCustomersLoading.set(false)
    }
  }

  async applyCorporateCustomer(order: Order, customer: CorporateCustomer) {
    const patch: any = {
      customerPaymentInfo: {
        customerId: customer._id,
        customerName: customer.name1,
        isPaid: false,
      },
    }
    if (customer.discountDetails) {
      patch.discount = customer.discountDetails
    }
    try {
      await this.#orderService.patch(order._id, patch)
      this.resetOverlay()
      this.#snackBar.open(this.#translate.instant('ACTIVE_ORDERS.COMPANY_ASSIGNED', { name: customer.name1 }), undefined, { duration: 2500 })
    } catch (e) {
      console.error(e)
      this.#snackBar.open(this.#translate.instant('ACTIVE_ORDERS.COMPANY_ERROR'), 'OK', { duration: 3000 })
    }
  }

  formatCorporateDiscount(customer: CorporateCustomer): string {
    if (!customer.discountDetails) return ''
    if (customer.discountDetails.discountType === 'percent') {
      return `${customer.discountDetails.discount} % ${this.#translate.instant('ACTIVE_ORDERS.DISCOUNT_LABEL')}`
    }
    return `${customer.discountDetails.discount.toFixed(2)} € ${this.#translate.instant('ACTIVE_ORDERS.DISCOUNT_LABEL')}`
  }

  // --- Gemeinsame Hilfsmethoden ---

  private resetOverlay() {
    this.selectedOrderId.set(null)
    this.overlayView.set('actions')
    this.staffEligibleUsers.set([])
    this.corporateCustomers.set([])
  }

  goBack() {
    this.#router.navigate(['/dashboard'])
  }

  formatPrice(price: number): string {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price)
  }

  calculateTotal(order: Order): number {
    if (!order.lineItems) return 0
    return order.lineItems.reduce((acc: number, item: OrderLineItemSchema) => acc + item.price * item.amount, 0)
  }

  isOverdue(order: Order): boolean {
    const productionTimeMs = (order.estimatedDuration || 0) * 60 * 1000
    const now = new Date().getTime()
    const orderTime = new Date(order.recordingDate).getTime()
    return now - orderTime > productionTimeMs
  }

  getRandomDelay(orderId: string): string {
    if (!orderId) return '0s'
    const seed = orderId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return `-${(seed % 2000) / 1000}s`
  }

  getCombinations(order: Order): OrderLineItemSchema[][] {
    if (!order.lineItems) return []
    const bundles = new Map<number, OrderLineItemSchema[]>()
    order.lineItems.forEach((item: OrderLineItemSchema) => {
      if (item.bundleNumber !== undefined && item.bundleNumber !== null) {
        if (!bundles.has(item.bundleNumber)) {
          bundles.set(item.bundleNumber, [])
        }
        bundles.get(item.bundleNumber)?.push(item)
      }
    })
    return Array.from(bundles.values())
  }

  getUnbundledLineItems(order: Order): OrderLineItemSchema[] {
    if (!order.lineItems) return []
    return order.lineItems.filter((item: any) => item.bundleNumber === undefined || item.bundleNumber === null)
  }
}
