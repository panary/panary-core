import { ChangeDetectionStrategy, Component, inject, OnInit, signal, WritableSignal } from '@angular/core'
import { Router } from '@angular/router'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatSnackBar } from '@angular/material/snack-bar'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'
import { MatDialog } from '@angular/material/dialog'
import { ExtendedParams } from '@panary/shared-common'
import { OrderDialogComponent } from '@panary/orders/feature-pos-order-dialog'
import { ConfirmDialogComponent } from '../confirm-dialog.component'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

@Component({
  selector: 'lib-pre-order-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
  ],
  template: `
    <div class="h-full w-full bg-gray-50 dark:bg-black p-4 md:p-6 flex flex-col gap-6 overflow-hidden max-h-screen box-border">
      <!-- Header & Filters -->
      <header class="flex-none flex flex-col gap-4 bg-white dark:bg-gray-950 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-800">
        <div class="flex flex-row items-center justify-between">
          <div class="flex items-center gap-4">
            <button (click)="goBack()" class="flex items-center justify-center w-10 h-10 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <span class="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
            <h1 class="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-[20px] text-indigo-600">event_note</span>
              {{ 'PRE_ORDERS.TITLE' | translate }}
            </h1>
            <!-- Mobil: runder Icon-Button -->
            <button (click)="openCreateDialog()" class="ml-4 md:hidden flex items-center justify-center w-10 h-10 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all">
              <span class="material-symbols-outlined text-[22px]">add</span>
            </button>
            <!-- Desktop: Button mit Text -->
            <button (click)="openCreateDialog()" class="ml-4 hidden md:flex items-center gap-2 h-10 px-4 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 active:scale-95 transition-all">
              <span class="material-symbols-outlined text-[20px]">add_circle</span>
              {{ 'PRE_ORDERS.NEW_PRE_ORDER' | translate }}
            </button>
          </div>

          <!-- Empty right side since button moved left -->
          <div class="flex gap-2">
          </div>
        </div>

        <div class="relative">
          <span class="material-symbols-outlined text-[20px] absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
          <input type="text" [(ngModel)]="searchQuery" (keyup.enter)="fetchOrders()"
                 [placeholder]="'PRE_ORDERS.SEARCH_PLACEHOLDER' | translate"
                 class="w-full h-12 pl-10 pr-4 rounded-xl bg-gray-50 dark:bg-gray-800 border-none outline-none focus:ring-2 focus:ring-indigo-200 transition-all text-gray-700 dark:text-gray-200 placeholder:text-[11px] placeholder:md:text-sm placeholder:text-gray-400" />
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 active:scale-95 transition-all"
            (click)="fetchOrders()">
            <span class="material-symbols-outlined text-[20px]">arrow_forward</span>
          </button>
        </div>
      </header>

      <!-- Content -->
      <div class="flex-1 flex gap-6 min-h-0">
        <!-- Order List -->
        <div class="flex-1 bg-white dark:bg-gray-950 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col"
             [class.hidden]="selectedOrder() !== null" [class.lg:flex]="true">

          @if (loading()) {
            <div class="flex-1 flex justify-center items-center flex-col gap-4">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <span class="text-gray-400 text-sm">{{ 'PRE_ORDERS.LOADING' | translate }}</span>
            </div>
          } @else if (orders().length === 0) {
            <div class="flex-1 flex justify-center items-center flex-col gap-4 text-gray-300">
              <span class="material-symbols-outlined text-[64px]">event_busy</span>
              <span class="font-medium">{{ 'PRE_ORDERS.NONE_FOUND' | translate }}</span>
            </div>
          } @else {
            <div class="overflow-y-auto p-2 space-y-2">
              @for (order of orders(); track order._id) {
                <div
                  class="p-4 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-800 hover:shadow-md cursor-pointer transition-all group"
                  [class.ring-2]="selectedOrder()?._id === order._id"
                  [class.ring-indigo-200]="selectedOrder()?._id === order._id"
                  (click)="toggleOrderSelection(order)"
                  (keydown.enter)="toggleOrderSelection(order)"
                  tabindex="0"
                  role="button">

                  <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2">
                       <span class="font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-xs">
                          {{ order.scheduledFor | date: 'dd.MM' }}
                       </span>
                      <span class="text-xs font-bold text-indigo-600">
                          {{ order.scheduledFor | date: 'HH:mm' }} Uhr
                       </span>
                    </div>
                    <span class="font-bold text-gray-800 dark:text-white">{{ calculateTotal(order) | currency: 'EUR' }}</span>
                  </div>

                  <div class="font-medium text-gray-700 dark:text-gray-200 truncate group-hover:text-indigo-700 transition-colors">
                    {{ order.customerContact.name }}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-1">
                    <span class="material-symbols-outlined text-[12px]">phone</span>
                    {{ order.customerContact.phone }}
                  </div>

                  <div class="flex justify-between items-center mt-3">
                    <div class="flex items-center gap-1.5">
                      <span class="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                         {{ order.lineItems.length }} {{ 'COMMON.ITEMS' | translate }}
                      </span>
                      @if ($any(order).dineLocation === 'dine-in') {
                        <span class="text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                          🍽 {{ 'PRE_ORDERS.DINE_IN' | translate }}
                        </span>
                      } @else {
                        <span class="text-xs font-medium text-orange-600 bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
                          🥡 {{ 'PRE_ORDERS.TAKE_OUT' | translate }}
                        </span>
                      }
                    </div>

                    @if (order.status === 'converted') {
                      <span
                        class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span class="material-symbols-outlined text-[12px]">check</span> {{ 'COMMON.DONE' | translate }}
                      </span>
                    } @else if (order.status === 'cancelled') {
                      <span class="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        {{ 'COMMON.CANCELED' | translate }}
                      </span>
                    } @else {
                      <span class="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                         Offen
                       </span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Order Detail -->
        @if (selectedOrder()) {
        <div
          class="flex-1 lg:max-w-[450px] bg-white dark:bg-gray-950 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col">
          <!-- Detail Header -->
          <div class="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
            <div>
              <h2 class="font-bold text-lg text-gray-800 dark:text-white">{{ 'PRE_ORDERS.DETAILS' | translate }}</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ selectedOrder()?.scheduledFor | date: 'dd.MM.yyyy HH:mm' }}</p>
            </div>
            <button (click)="selectedOrder.set(null)" class="lg:hidden flex items-center justify-center w-10 h-10 text-gray-500 dark:text-gray-400 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <!-- Detail Content -->
          <div class="flex-1 overflow-y-auto p-4">
            <!-- Customer Card -->
            <div class="mb-4 p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-100 dark:border-indigo-800">
              <div class="font-bold text-indigo-900 dark:text-indigo-200 text-lg">{{ selectedOrder()?.customerContact?.name }}</div>
              <div class="text-indigo-700 dark:text-indigo-300 flex items-center gap-2 mt-1">
                <span class="material-symbols-outlined text-[16px]">phone</span>
                {{ selectedOrder()?.customerContact?.phone }}
              </div>
              @if (selectedOrder()?.note) {
                <div class="mt-2 text-sm text-indigo-800 italic border-t border-indigo-200 pt-2">
                  "{{ selectedOrder()?.note }}"
                </div>
              }
            </div>

            <!-- Receipt View -->
            <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <div class="space-y-3 font-mono text-sm">
                @for (item of selectedOrder()?.lineItems; track item) {
                  <div class="flex justify-between items-start">
                    <div class="flex gap-2">
                      <span class="font-bold">{{ item.amount }}x</span>
                      <span>{{ item.name }}</span>
                    </div>
                    <span>{{ item.price * item.amount | currency: 'EUR' }}</span>
                  </div>
                }
              </div>

              <div class="mt-6 pt-4 border-t-2 border-gray-800 dark:border-gray-200 flex justify-between items-center text-lg font-bold">
                <span>{{ 'COMMON.TOTAL' | translate }}</span>
                <span>{{ calculateTotal(selectedOrder()!) | currency: 'EUR' }}</span>
              </div>
            </div>

            <!-- Metadata Actions -->
            @if (selectedOrder()?.status === 'pending') {
            <div class="mt-6 grid grid-cols-2 gap-3">
              <button
                class="col-span-2 h-12 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                (click)="convertToLiveOrder(selectedOrder()!)">
                <span class="material-symbols-outlined text-[20px]">point_of_sale</span>
                {{ 'PRE_ORDERS.CREATE_ORDER' | translate }}
              </button>

              <button
                class="col-span-2 h-12 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-red-600 font-medium hover:bg-red-50 dark:hover:bg-red-900/30 active:scale-95 transition-all flex items-center justify-center gap-2"
                (click)="cancelOrder(selectedOrder()!)">
                <span class="material-symbols-outlined text-[20px]">delete</span>
                {{ 'PRE_ORDERS.CANCEL_ORDER' | translate }}
              </button>
            </div>
            }
            @if (selectedOrder()?.status !== 'pending') {
            <div class="mt-6 text-center text-gray-400 text-sm">
              {{ selectedOrder()?.status === 'converted' ? ('PRE_ORDERS.ALREADY_COMPLETED' | translate) : ('PRE_ORDERS.ALREADY_CANCELED' | translate) }}
              .
            </div>
            }
          </div>
        </div>
        }

        <!-- Placeholder -->
        @if (!selectedOrder()) {
        <div
          class="hidden lg:flex flex-1 max-w-[450px] bg-gray-50/50 dark:bg-gray-950/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl justify-center items-center text-gray-400 flex-col gap-2">
          <span class="material-symbols-outlined text-[48px] opacity-20">event_note</span>
          <span class="text-sm font-medium opacity-50">{{ 'PRE_ORDERS.SELECT_PRE_ORDER' | translate }}</span>
        </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreOrderListComponent implements OnInit {
  #preOrderService = inject(PreOrderService)
  #router = inject(Router)
  #dialog = inject(MatDialog)
  #snackBar = inject(MatSnackBar)
  #translate = inject(TranslateService)

  // Signals
  searchQuery: WritableSignal<string> = signal('')
  orders: WritableSignal<PreOrder[]> = signal([])
  loading: WritableSignal<boolean> = signal(false)
  selectedOrder: WritableSignal<PreOrder | null> = signal(null)

  constructor() {
    // Optional: Effect to reload if needed
  }

  ngOnInit() {
    this.fetchOrders()
  }

  goBack() {
    this.#router.navigate(['/dashboard'])
  }

  async fetchOrders() {
    this.loading.set(true)
    this.selectedOrder.set(null)

    try {
      const queryText = this.searchQuery().trim()
      const now = new Date()

      // Filter: Only future orders (or today's remaining)
      const query: any = {
        scheduledFor: {
          $gte: now.toISOString(),
        },
        status: 'pending',
      }

      const params: ExtendedParams = {
        query: {
          ...query,
          $sort: { scheduledFor: 1 }, // ASC: Next ones first
          $limit: 100,
        },
      }

      const result = await this.#preOrderService.find(params)
      let fetchedOrders: PreOrder[] = []

      if (Array.isArray(result)) {
        fetchedOrders = result
      } else {
        fetchedOrders = result.data
      }

      // Client-Side Search Filter
      if (queryText) {
        const searchLower = queryText.toLowerCase()
        fetchedOrders = fetchedOrders.filter(order => {
          return (
            (order.customerContact.name || '').toLowerCase().includes(searchLower) ||
            (order.customerContact.phone || '').toLowerCase().includes(searchLower)
          )
        })
      }

      this.orders.set(fetchedOrders)
    } catch (error) {
      console.error('Error fetching pre-orders:', error)
      this.orders.set([])
    } finally {
      this.loading.set(false)
    }
  }

  toggleOrderSelection(order: PreOrder) {
    if (this.selectedOrder()?._id === order._id) {
      this.selectedOrder.set(null)
    } else {
      this.selectedOrder.set(order)
    }
  }

  openCreateDialog() {
    const ref = this.#dialog.open(OrderDialogComponent, {
      backdropClass: 'backdrop-blur',
      panelClass: 'fullscreen-dialog',
      width: '98vw',
      height: '95vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      restoreFocus: false,
      disableClose: true,
    })

    ref.afterClosed().subscribe(res => {
      // Refresh in any case, maybe a new one was added
      this.fetchOrders()
    })
  }

  async convertToLiveOrder(order: PreOrder) {
    const total = this.calculateTotal(order)
    const totalFormatted = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(total)

    const ref = this.#dialog.open(ConfirmDialogComponent, {
      width: '380px',
      maxWidth: '95vw',
      panelClass: 'rounded-dialog',
      data: {
        title: this.#translate.instant('PRE_ORDERS.CREATE_ORDER'),
        message: this.#translate.instant('PRE_ORDERS.CONVERT_MESSAGE', { name: order.customerContact.name }),
        detail: `${order.lineItems.length} ${this.#translate.instant('COMMON.ITEMS')} · ${totalFormatted}`,
        confirmText: this.#translate.instant('PRE_ORDERS.CONVERT_NOW'),
        confirmVariant: 'primary',
        icon: 'point_of_sale',
      },
    })

    const confirmed = await ref.afterClosed().toPromise()
    if (!confirmed) return

    try {
      await this.#preOrderService.convert(order._id)
      this.#snackBar.open(this.#translate.instant('PRE_ORDERS.CONVERTED_SUCCESS'), undefined, { duration: 2500 })
      this.fetchOrders()
      this.#router.navigate(['/orders/active'])
    } catch (e) {
      console.error(e)
      this.#snackBar.open(this.#translate.instant('PRE_ORDERS.CONVERT_ERROR'), 'OK', { duration: 3000 })
    }
  }

  async cancelOrder(order: PreOrder) {
    const ref = this.#dialog.open(ConfirmDialogComponent, {
      width: '380px',
      maxWidth: '95vw',
      panelClass: 'rounded-dialog',
      data: {
        title: this.#translate.instant('PRE_ORDERS.CANCEL_ORDER'),
        message: this.#translate.instant('PRE_ORDERS.CANCEL_MESSAGE'),
        confirmText: this.#translate.instant('PRE_ORDERS.CANCEL_CONFIRM'),
        confirmVariant: 'danger',
        icon: 'delete_forever',
      },
    })

    const confirmed = await ref.afterClosed().toPromise()
    if (!confirmed) return

    try {
      await this.#preOrderService.patch(order._id, { status: 'cancelled' })
      this.#snackBar.open(this.#translate.instant('PRE_ORDERS.CANCELED_SUCCESS'), undefined, { duration: 2500 })
      this.fetchOrders()
      this.selectedOrder.set(null)
    } catch (e) {
      console.error(e)
      this.#snackBar.open(this.#translate.instant('PRE_ORDERS.CANCEL_ERROR'), 'OK', { duration: 3000 })
    }
  }

  calculateTotal(order: PreOrder): number {
    if (!order.lineItems) return 0
    return order.lineItems.reduce((acc, item) => acc + (item.price * item.amount), 0)
  }
}
