import { effect, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { Observer } from 'rxjs'
import { Paginated } from '@feathersjs/feathers'
import { CorporateCustomer } from '@panary-core/corporate-customers/domain'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'

@Injectable({
  providedIn: 'root',
})
export class CorporateCustomerService extends BaseService<CorporateCustomer> {
  protected connectionService: ConnectionService = inject(ConnectionService)

  #customers: WritableSignal<CorporateCustomer[]> = signal([])

  get customers(): Signal<CorporateCustomer[]> {
    return this.#customers.asReadonly()
  }

  constructor() {
    super(inject(ConnectionService).corporateCustomerService, 'corporateCustomerService')

    effect((): void => {
      if (this.connectionService.isAuthenticated()) {
        this.loadDocuments()
      }
    })
  }

  protected override handleItemCreated(document: CorporateCustomer) {
    this.#customers.update(current => [...current, document])
  }

  protected override handleItemUpdated(document: CorporateCustomer) {
    this.#customers.update(current => {
      const index = current.findIndex(c => c._id === document._id)
      if (index >= 0) {
        const updated = [...current]
        updated[index] = document
        return updated
      }
      return [...current, document]
    })
  }

  protected override handleItemRemoved(document: CorporateCustomer) {
    this.#customers.update(current => current.filter(c => c._id !== document._id))
  }

  protected override loadDocuments() {
    this.find({ query: { $limit: 200 } }).then((response: Paginated<CorporateCustomer> | CorporateCustomer[]) => {
      this.#customers.set(Array.isArray(response) ? response : response.data)
    })
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) {
    /* empty */
  }
}
