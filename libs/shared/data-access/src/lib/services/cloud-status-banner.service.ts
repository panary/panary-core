import { computed, inject, Injectable } from '@angular/core'

import { ConnectionService } from './connection.service'
import { TenantSuspensionService } from './tenant-suspension.service'
import { type CloudBanner, selectActiveBanner, tenantSuspensionShown } from './cloud-status-banner.selector'
import { CLOUD_STATUS_BANNER_OPTIONS, OFFLINE_CACHE, OFFLINE_OUTBOX } from './offline-cache.token'

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
  #outbox = inject(OFFLINE_OUTBOX, { optional: true })
  // Nicht belegt (POS) → Defaults; nur der Admin-Client schaltet den
  // Notfall-Banner frei.
  #options = inject(CLOUD_STATUS_BANNER_OPTIONS, { optional: true })
  #suspension = inject(TenantSuspensionService)

  readonly activeBanner = computed<CloudBanner | null>(() => {
    const conn = this.#conn
    const sync = conn.syncStaleness()
    const token = conn.tokenExpiry()
    const connection = conn.connectionState()
    return selectActiveBanner({
      connectionStatus: connection.status,
      offlineCacheActive: this.#offlineCache?.isReady() ?? false,
      // pendingCount() ist ein Signal-Read → das computed() trackt den Outbox-Zähler reaktiv.
      outboxPendingCount: this.#outbox?.pendingCount() ?? 0,
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
      emergencyOverrideActive: conn.emergencyOverrideActive(),
      emergencyOverrideSinceMin: conn.emergencyOverrideSinceMin(),
      showEmergencyOverride: this.#options?.showEmergencyOverride ?? false,
      // Tier 1 und Tier 3: Seit #1401 meldet der gekoppelte Edge die Sperre aus seinem Pull über `/health`.
      // Tier 2 (standalone) hat keine Cloud und damit keine Sperre.
      tenantSuspended: tenantSuspensionShown(conn.tier()) && this.#suspension.suspended(),
      tenantStatus: this.#suspension.tenantStatus(),
    })
  })
}

