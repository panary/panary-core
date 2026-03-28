import { ChangeDetectionStrategy, Component, inject, OnInit, signal, WritableSignal } from '@angular/core'
import { Router } from '@angular/router'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatSnackBar } from '@angular/material/snack-bar'
import { PreOrder, PreOrderService } from '@panary-core/pre-orders/data-access'
import { MatDialog } from '@angular/material/dialog'
import { ExtendedParams } from '@panary-core/shared/common'
import { OrderDialogComponent } from '@panary-core/orders/feature-pos-order-dialog'

@Component({
  selector: 'app-pre-order-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
  ],
  template: `
    <div class="h-full w-full bg-slate-50 p-4 md:p-6 flex flex-col gap-6 overflow-hidden max-h-screen box-border">
      <!-- Header & Filters -->
      <header class="flex-none flex flex-col gap-4 bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
        <div class="flex flex-row items-center justify-between">
          <div class="flex items-center gap-4">
            <button (click)="goBack()" class="flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
              <span class="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
            <h1 class="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span class="material-symbols-outlined text-[20px] text-indigo-600">event_note</span>
              Vorbestellungen
            </h1>
            <button (click)="openCreateDialog()" class="ml-4 flex items-center gap-2 h-10 px-4 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 active:scale-95 transition-all">
              <span class="material-symbols-outlined text-[20px]">add_circle</span>
              Neue Vorbestellung
            </button>
          </div>

          <!-- Empty right side since button moved left -->
          <div class="flex gap-2">
          </div>
        </div>

        <div class="relative">
          <span class="material-symbols-outlined text-[20px] absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
          <input type="text" [(ngModel)]="searchQuery" (keyup.enter)="fetchOrders()"
                 placeholder="Suche nach Name, Telefon..."
                 class="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-50 border-none outline-none focus:ring-2 focus:ring-indigo-200 transition-all text-slate-700 placeholder:text-slate-400" />
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
        <div class="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col"
             [class.hidden]="selectedOrder() !== null" [class.lg:flex]="true">

          @if (loading()) {
            <div class="flex-1 flex justify-center items-center flex-col gap-4">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <span class="text-slate-400 text-sm">Lade Vorbestellungen...</span>
            </div>
          } @else if (orders().length === 0) {
            <div class="flex-1 flex justify-center items-center flex-col gap-4 text-slate-300">
              <span class="material-symbols-outlined text-[64px]">event_busy</span>
              <span class="font-medium">Keine Vorbestellungen gefunden</span>
            </div>
          } @else {
            <div class="overflow-y-auto p-2 space-y-2">
              @for (order of orders(); track order._id) {
                <div
                  class="p-4 rounded-xl border border-slate-100 bg-white hover:bg-slate-50 hover:shadow-md cursor-pointer transition-all group"
                  [class.ring-2]="selectedOrder()?._id === order._id"
                  [class.ring-indigo-200]="selectedOrder()?._id === order._id"
                  (click)="toggleOrderSelection(order)">

                  <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2">
                       <span class="font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-xs">
                          {{ order.scheduledFor | date: 'dd.MM' }}
                       </span>
                      <span class="text-xs font-bold text-indigo-600">
                          {{ order.scheduledFor | date: 'HH:mm' }} Uhr
                       </span>
                    </div>
                    <span class="font-bold text-slate-800">{{ calculateTotal(order) | currency: 'EUR' }}</span>
                  </div>

                  <div class="font-medium text-slate-700 truncate group-hover:text-indigo-700 transition-colors">
                    {{ order.customerContact.name }}
                  </div>
                  <div class="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <span class="material-symbols-outlined text-[12px]">phone</span>
                    {{ order.customerContact.phone }}
                  </div>

                  <div class="flex justify-between items-center mt-3">
                    <span class="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                       {{ order.lineItems.length }} Artikel
                    </span>

                    @if (order.status === 'converted') {
                      <span
                        class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span class="material-symbols-outlined text-[12px]">check</span> Erledigt
                      </span>
                    } @else if (order.status === 'cancelled') {
                      <span class="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        Storniert
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
          class="flex-1 lg:max-w-[450px] bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
          <!-- Detail Header -->
          <div class="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <div>
              <h2 class="font-bold text-lg text-slate-800">Details</h2>
              <p class="text-xs text-slate-500">{{ selectedOrder()?.scheduledFor | date: 'dd.MM.yyyy HH:mm' }}</p>
            </div>
            <button (click)="selectedOrder.set(null)" class="lg:hidden flex items-center justify-center w-10 h-10 text-slate-500 rounded-xl hover:bg-slate-100 transition-colors">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <!-- Detail Content -->
          <div class="flex-1 overflow-y-auto p-4">
            <!-- Customer Card -->
            <div class="mb-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <div class="font-bold text-indigo-900 text-lg">{{ selectedOrder()?.customerContact?.name }}</div>
              <div class="text-indigo-700 flex items-center gap-2 mt-1">
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
            <div class="bg-white border border-slate-100 rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
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

              <div class="mt-6 pt-4 border-t-2 border-slate-800 flex justify-between items-center text-lg font-bold">
                <span>Summe</span>
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
                In Kasse übernehmen
              </button>

              <button
                class="col-span-2 h-12 rounded-lg bg-white border border-slate-200 text-red-600 font-medium hover:bg-red-50 active:scale-95 transition-all flex items-center justify-center gap-2"
                (click)="cancelOrder(selectedOrder()!)">
                <span class="material-symbols-outlined text-[20px]">delete</span>
                Bestellung stornieren
              </button>
            </div>
            }
            @if (selectedOrder()?.status !== 'pending') {
            <div class="mt-6 text-center text-slate-400 text-sm">
              Diese Bestellung ist bereits {{ selectedOrder()?.status === 'converted' ? 'abgeschlossen' : 'storniert' }}
              .
            </div>
            }
          </div>
        </div>
        }

        <!-- Placeholder -->
        @if (!selectedOrder()) {
        <div
          class="hidden lg:flex flex-1 max-w-[450px] bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl justify-center items-center text-slate-400 flex-col gap-2">
          <span class="material-symbols-outlined text-[48px] opacity-20">event_note</span>
          <span class="text-sm font-medium opacity-50">Wähle eine Vorbestellung</span>
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
    if (!confirm(`Vorbestellung von ${ order.customerContact.name } jetzt in die Kasse übernehmen?`)) return

    try {
      await this.#preOrderService.convert(order._id)
      this.#snackBar.open('Erfolgreich übernommen', 'OK', { duration: 2000 })
      this.fetchOrders() // Refresh list
      // Optionally navigate to active orders if needed, logic from store:
      this.#router.navigate(['/orders/active'])
    } catch (e) {
      console.error(e)
      this.#snackBar.open('Fehler bei der Übernahme', 'OK', { duration: 3000 })
    }
  }

  async cancelOrder(order: PreOrder) {
    if (!confirm(`Vorbestellung wirklich stornieren?`)) return

    try {
      await this.#preOrderService.patch(order._id, { status: 'cancelled' })
      this.#snackBar.open('Vorbestellung storniert', 'OK', { duration: 2000 })
      this.fetchOrders()
    } catch (e) {
      console.error(e)
      this.#snackBar.open('Fehler beim Stornieren', 'OK', { duration: 3000 })
    }
  }

  calculateTotal(order: PreOrder): number {
    if (!order.lineItems) return 0
    return order.lineItems.reduce((acc, item) => acc + (item.price * item.amount), 0)
  }
}
