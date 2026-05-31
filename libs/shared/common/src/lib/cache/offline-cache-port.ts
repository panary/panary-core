/**
 * Geteilte Abstraktion für den Offline-Cache (Connect-Tier). Liegt bewusst im
 * neutralen `shared-common`, damit der `BaseService` (data-access) gegen die
 * Abstraktion arbeitet, ohne die konkrete IndexedDB-Lib (`@panary/shared/offline-cache`)
 * importieren zu müssen. Andernfalls müsste jeder `BaseService`-Konsument — auch das
 * admin-dashboard in panary-cloud — den Cache samt `idb` mitbundeln (das brach den
 * panary-cloud-Build, weil dort `@panary/shared/offline-cache` nicht gemappt ist).
 */

/** Minimaler Vertrag jedes Cache-Datensatzes: adressierbar über `_id` (uuidv7). */
export interface CacheEntity {
  readonly _id: string
  readonly tenantId?: string | null
  readonly locationId?: string | null
  readonly updatedAt?: string
}

/** Read-/Schreib-Strategie eines Services im Cache. */
export type CachePolicy = 'none' | 'master-data' | 'transactional'

/**
 * Schnittstelle, die der `BaseService` zum Lesen/Schreiben des Caches nutzt. Die
 * konkrete Implementierung (`OfflineCacheStore`) lebt in `@panary/shared/offline-cache`
 * und wird in der POS-App über den `OFFLINE_CACHE`-Token bereitgestellt.
 */
export interface OfflineCachePort {
  isReady(): boolean
  readAll<TEntity extends CacheEntity>(store: string): Promise<TEntity[]>
  get<TEntity extends CacheEntity>(store: string, id: string): Promise<TEntity | undefined>
  upsertMany(store: string, records: readonly CacheEntity[]): Promise<void>
  removeOne(store: string, id: string): Promise<void>
}

/**
 * Normalisiert ein Feathers-Service-Ergebnis (Einzelobjekt, Array oder `Paginated`)
 * auf eine flache Datensatzliste — die Form, in der der Cache persistiert.
 */
export function normalizeToRecords<TEntity extends CacheEntity>(result: unknown): TEntity[] {
  if (Array.isArray(result)) {
    return result as TEntity[]
  }
  if (
    result &&
    typeof result === 'object' &&
    'data' in result &&
    Array.isArray((result as { data: unknown }).data)
  ) {
    return (result as { data: TEntity[] }).data
  }
  if (result && typeof result === 'object' && '_id' in result) {
    return [result as TEntity]
  }
  return []
}
