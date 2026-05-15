import { inject, Injectable, signal } from '@angular/core'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { BusinessDay } from '@panary-core/businessdays/domain'

@Injectable({ providedIn: 'root' })
export class BusinessDayService extends BaseService<BusinessDay> {
  protected override entityLabelKey = 'ENTITY.BUSINESS_DAY'
  protected connectionService = inject(ConnectionService)

  #currentBusinessDay = signal<BusinessDay | null>(null)
  currentBusinessDay = this.#currentBusinessDay.asReadonly()

  constructor() {
    super(inject(ConnectionService).businessDayService, 'businessDayService')
  }

  protected override loadDocuments(): void {
    // Stub
  }

  /**
   * Tag eroeffnen — ruft Edge-Custom-Method `openDay` auf.
   * Bei pos-cashier-Mode wird der opening-float in Cents geschickt.
   */
  async openDay(opts: { locationId?: string | null; openingFloatCents?: number } = {}): Promise<BusinessDay> {
    const service = this.connectionService.businessDayService as unknown as {
      openDay: (data: unknown) => Promise<BusinessDay>
    }
    const result = await service.openDay({
      locationId: opts.locationId,
      openingFloatCents: opts.openingFloatCents,
    })
    this.#currentBusinessDay.set(result)
    return result
  }

  /**
   * Tag schliessen — ruft Edge-Custom-Method `closeDay` auf, die ihrerseits
   * den Cloud-Trigger fuer den Tagesabschluss-Report ausloest.
   */
  async closeDay(opts: {
    businessDayId: string
    countedClosingFloatCents?: number
    cashDropsCents?: number
    payoutsCents?: number
    physicalCounts?: Record<string, number>
  }): Promise<BusinessDay> {
    const service = this.connectionService.businessDayService as unknown as {
      closeDay: (data: unknown) => Promise<BusinessDay>
    }
    const result = await service.closeDay(opts)
    if (!result?.isOpen) this.#currentBusinessDay.set(null)
    return result
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
  ): void {
    // Stub
  }
}
