import { inject, Injectable, signal } from '@angular/core'
import { BaseService, ConnectionService } from '@panary/shared/data-access-infrastructure'
import { PreOrder } from '../models/pre-order.model'
import { Service } from '@feathersjs/feathers'
import { Order } from '@panary/domains/orders/data-access'
import { Observer } from 'rxjs'

interface PreOrdersCustomService extends Service<PreOrder> {
  convert(id: string): Promise<Order>
}

@Injectable({
  providedIn: 'root',
})
export class PreOrderService extends BaseService<PreOrder> {
  protected override loadDocuments(): void {
    throw new Error('Method not implemented.')
  }

  protected override fileReaderOnLoad(fileReader: FileReader, observer: Observer<any>, context: {
    errorMessages: string[];
    warnMessages: string[];
    successCount: number;
    multi: boolean
  }): void {
    throw new Error('Method not implemented.')
  }

  #documents = signal<PreOrder[]>([])
  #isLoading = signal<boolean>(false)

  public documents = this.#documents.asReadonly()
  public isLoading = this.#isLoading.asReadonly()

  constructor() {
    super(inject(ConnectionService).preOrdersService, 'preOrdersService')
  }

  /**
   * Converts a PreOrder to a live Order.
   * This calls a custom method on the backend service.
   */
  async convert(id: string): Promise<Order> {
    return (this.service as unknown as PreOrdersCustomService).convert(id)
  }
}
