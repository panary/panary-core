import { inject, Injectable } from '@angular/core'
import { WorkingTime } from '@panary/working-times/domain'
import { User, UserService } from '@panary/users/data-access'
import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class WorkingTimeService extends BaseService<WorkingTime> {
  protected override entityLabelKey = 'ENTITY.WORKING_TIME'

  /** INJECTION */
  #userService: UserService = inject(UserService)

  /** PRIVATE PROPERTIES */

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).workingTimeService, 'workingTimeService')
  }

  /** PRIVATE METHODS */
  protected override handleItemCreated(document: WorkingTime) {
    const user: undefined | User = this.#userService
      .users()
      .find((element: User): boolean => element._id === document.userId)
    this.notifications.success(`Arbeitszeiterfassung für "${user ? user.loginname : 'einen Benutzer'}" wurde gestartet`)
  }

  protected override handleItemUpdated(document: WorkingTime) {
    const user = this.#userService.users().find((element: User): boolean => element._id === document.userId)
    this.notifications.success(`Arbeitszeit für "${user ? user.loginname : 'einen Benutzer'}" wurde aktualisiert`)
  }

  protected override handleItemRemoved(document: WorkingTime) {
    const user = this.#userService.users().find((element: User): boolean => element._id === document.userId)
    this.notifications.success(`Arbeitszeiterfassung für "${user ? user.loginname : 'einen Benutzer'}" wurde beendet`)
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
