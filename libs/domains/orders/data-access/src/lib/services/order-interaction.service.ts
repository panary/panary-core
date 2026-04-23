import { BaseService, ConnectionService } from '@panary-core/shared/data-access'

import { inject, Injectable } from '@angular/core'

import { OrderInteraction } from '@panary-core/order-interactions/domain'

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
