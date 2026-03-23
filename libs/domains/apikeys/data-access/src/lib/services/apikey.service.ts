import { Injectable } from '@angular/core'
import { Apikey } from '../models/apikey.type'
import { BaseService, ConnectionService } from '@panary/shared/data-access-infrastructure'
import { inject } from '@angular/core'

@Injectable({
  providedIn: 'root',
})
export class ApikeyService extends BaseService<Apikey> {
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
