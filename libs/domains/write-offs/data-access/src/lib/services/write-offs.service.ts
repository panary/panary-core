import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { inject, Injectable } from '@angular/core'
import { WriteOff } from '@panary/write-offs/domain'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class WriteOffService extends BaseService<WriteOff> {
  protected override entityLabelKey = 'ENTITY.WRITE_OFF'

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).writeOffService, 'writeOffService')
  }

  /** PRIVATE METHODS */
  protected override loadDocuments() { /* empty */ }

  protected override fileReaderOnLoad(
    fileReader: FileReader,
    observer: Observer<any>,
    context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) { /* empty */ }

  /** PUBLIC METHODS */
}
