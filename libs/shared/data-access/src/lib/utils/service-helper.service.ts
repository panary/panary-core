import { inject, Injectable } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { FeathersError } from '@feathersjs/errors'
import { httpErrorCodesDE } from '@panary/shared/util-error-handling'
import { NotificationService } from '@panary/shared/data-access-notifications'
import { Router } from '@angular/router'

@Injectable({
  providedIn: 'root',
})
export class ServiceHelper {
  static readonly SNACKBAR_ACTION: string = 'OK'
  static readonly SNACKBAR_DURATION: number = 2500

  protected readonly notificationService: NotificationService = inject(NotificationService)
  protected readonly router: Router = inject(Router)
  protected readonly matSnackBar: MatSnackBar = inject(MatSnackBar)

  /**
   * Handles errors by displaying appropriate notifications and performing specific actions
   * depending on the error code, such as logging out for unauthorized access.
   *
   * @param {string} serviceName - The name of the service where the error occurred.
   * @param {FeathersError | any} error - The error object containing details about the error.
   * @return {void} This method does not return anything.
   */
  handleError(serviceName: string, error: FeathersError | any): void {
    const ERROR_DUPLICATE_KEY_MSG = 'Ein Eintrag mit diesem Schlüssel existiert bereits.'
    const ERROR_ICON = 'error' // Fehler-Icon von FontAwesome
    const ERROR_BG_COLOR = 'error'

    const getErrorPhrase = (code: string | number): string => {
      try {
        return httpErrorCodesDE.getErrorPhrase(code)
      } catch (err: any) {
        console.warn(`Fehler beim Abrufen des Error Phrases: ${err}`)
        return ''
      }
    }

    const formatNotificationMessage = (errorPhrase: string, errorMsg: string): string => {
      return `${errorPhrase}\n${errorMsg}`
    }

    const handleUnauthorizedError = (): void => {
      if (error.code === 401) {
        sessionStorage.clear()
        this.router.navigate(['/login']).then()
      }
    }

    const logError = (): void => {
      console.error(`Service "${serviceName}" hat einen Fehler:`, error)
    }

    // Logik für Fehlerbehandlung
    if (error && error.message && error.message.startsWith('E11000 duplicate key')) {
      error.message = ERROR_DUPLICATE_KEY_MSG
    }

    const code = error?.code || 500
    const errorPhrase = getErrorPhrase(code)
    const message = error?.message || 'Unbekannter Fehler'
    const notificationMessage = formatNotificationMessage(errorPhrase, message)

    this.notificationService.show('error', notificationMessage, 5000, `Fehler HTTP-Code ${code}`)

    handleUnauthorizedError()
    logError()
  }

  showSnackbar(message: string): void {
    this.matSnackBar.open(message, ServiceHelper.SNACKBAR_ACTION, {
      duration: ServiceHelper.SNACKBAR_DURATION,
    })
  }
}
