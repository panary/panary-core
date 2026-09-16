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

/**
 * Stores, die den Build-Mismatch-Wipe **inhaltlich** überleben.
 *
 * - `__outbox`: offline erzeugte Mutationen. Der einzige Store mit nicht
 *   regenerierbarem Inhalt — ein Wipe wäre stiller Umsatzverlust (ADR 0039).
 * - `__cache_meta`: wird direkt nach dem Wipe ohnehin überschrieben.
 *
 * Bewusst **nicht** dabei: `__cursors`. Die Delta-Cursor gehören zum Cache-Inhalt —
 * bliebe ein `lastPullAt` stehen, während die fachlichen Stores leer sind, zöge der
 * Sync nur noch Deltas seit diesem Zeitpunkt und der Cache bliebe dauerhaft
 * unvollständig. Das tauschte stillen Datenverlust gegen stille Unvollständigkeit.
 */
const CACHE_STORES_PRESERVED_ON_WIPE: readonly string[] = [CACHE_META_STORE, CACHE_OUTBOX_STORE]

export interface OpenCacheResult {
  /** True, wenn die fachlichen Stores wegen Build-Mismatch geleert wurden. */
  readonly wiped: boolean
  /**
   * Anzahl der Outbox-Einträge, die den Wipe überlebt haben. `0`, wenn nicht gewipet
   * wurde. Dient der Diagnose: Ohne diesen Zähler hinterlässt weder ein Verlust noch
   * eine gelungene Rettung eine Spur im Log.
   */
  readonly preservedOutboxCount: number
}

/**
 * Öffnet die Cache-DB und garantiert, dass die gespeicherte `buildId` zur
 * erwarteten passt. Bei Mismatch (App-/Schema-Update) werden die fachlichen Stores
 * geleert — das erzwingt einen sauberen Voll-Bootstrap statt feingranularer
 * Migration (Offline-Cache-Plan §6/§9).
 *
 * 🚨 Geleert wird **selektiv**, nicht per `port.destroy()`: Die Offline-Outbox liegt
 * in derselben Datenbank, ihr Inhalt ist aber nicht regenerierbar. Ein Voll-Destroy
 * löschte bei **jedem** App-Update (die `buildId` trägt die App-Version) alle noch
 * nicht übertragenen Bestellungen — ohne Spur und ohne Zutun des Personals, weil der
 * Tauri-Auto-Updater das Update selbst anstößt. Siehe ADR 0039.
 *
 * Schlägt das Leeren fehl, propagiert der Fehler bewusst: Der Aufrufer lässt den
 * Cache dann inaktiv (POS läuft online weiter) und die Outbox bleibt auf der Platte.
 * Ein Rückfall auf `destroy()` wäre genau der Verlust, den diese Funktion verhindert.
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
    return { wiped: false, preservedOutboxCount: 0 }
  }

  const hadStaleData = meta !== undefined
  if (hadStaleData) {
    await clearRegenerableStores(port)
  }

  await port.put<CacheMetaRecord>(CACHE_META_STORE, {
    _id: CACHE_META_KEY,
    buildId,
    createdAt: new Date().toISOString(),
  })
  return {
    wiped: hadStaleData,
    preservedOutboxCount: hadStaleData ? await port.count(CACHE_OUTBOX_STORE) : 0,
  }
}

/**
 * Leert alle Stores der offenen Datenbank außer denen aus
 * {@link CACHE_STORES_PRESERVED_ON_WIPE}. Gelesen wird aus `port.storeNames()`, nicht
 * aus dem Schema — sonst bliebe ein aus dem Schema entfernter, physisch noch
 * vorhandener Store mit veraltetem Inhalt stehen.
 */
async function clearRegenerableStores(port: CacheStoragePort): Promise<void> {
  for (const name of port.storeNames()) {
    if (CACHE_STORES_PRESERVED_ON_WIPE.includes(name)) continue
    await port.clear(name)
  }
}

function withMetaStore(schema: CacheStorageSchema): CacheStorageSchema {
  // `preserveOnUpgrade` gilt für den Schema-Versionssprung (der Adapter verwirft dort
  // sonst alle Stores). Der Outbox-Store MUSS dabei sein — sonst fiele der Inhalt
  // beim Schema-Update durch genau die Lücke, die der selektive Wipe oben schließt.
  // `__cache_meta` ebenfalls, damit der Build-Mismatch danach erkannt wird und der
  // Pfad oben (inkl. Cursor-Leerung) auch bei einem Versionssprung läuft.
  const internalStores: CacheStoreDefinition[] = [
    { name: CACHE_META_STORE, preserveOnUpgrade: true },
    { name: CACHE_CURSORS_STORE },
    { name: CACHE_OUTBOX_STORE, preserveOnUpgrade: true },
  ]
  return { version: schema.version, stores: [...internalStores, ...schema.stores] }
}
