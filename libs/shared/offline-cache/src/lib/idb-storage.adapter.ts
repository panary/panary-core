import { Injectable } from '@angular/core'
import { deleteDB, type IDBPDatabase, openDB } from 'idb'

import { CacheEntity, CacheIndexDefinition, CacheStoragePort, CacheStorageSchema } from './cache-storage.port'

/**
 * Minimalausschnitt des Object-Store-Handles, den {@link syncIndexes} braucht. Bewusst
 * schlank statt der generischen `IDBPObjectStore`-Signatur von `idb` — die trägt vier
 * Typparameter, die hier (schemaloses `openDB`) nichts beitragen.
 */
interface UpgradableStore {
  readonly indexNames: DOMStringList
  createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): unknown
  deleteIndex(name: string): void
}

/**
 * Indizes eines **übernommenen** Stores an die Schema-Definition angleichen: fehlende
 * anlegen, überzählige entfernen. Frisch angelegte Stores brauchen das nicht — sie
 * bekommen ohnehin genau die definierten Indizes.
 *
 * Ohne diesen Abgleich erhielte ein `preserveOnUpgrade`-Store einen später ergänzten
 * Index nie, und `getAllByIndex` schlüge zur Laufzeit fehl — im POS gefangen vom
 * try/catch der Cache-Init, also still (siehe ADR 0039).
 */
function syncIndexes(store: UpgradableStore, indexes: readonly CacheIndexDefinition[]): void {
  const wanted = new Map(indexes.map(index => [index.name, index]))
  for (const name of Array.from(store.indexNames)) {
    if (!wanted.has(name)) store.deleteIndex(name)
  }
  for (const [name, index] of wanted) {
    if (store.indexNames.contains(name)) continue
    store.createIndex(name, index.keyPath as string | string[], { unique: index.unique ?? false })
  }
}

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
      upgrade(db, _oldVersion, _newVersion, tx) {
        // Schlanker Cache → bei einem Versionssprung Stores verwerfen und frisch
        // anlegen statt feingranularer Migration. Der Datenverlust ist gewollt: ein
        // Version-Bump erzwingt einen sauberen Voll-Bootstrap (Offline-Cache-Plan §9).
        //
        // Ausnahme `preserveOnUpgrade` (ADR 0039): Stores mit nicht regenerierbarem
        // Inhalt — die Offline-Outbox — werden übernommen. Ein Recreate wäre hier
        // stiller Verlust unsynchronisierter Bestellungen bei jedem Schema-Update.
        const preserved = new Set(schema.stores.filter(store => store.preserveOnUpgrade).map(store => store.name))
        for (const name of Array.from(db.objectStoreNames)) {
          if (preserved.has(name)) continue
          db.deleteObjectStore(name)
        }
        for (const store of schema.stores) {
          const objectStore = db.objectStoreNames.contains(store.name)
            ? tx.objectStore(store.name)
            : db.createObjectStore(store.name, { keyPath: '_id' })
          syncIndexes(objectStore as unknown as UpgradableStore, store.indexes ?? [])
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

  storeNames(): readonly string[] {
    return Array.from(this.#requireDb().objectStoreNames)
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
