import { inject, Injectable } from '@angular/core'

import { ApiService } from './api.service'
import { CloudManagedService } from './cloud-managed.service'

export interface SetEmergencyOverrideResult {
  emergencyOverride: boolean
  pendingCount: number
  conflictCount: number
}

/**
 * Kontroll-Switch fuer den Notfall-Modus (ADR 0001) — das Gegenstueck zum
 * `OfflineOverrideService`, der den 2h-Offline-Override fuer die
 * Geschaeftstag-Rotation setzt. Beide sind bewusst getrennt: der Notfall-Modus
 * betrifft Drucker-Stammdaten, der Offline-Override den Business-Day-Lifecycle.
 *
 * Laeuft ueber die Custom-Method statt ueber PATCH, weil das Umschalten eine
 * Mehrfeld-Transaktion ist und die Felder extern gefiltert werden. RBAC:
 * CLOUD_CONNECTION: MANAGE → TENANT_OWNER/TENANT_TECHNICIAN.
 */
@Injectable({ providedIn: 'root' })
export class EmergencyOverrideService {
  #api = inject(ApiService)
  #cloudManaged = inject(CloudManagedService)

  async setActive(active: boolean, opts?: { discardPendingOverrides?: boolean }): Promise<SetEmergencyOverrideResult> {
    const result = await this.#api.customMethod<SetEmergencyOverrideResult>(
      'cloud-connection',
      'setEmergencyOverride',
      { active, ...(opts?.discardPendingOverrides ? { discardPendingOverrides: true } : {}) },
    )
    // Sofort neu laden — sonst zeigen Banner und Seiten-Sperren bis zu 60 s den
    // alten Zustand, obwohl der Nutzer gerade selbst umgeschaltet hat.
    await this.#cloudManaged.refresh()
    return result
  }
}
