import { computed, Injectable, signal } from '@angular/core'

/** Code des Cloud-Guards `assertTenantStatus` (panary-cloud `assert-tenant-active.ts`). */
export const TENANT_SUSPENDED_CODE = 'TENANT_SUSPENDED'

/**
 * Wie lange eine aus einem Schreib-403 erkannte Sperre ohne neuen 403 stehen bleibt. Die Cloud
 * cached den Mandantenstatus rund 30 s; danach darf der nächste Versuch wieder durchgehen.
 * Bestätigt ein Statusabruf die Sperre (`holdSuspended`, panary/panary-core#1401: Edge-`/health`
 * bzw. `entitlements.getForTenant`), gilt die TTL nicht — dann hebt erst ein Abruf ohne Sperre
 * sie auf.
 */
export const TENANT_SUSPENSION_TTL_MS = 60_000

/** sessionStorage-Schlüssel der gemerkten Sperre (überlebt ein Neuladen, nicht das Schließen des Tabs). */
export const TENANT_SUSPENSION_STORAGE_KEY = 'panary.tenantSuspension'

/**
 * Prüft, ob ein Fehler der Mandantensperre der Cloud entspricht. Vorrangig `error.data.code`,
 * Rückfall auf das Message-Präfix (`TENANT_SUSPENDED: …`). Ein generischer 403 zählt nicht.
 */
export function readTenantSuspension(error: unknown): { tenantStatus: string | null } | null {
  const e = error as { message?: unknown; data?: unknown } | null | undefined
  const data = e?.data as { code?: unknown; tenantStatus?: unknown } | null | undefined
  const viaData = data !== null && typeof data === 'object' && data.code === TENANT_SUSPENDED_CODE
  const viaMessage = typeof e?.message === 'string' && e.message.startsWith(`${TENANT_SUSPENDED_CODE}:`)
  if (!viaData && !viaMessage) return null
  return { tenantStatus: typeof data?.tenantStatus === 'string' ? data.tenantStatus : null }
}

/** Mandantenstatus, bei dem die Cloud schreibende Requests ablehnt. */
const LOCKED_TENANT_STATUSES: ReadonlySet<string> = new Set(['SUSPENDED', 'ARCHIVED'])

/**
 * Zustand „Mandant gesperrt". Zwei Quellen (panary/panary-core#1401):
 * - **Schreib-403** (`ServiceHelper.handleError`, Zeiterfassungs-Panel) → `markSuspended`, läuft nach
 *   `TENANT_SUSPENSION_TTL_MS` ohne weiteren 403 von selbst ab.
 * - **Statusabruf** (Edge-`/health` im Tier `edge-with-cloud`, `entitlements.getForTenant` im Tier
 *   `cloud-direct`) → `holdSuspended` bzw. `clear()`. Gehalten wird ohne Ablauf, solange der Abruf
 *   die Sperre bestätigt; ein Schreib-403 stuft eine gehaltene Sperre nicht auf die TTL herab.
 * Der Zustand samt Ablaufzeitpunkt liegt in `sessionStorage` und wird beim Start nur wiederhergestellt,
 * solange der Ablaufzeitpunkt in der Zukunft liegt (core#1030); eine gehaltene Sperre erneuert ihn bei
 * jedem bestätigenden Abruf.
 */
@Injectable({ providedIn: 'root' })
export class TenantSuspensionService {
  readonly #state = signal<{ tenantStatus: string | null } | null>(null)
  #timer: ReturnType<typeof setTimeout> | null = null
  /** Von einem Statusabruf bestätigt: kein TTL-Ablauf. */
  #held = false

  constructor() {
    this.#restore()
  }

  readonly suspended = computed(() => this.#state() !== null)
  /** `SUSPENDED`, `ARCHIVED` oder `null` (unbekannt). Bei ARCHIVED ist auch der Tagesabschluss gesperrt. */
  readonly tenantStatus = computed(() => this.#state()?.tenantStatus ?? null)

  markSuspended(tenantStatus: string | null): void {
    if (this.#held) {
      // Bestätigte Sperre bleibt gehalten; nur ein konkreterer Status wird übernommen.
      if (tenantStatus !== null) this.holdSuspended(tenantStatus)
      return
    }
    this.#activate(tenantStatus, Date.now() + TENANT_SUSPENSION_TTL_MS)
  }

  /** Ein Statusabruf bestätigt die Sperre: halten, bis ein Abruf sie aufhebt (`clear()`). */
  holdSuspended(tenantStatus: string | null): void {
    this.#activate(tenantStatus, Date.now() + TENANT_SUSPENSION_TTL_MS)
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#held = true
  }

  /**
   * Wertet einen abgerufenen Mandantenstatus aus (`entitlements.getForTenant`). SUSPENDED/ARCHIVED hält
   * die Sperre, jeder andere bekannte Status hebt sie auf. `null`/unbekannt ändert nichts: Die Cloud
   * liefert `null` auch, wenn ihr eigener Mandanten-Read scheitert.
   */
  applyTenantStatus(tenantStatus: unknown): void {
    if (typeof tenantStatus !== 'string' || tenantStatus === '') return
    if (LOCKED_TENANT_STATUSES.has(tenantStatus)) this.holdSuspended(tenantStatus)
    else this.clear()
  }

  /**
   * Wertet das Feld `cloudTenantSuspension` aus dem Edge-`/health` aus. Fehlt es (ältere Edge, oder seit
   * dem Edge-Start noch kein Pull), ändert sich nichts; `null` heisst „letzter Pull lief durch".
   */
  applyHealthSuspension(value: unknown): void {
    if (value === undefined) return
    if (value === null) {
      this.clear()
      return
    }
    if (typeof value !== 'object') return
    const status = (value as { tenantStatus?: unknown }).tenantStatus
    this.holdSuspended(typeof status === 'string' ? status : null)
  }

  clear(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#held = false
    this.#state.set(null)
    try {
      sessionStorage.removeItem(TENANT_SUSPENSION_STORAGE_KEY)
    } catch {
      // Storage nicht verfügbar: der Zustand lebt dann nur im Speicher
    }
  }

  #activate(tenantStatus: string | null, expiresAt: number): void {
    this.#state.set({ tenantStatus })
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.clear(), Math.max(0, expiresAt - Date.now()))
    try {
      sessionStorage.setItem(TENANT_SUSPENSION_STORAGE_KEY, JSON.stringify({ tenantStatus, expiresAt }))
    } catch {
      // Storage nicht verfügbar: der Zustand lebt dann nur im Speicher
    }
  }

  #restore(): void {
    try {
      const raw = sessionStorage.getItem(TENANT_SUSPENSION_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as { tenantStatus?: unknown; expiresAt?: unknown } | null
      const expiresAt = saved?.expiresAt
      if (
        typeof expiresAt !== 'number' ||
        expiresAt <= Date.now() ||
        expiresAt > Date.now() + TENANT_SUSPENSION_TTL_MS
      ) {
        sessionStorage.removeItem(TENANT_SUSPENSION_STORAGE_KEY)
        return
      }
      this.#activate(typeof saved?.tenantStatus === 'string' ? saved.tenantStatus : null, expiresAt)
    } catch {
      // Storage nicht verfügbar oder Inhalt unlesbar: ohne Wiederherstellung starten
    }
  }
}
