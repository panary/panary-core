import { Injectable } from '@angular/core'
import { deleteDB, type IDBPDatabase, openDB } from 'idb'

import { CacheEntity, CacheStoragePort, CacheStorageSchema } from './cache-storage.port'

/**
 * IndexedDB-Implementierung des {@link CacheStoragePort} über den `idb`-Wrapper.
 * Funktioniert in beiden App-Hüllen (Tauri-WebView, Capacitor-WebView) ohne
 * natives Plugin.
 */
@Injectable()
export class IdbStorageAdapter implements CacheStoragePort {
  #db: IDBPDatabase | null = null

  async open(databaseName: string, schema: CacheStorageSchema): Promise<void> {
    this.close()
    this.#db = await openDB(databaseName, schema.version, {
      upgrade(db) {
        // Schlanker Cache → bei einem Versionssprung Stores verwerfen und frisch
        // anlegen statt feingranularer Migration. Der Datenverlust ist gewollt: ein
        // Version-Bump erzwingt einen sauberen Voll-Bootstrap (Offline-Cache-Plan §9).
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name)
        }
        for (const store of schema.stores) {
          const objectStore = db.createObjectStore(store.name, { keyPath: '_id' })
          for (const index of store.indexes ?? []) {
            objectStore.createIndex(index.name, index.keyPath as string | string[], {
              unique: index.unique ?? false,
            })
          }
        }
      },
    })
  }

  async get<TEntity extends CacheEntity>(store: string, id: string): Promise<TEntity | undefined> {
    return (await this.#requireDb().get(store, id)) as TEntity | undefined
  }

  async getAll<TEntity extends CacheEntity>(store: string): Promise<TEntity[]> {
    return (await this.#requireDb().getAll(store)) as TEntity[]
  }

  async getAllByIndex<TEntity extends CacheEntity>(
    store: string,
    index: string,
    query?: IDBKeyRange | IDBValidKey,
  ): Promise<TEntity[]> {
    return (await this.#requireDb().getAllFromIndex(store, index, query)) as TEntity[]
  }

  async put<TEntity extends CacheEntity>(store: string, record: TEntity): Promise<void> {
    await this.#requireDb().put(store, record)
  }

  async bulkPut<TEntity extends CacheEntity>(store: string, records: readonly TEntity[]): Promise<void> {
    if (records.length === 0) return
    const tx = this.#requireDb().transaction(store, 'readwrite')
    await Promise.all([...records.map(record => tx.store.put(record)), tx.done])
  }

  async delete(store: string, id: string): Promise<void> {
    await this.#requireDb().delete(store, id)
  }

  async clear(store: string): Promise<void> {
    await this.#requireDb().clear(store)
  }

  async count(store: string): Promise<number> {
    return this.#requireDb().count(store)
  }

  close(): void {
    this.#db?.close()
    this.#db = null
  }

  async destroy(databaseName: string): Promise<void> {
    this.close()
    await deleteDB(databaseName)
  }

  #requireDb(): IDBPDatabase {
    if (!this.#db) {
      throw new Error('IdbStorageAdapter: Datenbank ist nicht geöffnet — open() zuerst aufrufen.')
    }
    return this.#db
  }
}
