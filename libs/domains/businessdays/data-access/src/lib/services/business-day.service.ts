import { inject, Injectable, signal } from '@angular/core'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { BusinessDay } from '@panary-core/businessdays/domain'

@Injectable({ providedIn: 'root' })
export class BusinessDayService extends BaseService<BusinessDay> {
  protected connectionService = inject(ConnectionService)

  #currentBusinessDay = signal<BusinessDay | null>(null)
  currentBusinessDay = this.#currentBusinessDay.asReadonly()

  constructor() {
    super(inject(ConnectionService).businessDayService, 'businessDayService')
  }

  protected override loadDocuments(): void {
    // Stub
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
