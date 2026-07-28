import { computed, inject, Injectable } from '@angular/core'

import { ConnectionService } from '@panary/shared/data-access'

/**
 * Single Source of Truth fuer „Diese Daten verwaltet die Cloud".
 *
 * Spiegelt den `cloudManaged()`-Hook des Backends
 * (`apps/api-edge/src/hooks/cloud-managed.hook.ts`): sobald der Edge gepairt
 * ist, sind externe Writes auf `locations` gesperrt — mit genau einer Ausnahme,
 * dem Notfall-Modus fuer `settings.printSettings` (ADR 0001).
 *
 * Datenquelle ist bewusst `/health` ueber den `ConnectionService`, nicht ein
 * eigener `cloud-connection`-Find: letzterer braucht `CLOUD_CONNECTION: MANAGE`
 * und liefert einem TENANT_MANAGER ein 403. Die frueher in `opening-hours.ts`
 * inline implementierte Variante fing dieses 403 ab und setzte `false` — das
 * Formular sah editierbar aus, waehrend das Backend jeden Save ablehnte.
 * `/health` ist RBAC-frei, wird ohnehin alle 60 s gepollt und haelt damit
 * Banner und Seiten-Sperre konsistent.
 */
@Injectable({ providedIn: 'root' })
export class CloudManagedService {
  #conn = inject(ConnectionService)

  readonly cloudPaired = this.#conn.cloudPaired
  readonly emergencyOverride = this.#conn.emergencyOverrideActive
  readonly emergencyOverrideSinceMin = this.#conn.emergencyOverrideSinceMin

  /** Erst `true`, wenn ein /health-Roundtrip den Zustand tatsaechlich geliefert hat. */
  readonly stateKnown = this.#conn.healthLoaded

  /**
   * Standort-Stammdaten sind schreibgeschuetzt: Oeffnungszeiten, Pager, Tische,
   * Standort-Detail.
   *
   * Bewusst fail-open, solange der Zustand unbekannt ist (`stateKnown() ===
   * false`): das Backend ist die Autorität und blockt ohnehin. Ein kurz
   * ungesperrtes Formular ist harmloser als ein faelschlich gesperrtes, das den
   * Nutzer ohne Grund aussperrt. Das Fenster ist wenige Millisekunden gross —
   * `#fetchHealth` laeuft im Socket-`connect`-Handler.
   */
  readonly readOnly = computed(() => this.stateKnown() && this.cloudPaired())

  /**
   * Drucker sind schreibbar, wenn kein Pairing besteht ODER der Notfall-Modus
   * aktiv ist. Entspricht exakt der `isPrinterOnlyPatch`-Whitelist im Backend.
   */
  readonly printerWritable = computed(() => !this.readOnly() || this.emergencyOverride())

  /** Gepairt UND Notfall-Modus: Drucker editierbar, aber mit Notfall-Hinweis. */
  readonly printerEmergency = computed(() => this.readOnly() && this.emergencyOverride())

  /**
   * Notfall-Modus darf manuell angeboten werden: gepairt, Cloud unerreichbar,
   * Auto-Trigger aber noch nicht gefeuert. Schliesst die Luecke im
   * MANUAL-Sync-Modus, wo der Heartbeat nur alle 30 min laeuft und die
   * automatische Aktivierung entsprechend spaet greift.
   */
  readonly canOfferEmergency = computed(
    () => this.readOnly() && !this.emergencyOverride() && this.#conn.cloudUnreachable(),
  )

  /** Sofortiger /health-Roundtrip statt bis zu 60 s Wartezeit. */
  refresh(): Promise<void> {
    return this.#conn.refreshHealth()
  }
}
