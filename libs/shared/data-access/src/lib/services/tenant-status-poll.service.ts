import { DestroyRef, effect, inject, Injectable, untracked } from '@angular/core'

import { ConnectionService } from './connection.service'
import { TenantStatusPoller } from './tenant-status-poller'
import { TenantSuspensionService } from './tenant-suspension.service'

/**
 * Mandantensperre im Tier `cloud-direct` ohne Schreibversuch erkennen (panary/panary-core#1401). Die Cloud
 * lässt Lesezugriffe unter Sperre durch, deshalb fragt der POS den Status über `entitlements.getForTenant`
 * ab (jeder angemeldete User, eigener Mandant, unter Sperre als „lesend" eingestuft). Im Edge-Tier meldet
 * der Edge die Sperre stattdessen über `/health` (`ConnectionService`).
 *
 * Wird im POS per `provideEnvironmentInitializer` instanziiert.
 */
@Injectable({ providedIn: 'root' })
export class TenantStatusPollService {
  readonly #conn = inject(ConnectionService)
  readonly #suspension = inject(TenantSuspensionService)
  readonly #poller = new TenantStatusPoller({
    fetchTenantStatus: () => this.#conn.entitlementsService.getForTenant({}),
    applyTenantStatus: status => this.#suspension.applyTenantStatus(status),
  })

  constructor() {
    effect(() => {
      const active = this.#conn.tier() === 'cloud-direct' && this.#conn.connectionState().status === 'authenticated'
      untracked(() => this.#poller.setActive(active))
    })
    inject(DestroyRef).onDestroy(() => this.#poller.stop())
  }
}
