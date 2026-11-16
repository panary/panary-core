import { computed, inject, Injectable } from '@angular/core'
import { AppConfigService } from '@panary/shared/data-access-config'
import { ConnectionService } from './connection.service'
import { evaluatePosVersion } from './pos-version-policy'

/**
 * Versionsstand dieses POS gegen Edge-Version und Mindestversion (core#1441, ADR 0070).
 *
 * Reine Lesesicht auf Signale: Der Dienst sperrt nichts selbst. Aufrufer, die einen Start verweigern
 * dürfen (Login, Start der Kassensitzung), fragen `blocksStart()`; der laufende Verkauf fragt ihn nie.
 */
@Injectable({ providedIn: 'root' })
export class PosVersionPolicyService {
  readonly #connection = inject(ConnectionService)
  readonly #appConfig = inject(AppConfigService)

  readonly posVersion = this.#appConfig.appVersion
  readonly edgeVersion = this.#connection.edgeVersion
  readonly requiredPosMinVersion = this.#connection.requiredPosMinVersion

  readonly verdict = computed(() =>
    evaluatePosVersion({
      posVersion: this.posVersion,
      edgeVersion: this.edgeVersion(),
      requiredPosMinVersion: this.requiredPosMinVersion(),
    }),
  )

  /** Nicht blockierender Warnhinweis: mindestens ein Monatsstand hinter dem Edge. */
  readonly warn = computed(() => this.verdict().behindEdge)

  /**
   * Holt vor einer Sperrentscheidung einen frischen `/health`-Stand (der Poll ist bis zu 60 s alt) und
   * liefert dann das Urteil. Ein nicht erreichbarer Edge ändert nichts am letzten bekannten Stand.
   */
  async verdictFresh() {
    await this.#connection.refreshHealth().catch(() => undefined)
    return this.verdict()
  }
}
