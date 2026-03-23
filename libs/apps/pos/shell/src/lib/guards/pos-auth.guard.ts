import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { DeviceConfigService } from '@panary-core/shared/data-access-config'

/**
 * POS Auth Guard - Prüft ob Setup abgeschlossen ist.
 * Leitet zur Setup-Seite weiter, wenn keine Geräte-Konfiguration vorhanden ist.
 */
export const posAuthGuard: CanActivateFn = () => {
  const configService = inject(DeviceConfigService)
  const router = inject(Router)

  if (configService.hasConfig()) {
    return true
  }

  // Wenn keine Config, zur Setup-Seite
  router.navigate(['/setup'])
  return false
}
