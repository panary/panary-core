import { Injectable, inject, signal } from '@angular/core'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { Discount, discountAppliesToChannel, DiscountChannel } from '@panary/discounts/domain'

/**
 * POS-Data-Access für Rabatte. Lädt die am POS auswählbaren (ACTIVE, manuell,
 * Kanal pos) Rabatt-Definitionen, die per Sync vom Cloud-Backend kommen.
 */
@Injectable({ providedIn: 'root' })
export class DiscountService extends BaseService<Discount> {
  protected override entityLabelKey = 'ENTITY.DISCOUNT'

  private readonly _activePosDiscounts = signal<Discount[]>([])
  readonly activePosDiscounts = this._activePosDiscounts.asReadonly()

  constructor() {
    super(inject(ConnectionService).discountsService, 'discountsService')
  }

  /** Lädt manuelle, aktive Rabatte für den POS-Kanal und cached sie in einem Signal. */
  async loadActivePosDiscounts(): Promise<Discount[]> {
    const res = await this.find({ query: { status: 'ACTIVE', method: 'manual', $limit: 200 } })
    const list = (Array.isArray(res) ? res : res.data) as Discount[]
    const posOnly = list.filter(d => discountAppliesToChannel(d, DiscountChannel.POS))
    this._activePosDiscounts.set(posOnly)
    return posOnly
  }

  protected override loadDocuments(): void {
    /* POS lädt gezielt via loadActivePosDiscounts() */
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: { errorMessages: string[]; warnMessages: string[]; successCount: number; multi: boolean },
  ): void {
    /* kein Datei-Import */
  }
}
