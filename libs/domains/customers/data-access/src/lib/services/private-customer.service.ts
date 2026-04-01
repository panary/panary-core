import { Injectable, inject } from '@angular/core'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { PrivateCustomer } from '../models/private-customer.model'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class PrivateCustomerService extends BaseService<PrivateCustomer> {
  protected override entityLabelKey = 'ENTITY.CUSTOMER'

  constructor() {
    super(inject(ConnectionService).privateCustomerService, 'privateCustomerService')
  }

  protected override loadDocuments() {}

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) {}
}
