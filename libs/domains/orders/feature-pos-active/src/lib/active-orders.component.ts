import { Component, computed, inject, signal, WritableSignal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatDialog } from '@angular/material/dialog'
import { OrderDialogComponent } from '@panary-core/orders/feature-pos-order-dialog'
import {
  Order,
  OrderLineItemSchema,
  OrderService,
  OrderStatus,
  PaymentState,
  PaymentStateInfo,
  Transaction,
  TransactionMethod,
} from '@panary-core/orders/data-access'
import { AuthService } from '@panary-core/auth/data-access'

@Component({
  selector: 'app-active-orders',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './active-orders.component.html',
  styleUrl: './active-orders.component.scss',
})
export class ActiveOrdersComponent {
  #orderService=inject(OrderService)
  #router=inject(Router)
  #authService=inject(AuthService)

  // Sort orders by recordingDate descending (Newest first)
  sortedOrders=computed(() => {
    return this.#orderService.ordersActive().sort((a, b) => {
      return new Date(b.recordingDate).getTime()-new Date(a.recordingDate).getTime()
    })
  })

  // Provide the orders signal for the template (using sorted ones)
  orders=this.sortedOrders
  protected readonly OrderStatus = OrderStatus

  #matDialog=inject(MatDialog)

  zoomLevel: WritableSignal<number>=signal(0.85) // Default smaller
  selectedOrderId: WritableSignal<string|null>=signal(null)

  increaseZoom() {
    this.zoomLevel.update(z => Math.min(z+0.1, 1.2))
  }

  decreaseZoom() {
    this.zoomLevel.update(z => Math.max(z-0.1, 0.5))
  }

  toggleSelection(orderId: string) {
    if (this.selectedOrderId()===orderId) {
      this.selectedOrderId.set(null)
    } else {
      this.selectedOrderId.set(orderId)
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
    console.log('Print order', order._id)
    // this.#orderService.printOrder(order); // Assuming implementation exists or will define later
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

    const currentUser=this.#authService.user()
    if (!currentUser) {
      console.error('No user logged in')
      return
    }

    const total=this.calculateTotal(order)

    const transaction: Transaction={
      _id: crypto.randomUUID(),
      method: TransactionMethod.CASH,
      amount: total,
      currency: 'EUR',
      timestamp: new Date().toISOString(),
      performedBy: currentUser._id.toString(),
    }

    const paymentInfo: PaymentStateInfo={
      state: PaymentState.PAID,
      totalAmount: total,
      tipAmount: 0,
      transactions: [transaction]
    }

    this.#orderService.patch(order._id, {
      payment: paymentInfo,
      status: OrderStatus.COMPLETED
      // The prompt says "You will likely patch the order with the new payment state."
      // Usually checkout implies completion in simple POS. Let's keep it consistent with previous logic or just set payment.
    }).then(() => {
      // Maybe complete it as well?
      this.#orderService.complete(order._id)
    })
  }

  convertToStaffMeal(order: Order) {
    console.log('Convert to staff meal', order._id)
  }

  cancelOrder(order: Order) {
    console.log('Cancel order', order._id)
  }

  enterDiscount(order: Order) {
    console.log('Enter discount', order._id)
  }

  recordCorporateOrder(order: Order) {
    console.log('Record corporate order', order._id)
  }

  goBack() {
    this.#router.navigate(['/dashboard'])
  }

  // Helper to format price
  formatPrice(price: number): string {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price)
  }

  // Helper to calculate order total
  calculateTotal(order: Order): number {
    // Simplified calculation for display
    if (!order.lineItems) return 0
    return order.lineItems.reduce((acc: number, item: OrderLineItemSchema) => acc+item.price*item.amount, 0)
  }

  // Helper to check if order is overdue (production time exceeded)
  isOverdue(order: Order): boolean {
    const productionTimeMs=(order.estimatedDuration||0)*60*1000
    const now=new Date().getTime()
    const orderTime=new Date(order.recordingDate).getTime()
    return now-orderTime>productionTimeMs
  }

  // Helper to generate a random animation delay to desynchronize pulsing
  getRandomDelay(orderId: string): string {
    // Use order ID to generate a consistent but random-looking delay
    if (!orderId) return '0s'
    const seed=orderId.split('').reduce((acc, char) => acc+char.charCodeAt(0), 0)
    return `-${(seed%2000)/1000}s`
  }

  getCombinations(order: Order): OrderLineItemSchema[][] {
    if (!order.lineItems) return [];
    const bundles=new Map<number, OrderLineItemSchema[]>();
    order.lineItems.forEach((item: OrderLineItemSchema) => {
      if (item.bundleNumber!==undefined&&item.bundleNumber!==null) {
        if (!bundles.has(item.bundleNumber)) {
          bundles.set(item.bundleNumber, []);
        }
        bundles.get(item.bundleNumber)?.push(item);
      }
    });
    return Array.from(bundles.values());
  }

  getUnbundledLineItems(order: Order): OrderLineItemSchema[] {
    if (!order.lineItems) return [];
    return order.lineItems.filter((item: any) => item.bundleNumber===undefined||item.bundleNumber===null);
  }
}
