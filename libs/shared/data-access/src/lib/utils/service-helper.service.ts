import { inject, Injectable } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { FeathersError } from '@feathersjs/errors'
import { httpErrorCodesDE } from '@panary-core/util-error-handling'
import { NotificationService } from '@panary-core/shared/ui-notifications'
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

  handleError(serviceName: string, error: FeathersError | unknown): void {
    const ERROR_DUPLICATE_KEY_MSG = 'Ein Eintrag mit diesem Schlüssel existiert bereits.'

    const getErrorPhrase = (code: string | number): string => {
      try {
        return httpErrorCodesDE.getErrorPhrase(code)
      } catch (err: unknown) {
        console.warn(`Fehler beim Abrufen des Error Phrases: ${String(err)}`)
        return ''
      }
    }

    const e = error as Record<string, unknown> | null | undefined

    const errorMessage = typeof e?.['message'] === 'string' ? e['message'] : undefined
    const errorCode = typeof e?.['code'] === 'number' ? e['code'] : undefined

    // Logik für Fehlerbehandlung
    const displayMessage =
      errorMessage?.startsWith('E11000 duplicate key') ? ERROR_DUPLICATE_KEY_MSG : (errorMessage ?? 'Unbekannter Fehler')

    const code = errorCode ?? 500
    const errorPhrase = getErrorPhrase(code)
    const notificationMessage = `${errorPhrase}\n${displayMessage}`

    this.notificationService.show('error', notificationMessage, 5000, `Fehler HTTP-Code ${code}`)

    if (code === 401) {
      sessionStorage.clear()
      this.router.navigate(['/login']).then()
    }

    console.error(`Service "${serviceName}" hat einen Fehler:`, error)
  }

  showSnackbar(message: string): void {
    this.matSnackBar.open(message, ServiceHelper.SNACKBAR_ACTION, {
      duration: ServiceHelper.SNACKBAR_DURATION,
    })
  }
}
