import { computed, inject, Injectable } from '@angular/core'

import { ConnectionService } from './connection.service'
import { type CloudBanner, selectActiveBanner } from './cloud-status-banner.selector'
import { OFFLINE_CACHE } from './offline-cache.token'

/**
 * Liefert den EINEN aktuell anzuzeigenden Cloud-Status-Banner (hoechste
 * Gewichtung gewinnt). Buendelt die `ConnectionService`-Signals zu einem flachen
 * State und delegiert die Prioritaetslogik an die pure `selectActiveBanner()`.
 *
 * Konsumiert vom POS-Client und Admin-Client (`app.ts`) ueber die geteilte
 * `<lib-cloud-status-banner>`-Komponente.
 */
@Injectable({ providedIn: 'root' })
export class CloudStatusBannerService {
  #conn = inject(ConnectionService)
  #offlineCache = inject(OFFLINE_CACHE, { optional: true })

  readonly activeBanner = computed<CloudBanner | null>(() => {
    const conn = this.#conn
    const sync = conn.syncStaleness()
    const token = conn.tokenExpiry()
    const connection = conn.connectionState()
    return selectActiveBanner({
      connectionStatus: connection.status,
      userSessionExpired: conn.userSessionExpired(),
      offlineCacheActive: this.#offlineCache?.isReady() ?? false,
      showsCloudSyncStatus: conn.showsCloudSyncStatus(),
      cloudNeedsRePairing: conn.cloudNeedsRePairing(),
      cloudTokenErrorReason: conn.cloudTokenErrorReason(),
      tokenLevel: token.level,
      tokenRemainingSec: token.remainingSec,
      syncLevel: sync.level,
      syncAgeSec: sync.ageSec,
      cloudUnreachable: conn.cloudUnreachable(),
      offlineModeActive: conn.offlineModeActive(),
      offlineModeRemainingMin: conn.offlineModeRemainingMin(),
      lastCloudContactAgeMin: conn.lastCloudContactAgeMin(),
    })
  })
}
