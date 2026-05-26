import { inject, Injectable } from '@angular/core'

import { ApiService } from './api.service'

interface CloudConnectionRecord {
  _id: string
}

/**
 * Aktiviert den Offline-Modus-Override (`offlineOverrideActiveUntil`) auf dem
 * `cloud-connection`-Record. Nur im Admin-Kontext verfuegbar — der HTTP-`ApiService`
 * traegt das RBAC-JWT (CLOUD_CONNECTION: MANAGE → TENANT_OWNER/TENANT_TECHNICIAN).
 *
 * Ersetzt die bisherige Inline-Logik der `OfflineOverrideBannerComponent`; der
 * Auto-Reset auf `null` erfolgt weiterhin beim naechsten erfolgreichen Cloud-Pull
 * (`cloud-pull-business-days.worker.ts`).
 */
@Injectable({ providedIn: 'root' })
export class OfflineOverrideService {
  #api = inject(ApiService)

  /** Override-Dauer: 2 Stunden (unveraendert ggü. vorheriger Banner-Logik). */
  readonly #OVERRIDE_DURATION_MS = 2 * 60 * 60 * 1000

  async activate(): Promise<void> {
    const res = await this.#api.find<CloudConnectionRecord>('cloud-connection', { $limit: 1 })
    const conn = res.data?.[0]
    if (!conn) return
    const untilIso = new Date(Date.now() + this.#OVERRIDE_DURATION_MS).toISOString()
    await this.#api.patch('cloud-connection', conn._id, { offlineOverrideActiveUntil: untilIso })
  }
}
