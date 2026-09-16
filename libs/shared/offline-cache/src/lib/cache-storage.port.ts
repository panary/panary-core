import { InjectionToken } from '@angular/core'

import { CacheEntity } from '@panary/shared-common'

// CacheEntity lebt im neutralen shared-common (siehe offline-cache-port.ts) — hier
// re-exportiert, damit `@panary/shared/offline-cache`-Konsumenten ihn weiter beziehen.
export type { CacheEntity }

/**
 * Schlanker Client-Cache-Storage-Port (Connect-Tier). Kapselt die konkrete
 * Persistenz-Engine (heute IndexedDB via `idb`) hinter einer austauschbaren
 * Schnittstelle, damit ein späterer SQLite-Adapter ohne Konsumenten-Änderung
 * eingehängt werden kann.
 */

/** Sekundär-Index einer Cache-Tabelle (z.B. `updatedAt` für den Delta-Cursor). */
export interface CacheIndexDefinition {
  readonly name: string
  readonly keyPath: string | readonly string[]
  readonly unique?: boolean
}

/** Object-Store-Definition; `name` entspricht dem Feathers-Service-Pfad (z.B. `products`). */
export interface CacheStoreDefinition {
  readonly name: string
  readonly indexes?: readonly CacheIndexDefinition[]
  /**
   * Store beim Schema-Upgrade übernehmen statt verwerfen (fehlende Indizes werden
   * nachgezogen). Nur für Stores, deren Inhalt **nicht regenerierbar** ist — heute
   * allein die Offline-Outbox und der Meta-Store. Fachliche Stores bleiben beim
   * Recreate: ihr Inhalt kommt beim Voll-Bootstrap vom Server zurück.
   */
  readonly preserveOnUpgrade?: boolean
}

/** Versioniertes Schema der Cache-Datenbank. Ein Version-Bump erzwingt Recreate (siehe Adapter). */
export interface CacheStorageSchema {
  readonly version: number
  readonly stores: readonly CacheStoreDefinition[]
}

/**
 * Persistenz-Port. Stateful: nach `open()` hält die Implementierung das DB-Handle;
 * alle weiteren Operationen beziehen sich auf die zuletzt geöffnete Datenbank.
 */
export interface CacheStoragePort {
  open(databaseName: string, schema: CacheStorageSchema): Promise<void>
  get<TEntity extends CacheEntity>(store: string, id: string): Promise<TEntity | undefined>
  getAll<TEntity extends CacheEntity>(store: string): Promise<TEntity[]>
  getAllByIndex<TEntity extends CacheEntity>(
    store: string,
    index: string,
    query?: IDBKeyRange | IDBValidKey,
  ): Promise<TEntity[]>
  put<TEntity extends CacheEntity>(store: string, record: TEntity): Promise<void>
  bulkPut<TEntity extends CacheEntity>(store: string, records: readonly TEntity[]): Promise<void>
  delete(store: string, id: string): Promise<void>
  clear(store: string): Promise<void>
  count(store: string): Promise<number>
  /**
   * Namen aller physisch vorhandenen Stores der offenen Datenbank. Nötig für das
   * selektive Leeren beim Build-Mismatch (`openCacheDatabase`): Es muss auch Stores
   * treffen, die aus dem Schema entfernt wurden, aber noch in der Datenbank liegen.
   */
  storeNames(): readonly string[]
  /** Schließt das DB-Handle (ohne zu löschen). */
  close(): void
  /** Löscht die gesamte Datenbank (Re-Pairing / Tenant-/Location-Wechsel / Version-Reset). */
  destroy(databaseName: string): Promise<void>
}

export const CACHE_STORAGE_PORT = new InjectionToken<CacheStoragePort>('CACHE_STORAGE_PORT')
