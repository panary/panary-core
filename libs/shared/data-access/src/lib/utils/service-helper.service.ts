import { inject, Injectable } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { FeathersError } from '@feathersjs/errors'
import { httpErrorCodesDE } from '@panary/util-error-handling'
import { NotificationService } from '@panary/shared/ui-notifications'
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

    // Erwartbare Kontext-403: Ein Plattform-User ohne aktive Impersonation trifft
    // einen tenant-scoped Service ("Tenant-Kontext fehlt" / "… aktiven Tenant-
    // Kontext (Impersonation) …"). Das ist erwartetes Verhalten, kein User-Fehler
    // → keinen Toast zeigen (nur Console-Log). Echte Permission-403 (andere
    // Message) toasten weiterhin normal.
    if (code === 403 && typeof errorMessage === 'string' && errorMessage.includes('Tenant-Kontext')) {
      console.warn(`Service "${serviceName}": erwartbarer Kontext-403 unterdrückt — ${errorMessage}`)
      return
    }

    const errorPhrase = getErrorPhrase(code)

    // AJV-Validation-Details aus FeathersError extrahieren. Server liefert sie
    // in `error.data` (Feathers-Standard) oder `error.errors` (manche Hooks).
    // Format pro Eintrag: { instancePath: '/gln', message: 'must match pattern' }.
    // Ohne diese Details sieht der User nur "validation failed" und weiß nicht,
    // welches Feld zu korrigieren ist.
    const rawDetails = (e?.['data'] ?? e?.['errors']) as unknown
    const detailLines: string[] = []
    if (Array.isArray(rawDetails)) {
      for (const d of rawDetails) {
        if (typeof d !== 'object' || d === null) continue
        const entry = d as { instancePath?: unknown; message?: unknown; params?: unknown }
        const path = typeof entry.instancePath === 'string' && entry.instancePath ? entry.instancePath : '/'
        const msg = typeof entry.message === 'string' ? entry.message : 'invalid'
        // additionalProperty rausziehen — sonst ist `additional properties` ohne Bezug zur Spalte
        const params = entry.params as { additionalProperty?: unknown } | undefined
        const extra =
          params && typeof params.additionalProperty === 'string'
            ? ` (Feld: ${params.additionalProperty})`
            : ''
        detailLines.push(`${path}: ${msg}${extra}`)
        if (detailLines.length >= 10) break
      }
    }

    const notificationMessage = [
      errorPhrase,
      displayMessage,
      ...(detailLines.length > 0 ? ['', 'Details:', ...detailLines] : []),
    ]
      .filter(Boolean)
      .join('\n')

    this.notificationService.show('error', notificationMessage, 7000, `Fehler HTTP-Code ${code}`)

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
