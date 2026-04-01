import { inject, Injectable } from '@angular/core'
import { WorkingTime } from '../models/working-time.model'
import { MatSnackBar } from '@angular/material/snack-bar'
import { User, UserService } from '@panary-core/users/data-access'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { Observer } from 'rxjs'

@Injectable({
  providedIn: 'root',
})
export class WorkingTimeService extends BaseService<WorkingTime> {
  protected override entityLabelKey = 'ENTITY.WORKING_TIME'

  /** INJECTION */
  #matSnackBar: MatSnackBar = inject(MatSnackBar)
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
    this.#matSnackBar.open(
      `Arbeitszeiterfassung für "${user ? user.loginname : 'einen Benutzer'}" wurde gestartet`,
      WorkingTimeService.SNACKBAR_ACTION,
      { duration: WorkingTimeService.SNACKBAR_DURATION },
    )
  }

  protected override handleItemUpdated(document: WorkingTime) {
    const user = this.#userService.users().find((element: User): boolean => element._id === document.userId)
    this.#matSnackBar.open(
      `Arbeitszeit für "${user ? user.loginname : 'einen Benutzer'}" wurde aktualisiert`,
      WorkingTimeService.SNACKBAR_ACTION,
      { duration: WorkingTimeService.SNACKBAR_DURATION },
    )
  }

  protected override handleItemRemoved(document: WorkingTime) {
    const user = this.#userService.users().find((element: User): boolean => element._id === document.userId)
    this.#matSnackBar.open(
      `Arbeitszeiterfassung für "${user ? user.loginname : 'einen Benutzer'}" wurde beendet`,
      WorkingTimeService.SNACKBAR_ACTION,
      { duration: WorkingTimeService.SNACKBAR_DURATION },
    )
  }

  protected override loadDocuments() { /* noop */ }

  protected override fileReaderOnLoad(
    fileReader: FileReader,
    observer: Observer<any>,
    context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) { /* noop */ }
}
