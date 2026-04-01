import { Injectable } from '@angular/core'
import { Apikey } from '@panary-core/apikeys/domain'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { inject } from '@angular/core'

@Injectable({
  providedIn: 'root',
})
export class ApikeyService extends BaseService<Apikey> {
  protected override entityLabelKey = 'ENTITY.APIKEY'

  //region Constructor
  constructor() {
    super(inject(ConnectionService).apikeyService, 'apikeysService')
  }
  //endregion

  //region Private Methods
  protected loadDocuments(): void {
    /* empty */
  }

  protected override fileReaderOnLoad() {
    /* empty */
  }
  //endregion
}
