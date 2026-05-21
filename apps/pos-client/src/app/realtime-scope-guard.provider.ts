import { inject, Provider } from '@angular/core'
import {
  REALTIME_SCOPE_GUARD,
  RealtimeScopeGuard,
  matchesRealtimeScope,
} from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

/**
 * Defense-in-Depth-Scope-Guard fuer den POS-Client.
 *
 * Das Geraet ist fest an EINEN Tenant + EINE Filiale gebunden (DeviceConfig).
 * Eingehende Realtime-Events fremder Tenants/Filialen werden verworfen, bevor
 * sie in den lokalen State gemerged werden. Am single-location-Edge ist das ein
 * No-op (alle Events tragen ohnehin die eine Filiale) — relevant nur, falls der
 * POS direkt mit der Cloud verbunden ist oder bei Fehlkonfiguration.
 */
export const providePosRealtimeScopeGuard = (): Provider => ({
  provide: REALTIME_SCOPE_GUARD,
  useFactory: (): RealtimeScopeGuard => {
    const deviceConfig = inject(DeviceConfigService)
    return {
      shouldAccept: (item: unknown): boolean =>
        matchesRealtimeScope(item, {
          tenantId: deviceConfig.getTenantId(),
          activeLocationId: deviceConfig.getLocationId(),
        }),
    }
  },
})
