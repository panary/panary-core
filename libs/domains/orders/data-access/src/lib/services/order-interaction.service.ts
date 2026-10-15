import { BaseService, ConnectionService } from '@panary/shared/data-access'

import { inject, Injectable } from '@angular/core'

import { OrderInteraction } from '@panary/order-interactions/domain'

@Injectable({
  providedIn: 'root',
})
export class OrderInteractionService extends BaseService<OrderInteraction> {
  protected override entityLabelKey = 'ENTITY.ORDER_INTERACTION'

  /** Journal-Ereignisse entstehen still: „Bestellinteraktion wurde erstellt“ ist keine Bedienermeldung (core#657). */
  protected override showSnackbar(): void {
    /* bewusst leer */
  }

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
