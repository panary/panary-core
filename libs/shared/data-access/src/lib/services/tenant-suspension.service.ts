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
 * ohne weiteren 403 von selbst ab.
 */
@Injectable({ providedIn: 'root' })
export class TenantSuspensionService {
  readonly #state = signal<{ tenantStatus: string | null } | null>(null)
  #timer: ReturnType<typeof setTimeout> | null = null

  readonly suspended = computed(() => this.#state() !== null)
  /** `SUSPENDED`, `ARCHIVED` oder `null` (unbekannt). Bei ARCHIVED ist auch der Tagesabschluss gesperrt. */
  readonly tenantStatus = computed(() => this.#state()?.tenantStatus ?? null)

  markSuspended(tenantStatus: string | null): void {
    this.#state.set({ tenantStatus })
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.clear(), TENANT_SUSPENSION_TTL_MS)
  }

  clear(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#state.set(null)
  }
}
