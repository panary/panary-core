import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { Router } from '@angular/router'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'
import { MatSnackBar } from '@angular/material/snack-bar'

@Injectable({
  providedIn: 'root',
})
export class PreOrdersStore {
  /** INJECTIONS */
  #preOrderService = inject(PreOrderService)
  #router = inject(Router)
  #snackBar = inject(MatSnackBar)

  /** OUTPUT SIGNALS */
  readonly items: WritableSignal<PreOrder[]> = signal([])
  readonly isLoading: WritableSignal<boolean> = signal(false)
  readonly filter: WritableSignal<'today' | 'future'> = signal('today')

  /** COMPUTED SIGNALS */
  readonly filteredItems: Signal<PreOrder[]> = computed(() => {
    const allItems = this.items()
    const filterType = this.filter()
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    return allItems
      .filter(item => {
        if (item.status !== 'pending') return false

        const itemDate = new Date(item.scheduledFor)
        const itemDateStr = itemDate.toISOString().split('T')[0]

        if (filterType === 'today') {
          return itemDateStr === todayStr
        } else {
          return itemDateStr > todayStr
        }
      })
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  })

  constructor() {
    this.loadUpcoming()
  }

  /** ACTIONS */
  async loadUpcoming() {
    this.isLoading.set(true)
    try {
      // Assuming we want all pending orders for the active location or generally available
      // If we need location filtering: { locationId: this.#locationService.activeLocation()?._id }
      const result = await this.#preOrderService.find({
        query: {
          status: 'pending',
          $sort: {
            scheduledFor: 1,
          },
        },
      })

      // Feathers might return paginated { total, data } or array
      const data = Array.isArray(result) ? result : result.data
      this.items.set(data)
    } catch (error) {
      console.error('Failed to load pre-orders', error)
      this.#snackBar.open('Fehler beim Laden der Vorbestellungen', 'OK', { duration: 3000 })
    } finally {
      this.isLoading.set(false)
    }
  }

  async convertToLiveOrder(preOrderId: string) {
    this.isLoading.set(true)
    try {
      await this.#preOrderService.convert(preOrderId)

      this.#snackBar.open('Erfolgreich in Kasse übernommen!', 'OK', { duration: 2000 })

      // Update local state: remove the converted order
      this.items.update(current => current.filter(i => i._id !== preOrderId))

      // Navigate to Active Order Detail View
      // Route is configured as 'orders/active' in app.routes.ts
      this.#router.navigate(['/orders/active'])
    } catch (error) {
      console.error('Conversion failed', error)
      this.#snackBar.open('Fehler beim Übernehmen (Kein Geschäftstag?)', 'OK', { duration: 4000 })
    } finally {
      this.isLoading.set(false)
    }
  }
}
