import { effect, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core'
import { BaseService } from '@panary/shared/data-access-infrastructure'
import { ConnectionService } from '@panary/shared/data-access-infrastructure'
import { CorporateCustomer } from '../models/corporate-customer.model'
import { Observer } from 'rxjs'
import { AuthService } from '@panary/domains/auth/data-access'

@Injectable({
  providedIn: 'root',
})
export class CorporateCustomerService extends BaseService<CorporateCustomer> {
  #authService: AuthService = inject(AuthService)
  #documents: WritableSignal<CorporateCustomer[]> = signal([])
  #isLoading: WritableSignal<boolean> = signal(false)
  #isLoaded: WritableSignal<boolean> = signal(false)

  /** PUBLIC PROPERTIES */
  documents: Signal<CorporateCustomer[]> = this.#documents.asReadonly()
  isLoading: Signal<boolean> = this.#isLoading.asReadonly()
  isLoaded: Signal<boolean> = this.#isLoaded.asReadonly()

  /** CONSTRUCTOR */
  protected connectionService: ConnectionService = inject(ConnectionService)
  constructor() {
    super(inject(ConnectionService).corporateCustomerService, 'corporateCustomerService')

    effect((): void => {
      if (this.connectionService.isAuthenticated() && !this.#isLoaded()) {
        this.loadDocuments()
      }
    })
  }

  /** PRIVATE METHODS */
  protected override loadDocuments(): void {
    if (this.#isLoading()) return

    this.#isLoading.set(true)

    const params = {
      query: {
        $sort: { name1: 1 },
        $limit: 500,
      },
    }

    this.find(params)
      .then(response => {
        const documents = Array.isArray(response) ? response : response.data
        this.#documents.set(documents)
        this.#isLoaded.set(true)
      })
      .catch(error => {
        console.error('Fehler beim Laden der Firmenkunden:', error)
      })
      .finally(() => {
        this.#isLoading.set(false)
        console.log(`Gesamtanzahl der Firmenkunden: ${this.#documents().length}`)
      })
  }

  protected override fileReaderOnLoad(
    fileReader: FileReader,
    observer: Observer<any>,
    context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) {
    // Implementation für CSV/Excel Import falls benötigt
  }

  protected override handleItemCreated(item: CorporateCustomer): void {
    const current = this.#documents()
    this.#documents.set([...current, item])
  }

  protected override handleItemUpdated(item: CorporateCustomer): void {
    const current = this.#documents()
    const index = current.findIndex(doc => doc._id === item._id)
    if (index !== -1) {
      const updated = [...current]
      updated[index] = item
      this.#documents.set(updated)
    }
  }

  protected override handleItemRemoved(item: CorporateCustomer): void {
    const current = this.#documents()
    this.#documents.set(current.filter(doc => doc._id !== item._id))
  }
}
