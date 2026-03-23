import { BaseService, ConnectionService } from '@panary-core/shared/data-access'

import { inject, Injectable } from '@angular/core'

import { OrderInteractionSchema } from '../models/order-interaction.model'

@Injectable({
  providedIn: 'root',
})
export class OrderInteractionService extends BaseService<OrderInteractionSchema> {
  //region Constructor
  constructor() {
    super(inject(ConnectionService).orderInteractionService, 'orderInteractionService')
  }
  //endregion

  //region Public Methods
  protected loadDocuments(): void {
    /* empty */
  }

  protected override fileReaderOnLoad() {
    /* empty */
  }
  //endregion
}
