import { InjectionToken } from '@angular/core'

import { OfflineCachePort, OfflineOutboxPort, OfflineReplayPort } from '@panary/shared-common'

/**
 * Token für die optionale Offline-Cache-Implementierung. Nur Apps, die den Cache
 * aktivieren (POS), binden hier eine konkrete Implementierung (`OfflineCacheStore`
 * aus `@panary/shared/offline-cache`). Andere Konsumenten (admin-dashboard) lassen
 * den Token unbelegt → `inject(OFFLINE_CACHE, { optional: true })` liefert `null`,
 * der `BaseService` verhält sich exakt wie ohne Cache.
 */
export const OFFLINE_CACHE = new InjectionToken<OfflineCachePort>('OFFLINE_CACHE')

/**
 * Token für die optionale Offline-Outbox-Implementierung. Nur Apps, die offline schreiben
 * (POS), binden hier eine konkrete Implementierung (`OutboxStore` aus
 * `@panary/shared/offline-cache`); andere lassen ihn unbelegt → `null`.
 */
export const OFFLINE_OUTBOX = new InjectionToken<OfflineOutboxPort>('OFFLINE_OUTBOX')

/**
 * Token zum manuellen Anstoßen eines Outbox-Replays (Operator-Aktion „Erneut
 * versuchen"). Nur die POS-App belegt ihn (`PosOutboxReplayService`); andere
 * Konsumenten lassen ihn unbelegt → `null` (der periodische Poll greift ohnehin).
 */
export const OFFLINE_REPLAY = new InjectionToken<OfflineReplayPort>('OFFLINE_REPLAY')
