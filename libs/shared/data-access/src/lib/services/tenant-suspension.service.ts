import { computed, Injectable, signal } from '@angular/core'

/** Code des Cloud-Guards `assertTenantStatus` (panary-cloud `assert-tenant-active.ts`). */
export const TENANT_SUSPENDED_CODE = 'TENANT_SUSPENDED'

/**
 * Wie lange eine erkannte Sperre ohne neuen 403 stehen bleibt. Die Cloud cached den
 * Mandantenstatus rund 30 s; danach darf der nächste Versuch wieder durchgehen. Ein
 * Statusendpunkt für Geräte existiert nicht, deshalb ist der nächste schreibende Request
 * die Nachprüfung: Ist der Mandant noch gesperrt, setzt der 403 den Zustand sofort neu.
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

/**
 * Zustand „Mandant gesperrt" (Tier `cloud-direct`). Wird von `ServiceHelper.handleError`
 * gesetzt und vom Cloud-Status-Banner angezeigt. Läuft nach `TENANT_SUSPENSION_TTL_MS`
 * ohne weiteren 403 von selbst ab. Der Zustand samt Ablaufzeitpunkt liegt in `sessionStorage` und
 * wird beim Start nur wiederhergestellt, solange der Ablaufzeitpunkt in der Zukunft liegt (core#1030).
 */
@Injectable({ providedIn: 'root' })
export class TenantSuspensionService {
  readonly #state = signal<{ tenantStatus: string | null } | null>(null)
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.#restore()
  }

  readonly suspended = computed(() => this.#state() !== null)
  /** `SUSPENDED`, `ARCHIVED` oder `null` (unbekannt). Bei ARCHIVED ist auch der Tagesabschluss gesperrt. */
  readonly tenantStatus = computed(() => this.#state()?.tenantStatus ?? null)

  markSuspended(tenantStatus: string | null): void {
    this.#activate(tenantStatus, Date.now() + TENANT_SUSPENSION_TTL_MS)
  }

  clear(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
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
