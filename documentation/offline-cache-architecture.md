---
title: Offline-Cache (Connect-Tier) — Architektur & Storage-Fundament
date: 2026-05-30
category: Architektur
domains: [sync, orders, products, devices]
status: in-progress (Phasen 1–4 von 6 implementiert)
---

# Offline-Cache (Connect-Tier) — Architektur & Storage-Fundament

ADR für den **schlanken Client-Cache** des POS-Clients im **Connect-Tier** (cloud-direkt,
ohne Edge-Hub). Dieses Dokument hält die Architektur-Entscheidung fest und beschreibt das
in **Phase 1** gelieferte Storage-Fundament (`@panary/shared/offline-cache`).

> **Abgrenzung:** Dies ist **kein Edge-Nachbau**. Keine geräteübergreifende Nummern-Autorität,
> keine Multi-Device-Koordination, keine vollständige Conflict-Engine, kein Print-Server.
> **Single-Device-Annahme.** Sobald Multi-Device / lückenloses Offline-Signieren / Print-Server
> gebraucht werden, greift der Edge-Hub (Operate-Tier, separat). Der vollständige Umsetzungsplan
> liegt außerhalb des Repos unter `_WORKBENCH_PANARY/_planning/pos-mobile-strategie/`.

## Problem

Der `pos-client` ist heute ein **reiner Socket.IO-Feathers-Client ohne clientseitige Persistenz**.
Fällt im Connect-Tier das Netz aus, rejecten `find/get/create/patch` und der Kassenbetrieb steht.
Es braucht einen Cache + eine Outbox, damit der **Bargeld**-Bestellbetrieb kurze Verbindungsausfälle
(Cloud ODER Edge) überlebt. Die Cache-Logik muss **backend-agnostisch** über dieselbe
FeathersJS-Service-Schnittstelle funktionieren.

## Entscheidung

- **Storage: IndexedDB via `idb`**, hinter einem austauschbaren `CACHE_STORAGE_PORT`.
  IndexedDB trägt in beiden App-Hüllen (Tauri-WebView, künftige Capacitor-WebView) **ohne natives
  Plugin**; async/Promise-basiert (kein Main-Thread-Block). Client-SQLite wurde verworfen (zwei
  Implementierungen je Hülle, WASM-Bundle, nähert sich der Edge an). Der Port erlaubt einen späteren
  SQLite-Adapter ohne Konsumenten-Änderung.
- **Namespacing:** Cache-DB-Name = `panary-cache::{tenantId}::{location}::{serverHost}` →
  **harte Tenant-/Location-Isolation auf physischer Ebene** (Defense-in-Depth zusätzlich zur
  server-/realtime-seitigen Isolation). Re-Pairing / Tenant- oder Location-Wechsel ⇒ andere DB.
- **Versionierung/Migration:** `CacheStorageSchema.version`-Bump ⇒ Stores verwerfen + neu anlegen
  (Recreate statt feingranularer Migration). Zusätzlich `cacheBuildId` (App-Version + Schema-Version)
  in einem Meta-Store; Mismatch beim Öffnen ⇒ **Wipe + Voll-Bootstrap** (`openCacheDatabase`).
- **Freshness (Folgephasen):** Hybrid — einmaliger Voll-Bootstrap, danach inkrementeller Delta-Sync
  über `updatedAt`-Cursor (`getAllByIndex` auf dem `updatedAt`-Index), Voll-Refresh als Fallback.
- **Persistenz härten:** `requestPersistentStorage()` (`navigator.storage.persist()`) verhindert
  Eviction unter Storage-Druck.

## Konsequenzen

- Neue, opt-in nutzbare Shared-Lib `@panary/shared/offline-cache`; keine Auswirkung auf Konsumenten,
  die sie nicht einbinden (admin-dashboard unverändert).
- Neue Runtime-Dependency `idb`, Dev-Dependency `fake-indexeddb` (Tests laufen in Node).
- Der Cache ist nur ein Baustein: Read-Pfad-Integration am `BaseService`, Outbox/Replay und
  Offline-UX (Banner, Bargeld-Zwang, TSE-Ausfallvermerk, provisorische Belegnummer) folgen in
  späteren Phasen.
- **Entkopplung (cross-repo):** Der `BaseService` hängt an der Abstraktion `OfflineCachePort`
  (+ `normalizeToRecords`, `CachePolicy`, `CacheEntity`) in `@panary/shared-common` und am
  `OFFLINE_CACHE`-Token in `data-access` — **nicht** an `@panary/shared/offline-cache`. So muss
  das admin-dashboard (panary-cloud) den Cache samt `idb` nicht mitbundeln (es mappt
  `@panary/shared/offline-cache` nicht). Die POS-App bindet die konkrete `OfflineCacheStore` über
  `{ provide: OFFLINE_CACHE, useExisting: OfflineCacheStore }`.

## Geliefert in Phase 1 (`libs/shared/offline-cache`)

| Datei | Inhalt |
|---|---|
| `cache-storage.port.ts` | `CACHE_STORAGE_PORT` (InjectionToken) + Interfaces (`CacheStoragePort`, `CacheStorageSchema`, `CacheEntity`, …) |
| `idb-storage.adapter.ts` | `IdbStorageAdapter` — IndexedDB-Implementierung über `idb` (open/get/getAll/getAllByIndex/put/bulkPut/delete/clear/count/close/destroy) |
| `cache-namespace.ts` | `buildCacheDatabaseName` (Tenant/Location/Server-Namespace) + `buildCacheBuildId` |
| `cache-bootstrap.ts` | `openCacheDatabase` — Build-ID-Check, Wipe-on-Mismatch, Meta-Store |
| `persist-storage.ts` | `requestPersistentStorage` |

Tests: 17 Specs grün (`fake-indexeddb`, node-Environment). `nx lint`/`nx test offline-cache` grün.

## Geliefert in Phase 2 (Read-Pfad + POS-Aktivierung)

- **Cache-Schicht** (`OfflineCacheStore` + Merge-Helfer) und **opt-in `BaseService`-Integration**:
  `cachePolicy`/`cacheStoreName`, Read mit Offline-Fallback (find/get), Write-Through und
  Realtime-Spiegelung. Die Abstraktion (`OfflineCachePort`, `normalizeToRecords`, `CacheEntity`,
  `CachePolicy`) liegt in `@panary/shared-common`, der Token `OFFLINE_CACHE` in `data-access` —
  kein harter offline-cache-Import im `BaseService` (admin-dashboard bundelt kein `idb`).
- **POS-Aktivierung** (`apps/pos-client`): `providePosOfflineCache()` (Storage-Port + Store +
  App-Initializer aus `DeviceConfig`, non-blocking) + `POS_CACHE_SCHEMA`. Aktivierte Services:
  `products`, `product-groups`, `discounts`, `locations` (master-data) + `orders` (transactional).
  Bewusst (noch) nicht gecacht: `users` (posPin-Sensibilität, Offline-Wechsel gesperrt);
  Preise/Rezepte/Zutaten sind über die Produkt-Embedded-Snapshots abgedeckt.
- Verifiziert: `nx build pos-client` grün (Bundle inkl. `idb`). Ohne gekoppeltes Gerät bleibt der
  Cache inaktiv → unverändertes Verhalten.

## Geliefert in Phase 3 (Freshness — Bootstrap + Delta-Sync)

- **Cursor-Persistenz** im `OfflineCacheStore` (`getCursor`/`setCursor`, interner `__cursors`-Store)
  — lastPullAt pro Service.
- **`PosCacheSyncService`** (`apps/pos-client`): startet beim (Re-)Connect (effect auf `ready` +
  `connectionState='authenticated'`, `untracked`) je Service einen paginierten Pull — Delta
  (`updatedAt > cursor`) wo unterstützt (products, orders), sonst Voll-Refresh-Fallback
  (product-groups, discounts, locations). Die `find()` cachen über den `BaseService` write-through;
  der Sync verwaltet nur Cursor + Pagination. `#syncing`-Guard gegen Überlappung.
- Verifiziert: `nx build pos-client` grün; `nx test offline-cache` grün (32 Specs, inkl. Cursor).
- Bewusst offen (Folge): Soft-Delete-Reconciliation im Pull (heute via `cacheBuildId`-Wipe +
  Realtime-`removed`); Web-Worker-Auslagerung.

## Geliefert in Phase 4 (Write-Pfad — Outbox + Offline-Anlage + Replay)

- **`OutboxStore`** (`__outbox`-IDB-Store): enqueue/claimDue/markAcked/markRetry/markRejected, Backoff
  (`outboxBackoffMs`), Fehler-Klassifikation (`classifyOutboxError`: already-exists/terminal/transient).
  Implementiert `OfflineOutboxPort` (shared-common), Token `OFFLINE_OUTBOX` (data-access).
- **Schema-Marker** `offlineCreated` + `provisionalSequenceNumber` (`@panary/orders/domain`).
- **Backend-TSE-Skip** (api-edge **und** api-cloud): `signOrderTseStart` überspringt `offlineCreated`-
  Orders → **kein rückwirkendes Signieren** beim Replay (KassenSichV §146a). `_id` wird vom Order-
  Resolver akzeptiert (idempotent), `dailySequenceNumber` serverseitig re-gestempelt.
- **OrderService**: offline → `#enqueueOfflineOrder` (uuidv7-`_id`, provisorische Sequenz, Marker),
  optimistisch in Cache + Outbox, statt zu werfen. Online unverändert; ohne POS-Provider inert.
- **`PosOutboxReplayService`**: Replay beim (Re-)Connect über die **rohen** Feathers-Services (nicht
  `BaseService` — sonst Re-Queue + `_id`-Verlust), idempotent, Backoff, `rejected`→Operator (Phase 5),
  `#replaying`-Guard.
- Verifiziert: `nx build pos-client` grün; offline-cache 45 Specs, api-edge 12 / api-cloud 16 (TSE-Skip).
- **Cross-Repo:** api-cloud-Skip für **Prod** erst nach Core-Release (`offlineCreated`) + Cloud-Pin-Bump
  aktiv (Option-A-Flow); lokal greift alles. Offen (Folge): Replay-Retry-Timer (heute nur connect-getriggert).

## Roadmap (Folgephasen)

2. ✅ **Read-Pfad + POS-Aktivierung** (siehe oben) — erledigt.
3. ✅ **Freshness — Bootstrap + Delta-Sync** (siehe oben) — erledigt.
4. ✅ **Write-Pfad — Outbox + Offline-Anlage + Replay** (siehe oben) — erledigt.
5. Offline-UX: Connect-Offline-Erkennung, Banner-Eintrag, Bargeld-Zwang, TSE-Ausfallvermerk,
   provisorische `dailySequenceNumber` (Staff-Logout offline gesperrt).
6. Hardening: Performance-Profiling/Web-Worker, Asset-Caching-Stub, Belegnummer-Reconcile-Kontrakt
   (`api-cloud`, cross-repo).
