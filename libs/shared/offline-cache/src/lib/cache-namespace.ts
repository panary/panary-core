/**
 * Namespacing der Cache-Datenbank: erzwingt harte Tenant-/Location-Isolation
 * auf physischer Ebene (jeder Scope liegt in einer eigenen IndexedDB).
 */

/** Kontext, der den physischen Cache-Namespace bestimmt. */
export interface CacheNamespaceContext {
  readonly tenantId: string
  readonly locationId: string | null
  readonly serverUrl: string
}

export const CACHE_DB_PREFIX = 'panary-cache'

/**
 * Baut den namespaced Datenbanknamen. Tenant, Location und Server liegen in
 * getrennten Datenbanken → scope-fremde Daten sind nie in derselben DB
 * (Defense-in-Depth zusätzlich zur server-/realtime-seitigen Isolation).
 */
export function buildCacheDatabaseName(context: CacheNamespaceContext): string {
  const host = normalizeServerHost(context.serverUrl)
  const location = context.locationId ?? 'global'
  return `${CACHE_DB_PREFIX}::${context.tenantId}::${location}::${host}`
}

function normalizeServerHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host || serverUrl
  } catch {
    return serverUrl
  }
}

/** Bestandteile der Cache-Build-Identität (App-Version + Schema-Version). */
export interface CacheBuildContext {
  readonly appVersion: string
  readonly schemaVersion: number
}

/**
 * Deterministische Build-Kennung des Caches. Ändert sich bei App- oder
 * Schema-Update → erzwingt beim Öffnen einen Wipe + Voll-Bootstrap.
 */
export function buildCacheBuildId(context: CacheBuildContext): string {
  return `${context.appVersion}#${context.schemaVersion}`
}
