import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, WritableSignal } from '@angular/core'
import { formatEur } from '@panary/shared/util-helpers'
import { Router } from '@angular/router'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatSnackBar } from '@angular/material/snack-bar'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'
import { MatDialog } from '@angular/material/dialog'
import { ExtendedParams } from '@panary/shared-common'
import { ConfirmDialogComponent, EurPipe, IconComponent, PosSplitComponent } from '@panary/shared/ui-common'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

@Component({
  selector: 'lib-pre-order-list',
  standalone: true,
  imports: [IconComponent, CommonModule, EurPipe, FormsModule, TranslateModule, PosSplitComponent],
  template: `
    <div class="h-full w-full bg-surface-bg p-4 md:p-6 flex flex-col gap-6 overflow-hidden max-h-screen box-border">
      <!-- Header & Filters -->
      <header class="flex-none flex flex-col gap-4 bg-surface-input rounded-2xl p-4 shadow-sm border border-line-soft">
        <div class="flex flex-row items-center justify-between">
          <div class="flex items-center gap-4">
            <button
              (click)="goBack()"
              class="flex items-center justify-center w-10 h-10 bg-surface-elevated text-ink-muted dark:text-ink rounded-xl hover:bg-line transition-colors"
            >
              <lib-icon name="arrow-left" class="text-[1.25rem]" />
            </button>
            <h1 class="text-xl font-bold text-ink flex items-center gap-2">
              <lib-icon name="calendar-dots" class="text-[1.25rem] text-accent-ink" />
              {{ 'PRE_ORDERS.TITLE' | translate }}
            </h1>
            <!-- Mobil: runder Icon-Button -->
            <button
              (click)="openKasse()"
              class="ml-4 md:hidden flex items-center justify-center w-10 h-10 rounded-full bg-action text-on-action hover:brightness-95 active:scale-95 transition-all"
            >
              <lib-icon name="plus" class="text-[1.375rem]" />
            </button>
            <!-- Desktop: Button mit Text -->
            <button
              (click)="openKasse()"
              class="ml-4 hidden md:flex items-center gap-2 h-10 px-4 bg-action text-on-action rounded-xl font-medium hover:brightness-95 active:scale-95 transition-all"
            >
              <lib-icon name="plus-circle" class="text-[1.25rem]" />
              {{ 'PRE_ORDERS.NEW_PRE_ORDER' | translate }}
            </button>
          </div>

          <!-- Empty right side since button moved left -->
          <div class="flex gap-2"></div>
        </div>

        <div class="relative">
          <lib-icon
            name="magnifying-glass"
            class="text-[1.25rem] absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="text"
            [(ngModel)]="searchQuery"
            (keyup.enter)="fetchOrders()"
            [placeholder]="'PRE_ORDERS.SEARCH_PLACEHOLDER' | translate"
            class="w-full h-12 pl-10 pr-4 rounded-xl bg-surface-elevated border-none outline-none focus:ring-2 focus:ring-accent-line transition-all text-ink placeholder:text-[0.6875rem] placeholder:md:text-sm placeholder:text-ink-faint"
          />
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-action text-on-action rounded-lg shadow-sm hover:brightness-95 active:scale-95 transition-all"
            (click)="fetchOrders()"
          >
            <lib-icon name="arrow-right" class="text-[1.25rem]" />
          </button>
        </div>
      </header>

      <!-- Content -->
      <lib-pos-split class="flex-1" [detailOpen]="selectedOrder() !== null">
        <!-- Order List -->
        <div posSplitList class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
          @if (loading()) {
            <div
              class="flex-1 bg-surface-input rounded-2xl border border-line-soft flex justify-center items-center flex-col gap-4"
            >
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-ink"></div>
              <span class="text-ink-faint text-sm">{{ 'PRE_ORDERS.LOADING' | translate }}</span>
            </div>
          } @else if (orders().length === 0) {
            <div
              class="flex-1 bg-surface-input rounded-2xl border border-line-soft flex justify-center items-center flex-col gap-3 text-ink-muted text-center p-6"
            >
              <lib-icon name="calendar-x" class="text-[3rem]" />
              <span class="font-medium">
                {{ (searchQuery().trim() ? 'PRE_ORDERS.NONE_FOUND' : 'PRE_ORDERS.NONE_YET') | translate }}
              </span>
              @if (!searchQuery().trim()) {
                <button
                  (click)="openKasse()"
                  class="h-10 px-4 rounded-xl bg-action text-on-action font-medium hover:brightness-95 active:scale-95 transition-all"
                >
                  {{ 'PRE_ORDERS.NONE_YET_ACTION' | translate }}
                </button>
              }
            </div>
          } @else {
            @for (group of groups(); track group.key) {
              <div class="text-xs font-bold uppercase tracking-wider text-ink-muted px-0.5 pt-1">
                @if (group.kind === 'date') {
                  {{ group.date | date: 'EEEE, dd.MM.' }}
                } @else {
                  {{ 'PRE_ORDERS.GROUP_' + group.kind.toUpperCase() | translate }} · {{ group.date | date: 'EEEE' }}
                }
              </div>
              <div class="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
                @for (order of group.orders; track order._id) {
                  <div
                    class="p-4 rounded-xl border border-line-soft bg-surface-input hover:bg-surface-elevated cursor-pointer transition-all group"
                    [class.ring-2]="selectedOrder()?._id === order._id"
                    [class.ring-accent-line]="selectedOrder()?._id === order._id"
                    (click)="toggleOrderSelection(order)"
                    (keydown.enter)="toggleOrderSelection(order)"
                    tabindex="0"
                    role="button"
                  >
                    <div class="flex justify-between items-start gap-2 font-bold text-ink">
                      <span class="truncate">{{ order.customerContact.name }}</span>
                      <span class="font-mono tabular-nums">{{ order.scheduledFor | date: 'HH:mm' }}</span>
                    </div>
                    <div class="text-xs text-ink-muted flex items-center gap-1 mt-1">
                      <lib-icon name="phone" class="text-[0.75rem]" />
                      {{ order.customerContact.phone }}
                    </div>
                    <div class="flex justify-between items-center mt-3 gap-2">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs text-ink-muted bg-line-soft px-2 py-0.5 rounded-full">
                          {{ order.lineItems.length }} {{ 'COMMON.ITEMS' | translate }}
                        </span>
                        @if ($any(order).dineLocation === 'dine-in') {
                          <span
                            class="text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full"
                          >
                            🍽 {{ 'PRE_ORDERS.DINE_IN' | translate }}
                          </span>
                        } @else {
                          <span
                            class="text-xs font-medium text-orange-600 bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 rounded-full"
                          >
                            🥡 {{ 'PRE_ORDERS.TAKE_OUT' | translate }}
                          </span>
                        }
                      </div>
                      <span class="font-bold text-ink">{{ calculateTotal(order) | eur }}</span>
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>

        <!-- Order Detail -->
        @if (selectedOrder()) {
          <div
            posSplitDetail
            class="flex-1 bg-surface-input rounded-2xl shadow-sm border border-line-soft overflow-hidden flex flex-col"
          >
            <!-- Detail Header -->
            <div class="p-4 border-b border-line-soft flex justify-between items-center bg-surface-elevated">
              <div>
                <h2 class="font-bold text-lg text-ink">{{ 'PRE_ORDERS.DETAILS' | translate }}</h2>
                <p class="text-xs text-ink-muted">
                  {{ selectedOrder()?.scheduledFor | date: 'dd.MM.yyyy HH:mm' }}
                </p>
              </div>
              <button
                (click)="selectedOrder.set(null)"
                class="lg:hidden flex items-center justify-center w-10 h-10 text-ink-muted rounded-xl hover:bg-line-soft transition-colors"
              >
                <lib-icon name="x" class="text-[1.25rem]" />
              </button>
            </div>

            <!-- Detail Content -->
            <div class="flex-1 overflow-y-auto p-4">
              <!-- Customer Card -->
              <div class="mb-4 p-4 bg-accent-soft rounded-xl border border-accent-line">
                <div class="font-bold text-ink text-lg">
                  {{ selectedOrder()?.customerContact?.name }}
                </div>
                <div class="text-accent-ink flex items-center gap-2 mt-1">
                  <lib-icon name="phone" class="text-[1rem]" />
                  {{ selectedOrder()?.customerContact?.phone }}
                </div>
                @if (selectedOrder()?.note) {
                  <div class="mt-2 text-sm text-ink-muted italic border-t border-accent-line pt-2">
                    "{{ selectedOrder()?.note }}"
                  </div>
                }
              </div>

              <!-- Receipt View -->
              <div
                class="bg-surface-elevated border border-line-soft rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)]"
              >
                <div class="space-y-3 font-mono text-sm">
                  @for (item of selectedOrder()?.lineItems; track item) {
                    <div class="flex justify-between items-start">
                      <div class="flex gap-2">
                        <span class="font-bold">{{ item.amount }}x</span>
                        <span>{{ item.name }}</span>
                      </div>
                      <span>{{ item.price * item.amount | eur }}</span>
                    </div>
                  }
                </div>

                <div class="mt-6 pt-4 border-t-2 border-ink flex justify-between items-center text-lg font-bold">
                  <span>{{ 'COMMON.TOTAL' | translate }}</span>
                  <span>{{ calculateTotal(selectedOrder()!) | eur }}</span>
                </div>
              </div>

              <!-- Metadata Actions -->
              @if (selectedOrder()?.status === 'pending') {
                <div class="mt-6 grid grid-cols-2 gap-3">
                  <button
                    class="col-span-2 h-12 rounded-lg bg-action text-on-action font-bold hover:brightness-95 active:scale-95 transition-all flex items-center justify-center gap-2"
                    (click)="convertToLiveOrder(selectedOrder()!)"
                  >
                    <lib-icon name="cash-register" class="text-[1.25rem]" />
                    {{ 'PRE_ORDERS.CREATE_ORDER' | translate }}
                  </button>

                  <button
                    class="col-span-2 h-12 rounded-lg bg-surface-elevated border border-line text-red-600 font-medium hover:bg-red-50 dark:hover:bg-red-900/30 active:scale-95 transition-all flex items-center justify-center gap-2"
                    (click)="cancelOrder(selectedOrder()!)"
                  >
                    <lib-icon name="trash" class="text-[1.25rem]" />
                    {{ 'PRE_ORDERS.CANCEL_ORDER' | translate }}
                  </button>
                </div>
              }
              @if (selectedOrder()?.status !== 'pending') {
                <div class="mt-6 text-center text-ink-faint text-sm">
                  {{
                    selectedOrder()?.status === 'converted'
                      ? ('PRE_ORDERS.ALREADY_COMPLETED' | translate)
                      : ('PRE_ORDERS.ALREADY_CANCELED' | translate)
                  }}
                  .
                </div>
              }
            </div>
          </div>
        }

        <!-- Placeholder -->
        @if (!selectedOrder()) {
          <div
            posSplitDetail
            class="hidden lg:flex flex-1 bg-surface-bg/50 border border-dashed border-line rounded-2xl justify-center items-center text-ink-faint flex-col gap-2"
          >
            <lib-icon name="calendar-dots" class="text-[3rem] opacity-20" />
            <span class="text-sm font-medium opacity-50">{{ 'PRE_ORDERS.SELECT_PRE_ORDER' | translate }}</span>
          </div>
        }
      </lib-pos-split>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
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

  // Nach Abholtag gruppiert (Heute, Morgen, Datum); die Liste kommt bereits aufsteigend sortiert.
  groups = computed(() => {
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const today = new Date()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const result: { key: string; kind: 'today' | 'tomorrow' | 'date'; date: Date; orders: PreOrder[] }[] = []
    for (const order of this.orders()) {
      const date = new Date(order.scheduledFor)
      const key = dayKey(date)
      let group = result.find(g => g.key === key)
      if (!group) {
        const kind = key === dayKey(today) ? 'today' : key === dayKey(tomorrow) ? 'tomorrow' : 'date'
        group = { key, kind, date, orders: [] }
        result.push(group)
      }
      group.orders.push(order)
    }
    return result
  })

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

  // Vorbestellungen entstehen in der Kasse (core#828); die Liste lädt beim Zurückkehren neu.
  openKasse() {
    this.#router.navigate(['/kasse'])
  }

  async convertToLiveOrder(order: PreOrder) {
    const total = this.calculateTotal(order)
    const totalFormatted = formatEur(total)

    const ref = this.#dialog.open(ConfirmDialogComponent, {
      width: '23.75rem',
      maxWidth: '95vw',
      panelClass: 'rounded-dialog',
      data: {
        title: this.#translate.instant('PRE_ORDERS.CREATE_ORDER'),
        message: this.#translate.instant('PRE_ORDERS.CONVERT_MESSAGE', { name: order.customerContact.name }),
        detail: `${order.lineItems.length} ${this.#translate.instant('COMMON.ITEMS')} · ${totalFormatted}`,
        confirmText: this.#translate.instant('PRE_ORDERS.CONVERT_NOW'),
        confirmVariant: 'primary',
        icon: 'cash-register',
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
      width: '23.75rem',
      maxWidth: '95vw',
      panelClass: 'rounded-dialog',
      data: {
        title: this.#translate.instant('PRE_ORDERS.CANCEL_ORDER'),
        message: this.#translate.instant('PRE_ORDERS.CANCEL_MESSAGE'),
        confirmText: this.#translate.instant('PRE_ORDERS.CANCEL_CONFIRM'),
        confirmVariant: 'danger',
        icon: 'trash',
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
    return order.lineItems.reduce((acc, item) => acc + item.price * item.amount, 0)
  }
}
