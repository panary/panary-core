import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, untracked } from '@angular/core'
import { ApiService } from '../../core/api.service'

interface CloudConnectionState {
  _id: string
  pairingStatus: 'connected' | 'disconnected' | 'pairing' | 'error'
  lastCloudContactAt: string | null
  offlineOverrideActiveUntil: string | null
}

/**
 * Banner-Komponente, die nur erscheint, wenn der Edge im CONNECTED-Modus
 * ist UND der letzte Cloud-Kontakt (`lastCloudContactAt`) lange her ist
 * (= Cloud unreachable). Dieses Feld ist vom Pull-Cursor entkoppelt: der
 * Realtime-Worker hält es per Socket-Heartbeat frisch, der Pull-Worker setzt
 * es bei Erfolg. So wirkt der Banner im Push-Modus nicht faelschlich „stale",
 * obwohl die Cloud via Socket erreichbar ist. Operator kann mit einem Klick einen 2-Stunden-
 * Override aktivieren — danach erlaubt `restrict-order-to-business-day`
 * wieder lokale `rotateBusinessDay()`-Aufrufe.
 *
 * Beim naechsten erfolgreichen Cloud-Pull wird `offlineOverrideActiveUntil`
 * auf `null` resettet (Auto-Reset, siehe cloud-pull-business-days.worker.ts).
 *
 * Polling 15s — selbe Granularitaet wie die anderen Banner im
 * cloud-connection-Feature, damit Operator sofort reagieren kann.
 */
@Component({
  selector: 'app-offline-override-banner',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showBanner()) {
      <div class="bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500 text-amber-900 dark:text-amber-100 px-4 py-3 flex items-center gap-3">
        <span class="text-xl leading-none" aria-hidden="true">⚠️</span>
        <div class="flex-1">
          @if (overrideActive()) {
            <p class="text-sm font-medium">Offline-Modus aktiv</p>
            <p class="text-xs opacity-90">
              Edge generiert Geschaeftstage lokal. Auto-Reset beim naechsten erfolgreichen
              Cloud-Pull. Aktiv noch {{ overrideRemainingMinutes() }} Minuten.
            </p>
          } @else {
            <p class="text-sm font-medium">Cloud-Verbindung nicht erreichbar</p>
            <p class="text-xs opacity-90">
              Neue Bestellungen werden blockiert, bis die Cloud wieder antwortet.
              Letzter erfolgreicher Abgleich vor {{ lastPullAgoMinutes() }} Minuten.
            </p>
          }
        </div>
        @if (!overrideActive()) {
          <button
            type="button"
            (click)="activateOverride()"
            [disabled]="busy()"
            class="bg-amber-700 dark:bg-amber-600 hover:bg-amber-800 dark:hover:bg-amber-500 text-white text-xs font-medium px-3 py-1.5 rounded disabled:opacity-50"
          >
            Offline-Modus aktivieren
          </button>
        }
      </div>
    }
  `,
})
export class OfflineOverrideBannerComponent {
  private api = inject(ApiService)

  /** Setzt Override fuer 2 Stunden. */
  private readonly OVERRIDE_DURATION_MS = 2 * 60 * 60 * 1000
  /** Cloud gilt als unerreichbar, wenn letzter Cloud-Kontakt > 60s her ist.
   *  Muss > CONTACT_HEARTBEAT_MS (30s, cloud-realtime.worker.ts) bleiben. */
  private readonly STALE_THRESHOLD_MS = 60_000

  protected readonly connection = signal<CloudConnectionState | null>(null)
  protected readonly busy = signal<boolean>(false)
  /** Live-Tick fuer Minuten-Countdown (jede 30s reicht). */
  private readonly now = signal<number>(Date.now())

  protected readonly overrideActive = computed(() => {
    const c = this.connection()
    if (!c?.offlineOverrideActiveUntil) return false
    const untilMs = new Date(c.offlineOverrideActiveUntil).getTime()
    return Number.isFinite(untilMs) && untilMs > this.now()
  })

  protected readonly lastPullAgoMinutes = computed(() => {
    const c = this.connection()
    if (!c?.lastCloudContactAt) return '?'
    const diffMs = this.now() - new Date(c.lastCloudContactAt).getTime()
    if (!Number.isFinite(diffMs) || diffMs < 0) return '?'
    return Math.floor(diffMs / 60_000).toString()
  })

  protected readonly overrideRemainingMinutes = computed(() => {
    const c = this.connection()
    if (!c?.offlineOverrideActiveUntil) return 0
    const remainingMs = new Date(c.offlineOverrideActiveUntil).getTime() - this.now()
    return Math.max(0, Math.floor(remainingMs / 60_000))
  })

  protected readonly showBanner = computed(() => {
    const c = this.connection()
    if (!c || c.pairingStatus !== 'connected') return false
    // Override aktiv → immer anzeigen (Operator sieht „noch X Minuten")
    if (this.overrideActive()) return true
    // Sonst nur bei Staleness
    if (!c.lastCloudContactAt) return false
    const diffMs = this.now() - new Date(c.lastCloudContactAt).getTime()
    return Number.isFinite(diffMs) && diffMs > this.STALE_THRESHOLD_MS
  })

  constructor() {
    // Initial-Load + Polling. `untracked()` Pflicht, weil refreshState()
    // intern Signal-Writes macht (siehe angular.md §2.1 +
    // feedback_effect_untracked_pattern).
    effect(() => {
      this.now() // tracked — triggert Refresh nach jedem Tick
      untracked(() => void this.refreshState())
    })
    setInterval(() => this.now.set(Date.now()), 30_000)
    void this.refreshState()
  }

  private async refreshState(): Promise<void> {
    try {
      const result = await this.api.find('cloud-connection', { $limit: 1 })
      const list = Array.isArray(result) ? result : (result.data ?? [])
      const first = list[0] as CloudConnectionState | undefined
      this.connection.set(first ?? null)
    } catch {
      // Banner bleibt mit altem State sichtbar (best-effort)
    }
  }

  protected async activateOverride(): Promise<void> {
    const c = this.connection()
    if (!c || this.busy()) return
    this.busy.set(true)
    try {
      const untilIso = new Date(Date.now() + this.OVERRIDE_DURATION_MS).toISOString()
      await this.api.patch('cloud-connection', c._id, { offlineOverrideActiveUntil: untilIso })
      // Sofort lokales State aktualisieren, ohne auf den naechsten Poll-Tick zu warten
      this.connection.set({ ...c, offlineOverrideActiveUntil: untilIso })
    } finally {
      this.busy.set(false)
    }
  }
}
