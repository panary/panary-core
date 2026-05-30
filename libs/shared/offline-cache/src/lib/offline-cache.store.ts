import { Injectable, signal, Signal, WritableSignal } from '@angular/core'

import { openCacheDatabase, OpenCacheResult } from './cache-bootstrap'
import { mergeRecords } from './cache-merge'
import { CacheEntity, CacheStoragePort, CacheStorageSchema } from './cache-storage.port'

/**
 * Höhere Cache-Schicht über dem {@link CacheStoragePort}: hält pro Service einen
 * In-Memory-Mirror (Signal) als schnelle Render-Quelle und persistiert parallel in
 * IndexedDB. Der Port wird beim `init()` übergeben (statt injiziert), damit der Store
 * ohne Angular-TestBed unit-testbar bleibt; die App reicht den via `CACHE_STORAGE_PORT`
 * bereitgestellten Adapter durch.
 */
@Injectable()
export class OfflineCacheStore {
  #port: CacheStoragePort | null = null
  #databaseName: string | null = null
  readonly #ready: WritableSignal<boolean> = signal(false)
  readonly #mirrors = new Map<string, WritableSignal<CacheEntity[]>>()

  readonly ready: Signal<boolean> = this.#ready.asReadonly()

  isReady(): boolean {
    return this.#ready()
  }

  /**
   * Öffnet die namespaced Cache-DB (inkl. Build-ID-Wipe-Logik) und hydratisiert die
   * Mirror-Signale aus IndexedDB. Idempotent — ein erneuter Aufruf re-initialisiert.
   */
  async init(
    port: CacheStoragePort,
    databaseName: string,
    schema: CacheStorageSchema,
    buildId: string,
  ): Promise<OpenCacheResult> {
    this.#port = port
    this.#databaseName = databaseName
    const result = await openCacheDatabase(port, databaseName, schema, buildId)
    for (const store of schema.stores) {
      const records = await port.getAll<CacheEntity>(store.name)
      this.#mirrorSignal(store.name).set(records)
    }
    this.#ready.set(true)
    return result
  }

  /** Reaktiver Mirror eines Stores (für SWR-Render). Leeres Signal, falls unbekannt. */
  mirror<TEntity extends CacheEntity>(store: string): Signal<TEntity[]> {
    return this.#mirrorSignal(store) as unknown as Signal<TEntity[]>
  }

  async readAll<TEntity extends CacheEntity>(store: string): Promise<TEntity[]> {
    if (this.#mirrors.has(store)) {
      return this.#mirrorSignal(store)() as TEntity[]
    }
    if (!this.#port) return []
    return this.#port.getAll<TEntity>(store)
  }

  async get<TEntity extends CacheEntity>(store: string, id: string): Promise<TEntity | undefined> {
    if (!this.#port) return undefined
    return this.#port.get<TEntity>(store, id)
  }

  async upsert(store: string, record: CacheEntity): Promise<void> {
    if (!this.#port) return
    await this.#port.put(store, record)
    this.#applyToMirror(store, [record], 'upsert')
  }

  async upsertMany(store: string, records: readonly CacheEntity[]): Promise<void> {
    if (!this.#port || records.length === 0) return
    await this.#port.bulkPut(store, records)
    this.#applyToMirror(store, records, 'upsert')
  }

  async removeOne(store: string, id: string): Promise<void> {
    if (!this.#port) return
    await this.#port.delete(store, id)
    this.#applyToMirror(store, [{ _id: id }], 'remove')
  }

  /** Verwirft den gesamten Cache (Re-Pairing / Tenant-/Location-Wechsel). */
  async destroy(): Promise<void> {
    if (this.#port && this.#databaseName) {
      await this.#port.destroy(this.#databaseName)
    }
    this.#mirrors.clear()
    this.#ready.set(false)
    this.#port = null
    this.#databaseName = null
  }

  #applyToMirror(store: string, records: readonly CacheEntity[], mode: 'upsert' | 'remove'): void {
    const mirror = this.#mirrorSignal(store)
    mirror.set(mergeRecords(mirror(), records, mode))
  }

  #mirrorSignal(store: string): WritableSignal<CacheEntity[]> {
    let mirror = this.#mirrors.get(store)
    if (!mirror) {
      mirror = signal<CacheEntity[]>([])
      this.#mirrors.set(store, mirror)
    }
    return mirror
  }
}
