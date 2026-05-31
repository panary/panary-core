import { InjectionToken } from '@angular/core'

import { OfflineCachePort } from '@panary/shared-common'

/**
 * Token für die optionale Offline-Cache-Implementierung. Nur Apps, die den Cache
 * aktivieren (POS), binden hier eine konkrete Implementierung (`OfflineCacheStore`
 * aus `@panary/shared/offline-cache`). Andere Konsumenten (admin-dashboard) lassen
 * den Token unbelegt → `inject(OFFLINE_CACHE, { optional: true })` liefert `null`,
 * der `BaseService` verhält sich exakt wie ohne Cache.
 */
export const OFFLINE_CACHE = new InjectionToken<OfflineCachePort>('OFFLINE_CACHE')
