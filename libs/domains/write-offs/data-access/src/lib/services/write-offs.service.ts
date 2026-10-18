import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { inject, Injectable } from '@angular/core'
import { WriteOff } from '@panary/write-offs/domain'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class WriteOffService extends BaseService<WriteOff> {
  protected override entityLabelKey = 'ENTITY.WRITE_OFF'

  /**
   * „Abschreibung wurde erstellt“ aus dem Realtime-Event doppelt die Erfolgsmeldung des
   * Dialogs (`WRITE_OFF.SAVED`) — gleiche Klasse wie core#657 (core#760).
   */
  protected override showSnackbar(messageKey: string): void {
    if (messageKey === 'SNACKBAR.CREATED' || messageKey === 'SNACKBAR.CREATED_PLURAL') return
    super.showSnackbar(messageKey)
  }

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).writeOffService, 'writeOffService')
  }

  /** PRIVATE METHODS */
  protected override loadDocuments() {
    /* empty */
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
    /* empty */
  }

  /** PUBLIC METHODS */
}
