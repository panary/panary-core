import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core'
import { OFFLINE_CACHE } from '@panary/shared/data-access'
import { APP_CONFIG, DeviceConfigService } from '@panary/shared/data-access-config'
import {
  buildCacheBuildId,
  buildCacheDatabaseName,
  CACHE_STORAGE_PORT,
  CacheStoragePort,
  CacheStorageSchema,
  CacheStoreDefinition,
  IdbStorageAdapter,
  OfflineCacheStore,
  requestPersistentStorage,
} from '@panary/shared/offline-cache'
import { PosCacheSyncService } from './pos-cache-sync.service'

/**
 * POS-Cache-Schema (Connect-Tier). Stores = Feathers-Service-Pfade; jeder Store
 * indexiert `updatedAt` (Delta-Cursor, Folgephase) und `[tenantId+locationId]`
 * (Scope-Reads). Ein Version-Bump erzwingt Recreate + Voll-Bootstrap.
 *
 * Bewusst (noch) NICHT gecacht: `users` (posPin-Hash-Sensibilität; Offline-
 * Benutzerwechsel ist ohnehin gesperrt). Preise/Rezepte/Zutaten sind über die
 * Embedded-Snapshots im Produkt abgedeckt.
 */
export const POS_CACHE_SCHEMA: CacheStorageSchema = {
  version: 1,
  stores: [
    cacheStore('products'),
    cacheStore('product-groups'),
    cacheStore('discounts'),
    cacheStore('locations'),
    cacheStore('orders'),
  ],
}

function cacheStore(name: string): CacheStoreDefinition {
  return {
    name,
    indexes: [
      { name: 'updatedAt', keyPath: 'updatedAt' },
      { name: 'scope', keyPath: ['tenantId', 'locationId'] },
    ],
  }
}

/**
 * Aktiviert den Offline-Cache im POS: stellt Storage-Port + Store bereit und
 * initialisiert ihn beim App-Start aus der DeviceConfig (Tenant/Location/Server).
 * Ohne gekoppeltes Gerät (kein tenantId/serverUrl) bleibt der Cache inaktiv — der
 * `BaseService` verhält sich dann exakt wie ohne Cache.
 *
 * `useExisting` ist Pflicht: BaseService injiziert `OFFLINE_CACHE`, der Initializer
 * `OfflineCacheStore` — beide müssen dieselbe Instanz (Mirror + ready-State) teilen.
 */
export const providePosOfflineCache = (): EnvironmentProviders =>
  makeEnvironmentProviders([
    OfflineCacheStore,
    PosCacheSyncService,
    { provide: CACHE_STORAGE_PORT, useClass: IdbStorageAdapter },
    { provide: OFFLINE_CACHE, useExisting: OfflineCacheStore },
    provideAppInitializer(() => {
      // inject() synchron im Injection-Context auflösen, die Init aber NICHT
      // awaiten — der App-Start darf nicht auf die Cache-Hydration warten
      // (Performance-Budget). Bis ready=true verhält sich der Cache wie inaktiv.
      const deviceConfig = inject(DeviceConfigService)
      const store = inject(OfflineCacheStore)
      const port = inject(CACHE_STORAGE_PORT)
      const appConfig = inject(APP_CONFIG)
      // PosCacheSyncService eager instanziieren → startet den Connect-Sync-Effect.
      inject(PosCacheSyncService)
      void initPosOfflineCache(deviceConfig, store, port, appConfig)
    }),
  ])

async function initPosOfflineCache(
  deviceConfig: DeviceConfigService,
  store: OfflineCacheStore,
  port: CacheStoragePort,
  appConfig: { appVersion?: string },
): Promise<void> {
  const config = deviceConfig.getConfig()
  if (!config?.tenantId || !config?.serverUrl) return

  try {
    const databaseName = buildCacheDatabaseName({
      tenantId: config.tenantId,
      locationId: config.locationId ?? null,
      serverUrl: config.serverUrl,
    })
    const buildId = buildCacheBuildId({
      appVersion: appConfig.appVersion ?? '0.0.0',
      schemaVersion: POS_CACHE_SCHEMA.version,
    })
    await requestPersistentStorage()
    await store.init(port, databaseName, POS_CACHE_SCHEMA, buildId)
  } catch (error) {
    // Cache-Init darf den App-Start nie verhindern — ohne Cache läuft der POS
    // online normal weiter (BaseService fällt auf den Netzpfad zurück).
    console.error('[offline-cache] Initialisierung fehlgeschlagen:', error)
  }
}
