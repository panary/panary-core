/**
 * Abrufrhythmus des Mandantenstatus im Tier `cloud-direct` (panary/panary-core#1401) — derselbe Takt wie der
 * `/health`-Poll des `ConnectionService`.
 */
export const TENANT_STATUS_POLL_MS = 60_000

/** Was der Poller braucht, framework-frei, damit er ohne Angular-Testumgebung prüfbar ist. */
export interface TenantStatusPollerDeps {
  /** `entitlements.getForTenant` der Cloud; liefert u. a. `tenantStatus`. */
  readonly fetchTenantStatus: () => Promise<unknown>
  /** `TenantSuspensionService.applyTenantStatus`. */
  readonly applyTenantStatus: (tenantStatus: unknown) => void
}

/**
 * Fragt den Mandantenstatus ab, solange er aktiv ist: sofort beim Aktivieren, danach im
 * `TENANT_STATUS_POLL_MS`-Takt. Ein fehlgeschlagener Abruf ändert nichts am Sperrzustand — er heisst
 * „unbekannt", nicht „entsperrt". Überlappende Abrufe werden übersprungen.
 */
export class TenantStatusPoller {
  #timer: ReturnType<typeof setInterval> | null = null
  #inFlight = false

  constructor(private readonly deps: TenantStatusPollerDeps) {}

  setActive(active: boolean): void {
    if (!active) {
      this.stop()
      return
    }
    if (this.#timer) return
    void this.poll()
    this.#timer = setInterval(() => void this.poll(), TENANT_STATUS_POLL_MS)
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  async poll(): Promise<void> {
    if (this.#inFlight) return
    this.#inFlight = true
    try {
      const result = await this.deps.fetchTenantStatus()
      const tenantStatus =
        result !== null && typeof result === 'object' ? (result as { tenantStatus?: unknown }).tenantStatus : undefined
      this.deps.applyTenantStatus(tenantStatus)
    } catch {
      // Unbekannt (offline, Timeout, 401): Zustand bleibt. Bewusst ohne Log — der Abruf läuft jede Minute,
      // und Verbindungsfehler meldet der Cloud-Status-Banner bereits.
    } finally {
      this.#inFlight = false
    }
  }
}
