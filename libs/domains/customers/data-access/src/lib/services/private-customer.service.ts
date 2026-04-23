import { Injectable, inject } from '@angular/core'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { Customer } from '@panary-core/customers/domain'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class PrivateCustomerService extends BaseService<Customer> {
  protected override entityLabelKey = 'ENTITY.CUSTOMER'

  constructor() {
    super(inject(ConnectionService).privateCustomerService, 'privateCustomerService')
  }

  protected override loadDocuments() { /* noop */ }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) { /* noop */ }
}
