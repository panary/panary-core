import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { DeviceConfigService } from '@panary-core/shared/data-access-config'

/**
 * Setup Guard - Prüft ob Konfiguration vorhanden ist.
 * Leitet zur Login-Seite weiter, wenn das Gerät bereits konfiguriert ist.
 */
export const setupGuard: CanActivateFn = () => {
  const configService = inject(DeviceConfigService)
  const router = inject(Router)

  if (!configService.hasConfig()) {
    return true
  }

  // Wenn Config existiert, zur Login-Seite
  router.navigate(['/login'])
  return false
}
