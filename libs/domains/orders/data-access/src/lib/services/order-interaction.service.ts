import { BaseService, ConnectionService } from '@panary/shared/data-access'

import { inject, Injectable } from '@angular/core'

import { OrderInteraction } from '@panary/order-interactions/domain'

@Injectable({
  providedIn: 'root',
})
export class OrderInteractionService extends BaseService<OrderInteraction> {
  protected override entityLabelKey = 'ENTITY.ORDER_INTERACTION'

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
