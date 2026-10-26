import { inject, Injectable } from '@angular/core'
import { WorkingTime } from '@panary/working-times/domain'
import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class WorkingTimeService extends BaseService<WorkingTime> {
  protected override entityLabelKey = 'ENTITY.WORKING_TIME'

  /** PRIVATE PROPERTIES */

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).workingTimeService, 'workingTimeService')
  }

  /**
   * Am POS stumm (core#962): Die technischen Standardmeldungen nannten den Login-Namen und kamen doppelt.
   * Die Rückmeldung gibt die Stempel-Taste bzw. das Stempel-Panel selbst.
   */
  protected override showSnackbar(): void {
    /* noop */
  }

  protected override loadDocuments() {
    /* noop */
  }

  protected override fileReaderOnLoad(
    fileReader: FileReader,
    observer: Observer<any>,
    context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) {
    /* noop */
  }
}
