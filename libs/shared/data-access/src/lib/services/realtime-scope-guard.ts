import { InjectionToken } from '@angular/core'

/**
 * Defense-in-Depth fuer Realtime-Events: client-seitiger Scope-Guard.
 *
 * Die autoritative Isolation passiert serverseitig ueber Feathers-Channels
 * (Tenant + aktive Filiale). Dieser Guard ist eine zusaetzliche Schutzschicht
 * auf der Subscriber-Seite: er verwirft eingehende Socket-Events, die nicht zum
 * Scope des Clients gehoeren (z. B. fremder Tenant oder fremde Filiale), bevor
 * sie in den lokalen State gemerged werden.
 *
 * Wird app-spezifisch bereitgestellt (admin-dashboard: Auth-Tenant + aktive
 * Filiale; POS: Geraete-Tenant + fixe Filiale). Ohne Provider verhaelt sich der
 * `BaseService` exakt wie bisher (alle Events werden akzeptiert).
 */
export interface RealtimeScopeGuard {
  /**
   * @param item Das eingehende Event-Payload (einzelnes Dokument oder Array).
   * @returns `true` = anwenden, `false` = verwerfen.
   */
  shouldAccept(item: unknown): boolean
}

export const REALTIME_SCOPE_GUARD = new InjectionToken<RealtimeScopeGuard>('REALTIME_SCOPE_GUARD')

export interface RealtimeScopeContext {
  /** Tenant des Clients. `null` = unbekannt (z. B. vor Registrierung) → kein Filter. */
  tenantId: string | null
  /** Aktive Filiale; `null` = keine aktive Filiale (nur tenant-globale Events filtern). */
  activeLocationId: string | null
}

/**
 * Pure-Predicate: gehoert ein eingehendes Event-Item zum Scope des Clients?
 * Wird von den app-spezifischen Guard-Providern (POS, admin-dashboard)
 * wiederverwendet.
 *
 * - Array-Payloads (Batch) → akzeptieren (server-seitige Channel-Isolation ist
 *   autoritativ; ein Batch nicht wegen eines Elements komplett verwerfen).
 * - Unbekannter Client-Tenant (`null`) → akzeptieren (kein Vergleichsanker).
 * - Tenant-Mismatch → verwerfen.
 * - Filialspezifischer Record (`locationId != null`) bei bekannter aktiver
 *   Filiale mit Mismatch → verwerfen. `locationId == null` (tenant-global) bleibt.
 */
export const matchesRealtimeScope = (item: unknown, ctx: RealtimeScopeContext): boolean => {
  if (Array.isArray(item)) return true
  if (!item || typeof item !== 'object') return true
  const rec = item as { tenantId?: string | null; locationId?: string | null }

  if (ctx.tenantId && rec.tenantId && rec.tenantId !== ctx.tenantId) return false
  if (ctx.activeLocationId && rec.locationId != null && rec.locationId !== ctx.activeLocationId) {
    return false
  }
  return true
}
