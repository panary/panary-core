import { CacheEntity, CacheStorageSchema, CacheStoragePort, CacheStoreDefinition } from './cache-storage.port'

/** Interner Meta-Store, der die Build-Kennung des Caches hält. */
export const CACHE_META_STORE = '__cache_meta'
const CACHE_META_KEY = 'meta'

export interface CacheMetaRecord extends CacheEntity {
  readonly _id: string
  readonly buildId: string
  readonly createdAt: string
}

/** Interner Store für die Delta-Sync-Cursor (lastPullAt pro Service-/Store-Name). */
export const CACHE_CURSORS_STORE = '__cursors'

export interface CacheCursorRecord extends CacheEntity {
  readonly _id: string
  readonly value: string
}

/** Interner Store für die Offline-Outbox (ausstehende Mutationen). */
export const CACHE_OUTBOX_STORE = '__outbox'

export interface OpenCacheResult {
  /** True, wenn die DB wegen Build-Mismatch verworfen und neu angelegt wurde. */
  readonly wiped: boolean
}

/**
 * Öffnet die Cache-DB und garantiert, dass die gespeicherte `buildId` zur
 * erwarteten passt. Bei Mismatch (App-/Schema-Update) wird die Datenbank
 * verworfen und frisch angelegt — das erzwingt einen sauberen Voll-Bootstrap
 * statt feingranularer Migration (Offline-Cache-Plan §6/§9).
 */
export async function openCacheDatabase(
  port: CacheStoragePort,
  databaseName: string,
  schema: CacheStorageSchema,
  buildId: string,
): Promise<OpenCacheResult> {
  const schemaWithMeta = withMetaStore(schema)
  await port.open(databaseName, schemaWithMeta)

  const meta = await port.get<CacheMetaRecord>(CACHE_META_STORE, CACHE_META_KEY)
  if (meta?.buildId === buildId) {
    return { wiped: false }
  }

  const hadStaleData = meta !== undefined
  if (hadStaleData) {
    await port.destroy(databaseName)
    await port.open(databaseName, schemaWithMeta)
  }

  await port.put<CacheMetaRecord>(CACHE_META_STORE, {
    _id: CACHE_META_KEY,
    buildId,
    createdAt: new Date().toISOString(),
  })
  return { wiped: hadStaleData }
}

function withMetaStore(schema: CacheStorageSchema): CacheStorageSchema {
  const internalStores: CacheStoreDefinition[] = [
    { name: CACHE_META_STORE },
    { name: CACHE_CURSORS_STORE },
    { name: CACHE_OUTBOX_STORE },
  ]
  return { version: schema.version, stores: [...internalStores, ...schema.stores] }
}
