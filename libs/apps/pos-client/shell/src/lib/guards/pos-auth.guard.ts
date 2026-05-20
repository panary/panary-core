import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { DeviceConfigService } from '@panary/shared/data-access-config'

/**
 * POS Auth Guard — Prueft ob Setup abgeschlossen und ein User eingeloggt ist.
 * Login-Route: Nur wenn Config vorhanden aber kein User eingeloggt.
 * Geschuetzte Routen: Nur wenn Config vorhanden UND User eingeloggt.
 */
export const posAuthGuard: CanActivateFn = (route) => {
  const configService = inject(DeviceConfigService)
  const router = inject(Router)

  if (!configService.hasConfig()) {
    return router.createUrlTree(['/setup'])
  }

  // Login-Route braucht keinen User-Check
  if (route.routeConfig?.path === 'login') {
    return true
  }

  // Geschuetzte Routen: User muss eingeloggt sein
  const storedUser = localStorage.getItem('pos_current_user')
  if (!storedUser) {
    return router.createUrlTree(['/login'])
  }

  return true
}
