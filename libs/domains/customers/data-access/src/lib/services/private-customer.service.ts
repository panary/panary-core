import { Injectable } from '@angular/core'
import { BaseService } from '@panary/shared/data-access-infrastructure'
import { ConnectionService } from '@panary/shared/data-access-infrastructure'
import { inject } from '@angular/core'
import { PrivateCustomer } from '../models/private-customer.model'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class PrivateCustomerService extends BaseService<PrivateCustomer> {
  constructor() {
    super(inject(ConnectionService).privateCustomerService, 'privateCustomerService')
  }

  protected override loadDocuments() {}

  protected override fileReaderOnLoad(
    fileReader: FileReader,
    observer: Observer<any>,
    context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) {}
}
