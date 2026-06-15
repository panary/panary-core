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

/** Eingabe für einen neuen Outbox-Eintrag (offline erzeugte Mutation). */
export interface OfflineOutboxInput {
  readonly _id: string
  readonly service: string
  readonly op: 'create' | 'patch'
  readonly entityId: string
  readonly payload: unknown
  readonly occurredAt: string
}

/**
 * Reduzierte Sicht eines terminal abgelehnten Outbox-Eintrags für die Operator-Anzeige.
 * Bewusst ohne `payload`/`status`, damit Konsumenten (Settings-UI) nicht die konkrete
 * `OutboxEntry`-Struktur aus `@panary/shared/offline-cache` importieren müssen.
 */
export interface OfflineOutboxRejectedEntry {
  readonly _id: string
  readonly service: string
  readonly op: 'create' | 'patch'
  readonly entityId: string
  readonly occurredAt: string
  readonly attempts: number
  readonly lastError?: string
}

/**
 * Schnittstelle für das Einreihen offline erzeugter Mutationen. Die konkrete
 * Implementierung (`OutboxStore`) lebt in `@panary/shared/offline-cache` und wird in
 * der POS-App über den `OFFLINE_OUTBOX`-Token bereitgestellt (analog zu `OFFLINE_CACHE`).
 *
 * `pendingCount()`/`rejectedCount()` sind synchrone Signal-Reads (reaktiv im
 * `computed()` nutzbar) — für den Offline-Banner-Zähler und die Operator-Sicht.
 */
export interface OfflineOutboxPort {
  isReady(): boolean
  enqueue(input: OfflineOutboxInput): Promise<void>
  /** Reaktiver Zähler noch ausstehender (pending) Einträge. */
  pendingCount(): number
  /** Reaktiver Zähler terminal abgelehnter (rejected) Einträge. */
  rejectedCount(): number
  /** Detailliste terminal abgelehnter Einträge — für die Operator-Sicht. */
  rejected(): Promise<readonly OfflineOutboxRejectedEntry[]>
}
