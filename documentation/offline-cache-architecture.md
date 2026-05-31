---
title: Offline-Cache (Connect-Tier) — Architektur & Storage-Fundament
date: 2026-05-30
category: Architektur
domains: [sync, orders, products, devices]
status: in-progress (Phase 1 von 6 implementiert)
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

## Roadmap (Folgephasen)

2. Read-Pfad: `BaseService` cache-bewusst (optionaler Store + `cachePolicy`-Flag), In-Memory-Mirror,
   Cache-first/SWR (Stammdaten) + network-first/Fallback (orders), Reuse `matchesRealtimeScope`.
3. Freshness: `CatalogSyncService` (Bootstrap + Delta-Cursor pro Service).
4. Write-Pfad: `OutboxStore` + Replay (uuidv7, idempotent, FIFO, Backoff, Klassifikation).
5. Offline-UX: Connect-Offline-Erkennung, Banner-Eintrag, Bargeld-Zwang, TSE-Ausfallvermerk,
   provisorische `dailySequenceNumber` (Staff-Logout offline gesperrt).
6. Hardening: Performance-Profiling/Web-Worker, Asset-Caching-Stub, Belegnummer-Reconcile-Kontrakt
   (`api-cloud`, cross-repo).
