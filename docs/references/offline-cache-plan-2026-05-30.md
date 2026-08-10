---
type: Reference
title: 'Historisch — POS-Client Offline-Cache (Connect-Tier), Umsetzungsplan vom 2026-05-30'
description: Der ursprüngliche Umsetzungsplan für den Connect-Tier-Offline-Cache; abgelöst durch die tatsächliche Implementierung und ADR 0008.
tags: [orders, products, sync, devices, businessdays, tse]
status: deprecated
generated: { by: claude-code/opus-5, at: 2026-05-30T00:00:00.000Z }
---

> **Abgelöst.** Maßgeblich ist
> [ADR 0008 — Offline-Cache-Architektur](../adr/0008-offline-cache-architecture.md).
> Umgesetzt am 2026-06-16 mit `feat(offline-cache): POS Connect-Tier Offline-Cache + Outbox`
> (`ac8dfb4c`, #31); der Code liegt in `apps/pos-client/src/app/offline-cache.provider.ts`
> und `pos-cache-sync.service.ts`.
>
> Diese Seite bleibt als **Planungsstand vor der Umsetzung** erhalten — sie zeigt, was
> beabsichtigt war, nicht was gebaut wurde. Wer wissen will, wie es heute funktioniert, liest
> ADR 0008. Aufgehoben statt gelöscht nach `.claude/rules/documentation.md` §2
> („Abgelöste Doku: `status: deprecated` + Link auf den Nachfolger — niemals löschen").

# Umsetzungsplan: POS-Client Offline-Cache (Connect-Tier)

> **Ablage:** Liegt bewusst **außerhalb der Git-Repos** (`_WORKBENCH_PANARY/_planning/`) und wird
> **nicht** eingecheckt. Querverweise auf `*.md` ohne Pfad meinen `panary-core/documentation/`.
> Dies ist ein **Umsetzungsplan — kein Code.**

Schwesterdokumente: [`mobile-pos-strategie-recherche.md`](mobile-pos-strategie-recherche.md) ·
[`edge-hub-anforderungen.md`](edge-hub-anforderungen.md)

---

## Kontext (Warum)

Aus der Mobile-POS-Strategie ergab sich ein getiertes Modell: Der **Edge-Hub** ist kein Pflicht-Baustein
mehr, sondern ein Operate-Tier-Upgrade. Das **Connect-Tier** betreibt den `pos-client` **cloud-direkt**
ohne Edge. Heute ist der POS-Client ein **reiner Socket.IO-Feathers-Client ohne jegliche clientseitige
Persistenz** — fällt das Netz aus, rejecten `find/get/create/patch` und der Kassenbetrieb steht.

Diese Funktion gibt dem Connect-Tier einen **schlanken Client-Cache** + **Offline-Outbox**, damit kurze
Verbindungsausfälle (Cloud ODER Edge) den Bargeld-Bestellbetrieb nicht unterbrechen. Der Cache ist
**backend-agnostisch** (gleiche Feathers-Service-Schnittstelle), zielt aber primär auf den Cloud-direkt-Fall;
mit präsentem Edge übernimmt dieser ohnehin die Offline-Last.

**Kein Edge-Nachbau:** keine geräteübergreifende Nummern-Autorität, keine Multi-Device-Koordination, keine
vollständige Conflict-Engine, kein Print-Server. **Single-Device-Annahme.** Sobald Multi-Device,
lückenloses Offline-Signieren oder ein Print-Server gebraucht wird, greift der Edge-Hub (Operate-Tier,
außerhalb dieses Scopes).

---

## Bestandsaufnahme (verifiziert im Code)

| Baustein | Datei | Relevanz |
|---|---|---|
| Reiner Socket.IO-Client, kein REST | `libs/shared/data-access/.../connection.service.ts` | Bei Disconnect rejecten Service-Calls → Cache muss offline kurzschließen |
| Online/Offline-Signale | `connection.service.ts`: `connectionState()` (`disconnected\|connecting\|connected\|authenticated\|error`), `serverLink().isConnected`, `tier()` (`cloud-direct`), `/health`-Poll alle 60 s | **Wiederverwenden** für Offline-Erkennung |
| CRUD-Andockpunkt | `libs/shared/data-access/.../base.service.ts`: `find/get/create/patch/update/remove` (delegieren + re-throw), `handleItemCreated/Updated/Removed`, `acceptsRealtimeItem`+`scopeGuard` | Cache-Layer dockt hier an |
| Tenant/Location-Scope | `realtime-scope-guard.ts`: `matchesRealtimeScope(item, ctx)`; POS-Provider `apps/pos-client/src/app/realtime-scope-guard.provider.ts` | **Pure Predicate wiederverwenden** für Cache-Scoping |
| Geräte-/Scope-Kontext | `libs/shared/data-access-config/.../device-config.service.ts`: `tenantId/locationId/serverUrl/deviceId/apiKey`, `testConnection()`→`/health` | Cache-Namespace + Invalidierungs-Trigger |
| Order-Read-Pfad | `libs/domains/orders/data-access/.../order.service.ts`: `loadDocuments()` re-queryt Backend bei jedem Realtime-Event, gegated auf `currentBusinessDay` | Netzabhängig → Cache-Quelle |
| Order-Write-Pfad | `libs/domains/orders/feature-pos-order-dialog/.../order-dialog.component.ts`: nutzt bereits `uuidv7()`; `OrderService.createOrder(...)` | Client-IDs etabliert → Outbox baut darauf auf |
| Sync-Muster (Vorlage) | `libs/domains/sync/domain/src/lib/`: `sync-pull.schema.ts` (since/cursor/deletedAt), `sync-cursor.schema.ts`, `sync-outbox-entry.schema.ts`, `sync-op.schema.ts`, Backoff-Plan | **Typen/Muster spiegeln**, NICHT die Edge-Engine klonen |
| Geteilte Berechnung | `@panary/businessdays/aggregator` (deterministisch, kein I/O); Steuern inline auf `product.taxInside/taxOutside` | Offline nutzbar, kein Tax-Service nötig |
| Banner-System | `cloud-status-banner.*` (priorisierter Selector); `cloudUnreachable`/`offlineModeActive` greifen **nur in Tier 3** | UI wiederverwenden; **Connect-Offline-Fall ist neu** |
| Produktbilder | `product.schema.ts`: **kein** Bild-Feld (`icon`=Emoji, `ui.colorBg/Text`); nur `supplier-products.imageUrl` | Asset-Caching heute nur vorausschauend |
| Delta-fähig | `product.schema.ts`: `updatedAt` in `productQueryProperties` (analog orders) | `$gt:updatedAt`-Delta möglich |

---

## Entscheidungen (vom Auftraggeber bestätigt)

1. **Storage:** IndexedDB via `idb`-Wrapper, hinter Storage-Port-Abstraktion (später austauschbar). Neue Dependency `idb`.
2. **Freshness:** Hybrid — einmaliger Voll-Bootstrap, danach inkrementeller Delta-Sync über `updatedAt`-Cursor; Voll-Refresh als Fallback.
3. **Belegnummer offline:** Client vergibt provisorische `dailySequenceNumber` (Flag `offlineSequence`), Cloud bleibt online autoritativ; Re-Stamp bei Reconnect.
4. **Offline-Staff-PIN (entschieden):** **Option A** — die Geräte-Session bleibt offline gültig, der bereits angemeldete Mitarbeiter bleibt aktiv; **Benutzerwechsel/Staff-Logout ist offline gesperrt** (verlangt `verifyPin` → Server). Optional **B** als spätere Ausbaustufe: kurzlebiger lokaler bcrypt-Hash **nur** für heute an diesem Gerät bereits angemeldete Mitarbeiter. Kein Klartext, kein dauerhafter Hash-Cache.
5. **Belegnummer-Reconcile (entschieden):** **Cloud bleibt autoritativ.** Offline-Bon trägt sichtbar eine **„vorläufige"** Kennzeichnung + provisorische lokale Nummer; beim Replay vergibt `api-cloud` die finale `dailySequenceNumber` (Re-Stamp) und verlinkt provisorisch↔final im Audit. → Erfordert kleinen Backend-Zusatz (siehe §14.2).
6. **Geschäftstag offline (entschieden):** **Option A** — offline wird nur **innerhalb eines bereits offenen** Geschäftstags weiterkassiert. Eröffnung/Abschluss (`businessdays.open`/`close`) bleiben **online**. Der „Kaltstart ohne Netz" (morgens kein offener Tag + kein Netz) ist eine **bewusst akzeptierte Einschränkung**.

---

## Annahmen (explizit)

- **Single-Device** pro Connect-Standort. Keine zweite Kasse, die offline parallel Nummern zieht.
- Geräte-Session (Device-JWT/apiKey) bleibt offline gültig; der Socket reconnectet automatisch (`reconnectionAttempts: Infinity`).
- **Geschäftstag wird online geöffnet/geschlossen.** Offline wird nur innerhalb eines bereits offenen Geschäftstags weiterkassiert (siehe offene Punkte).
- Katalog-Datenmenge SMB-typisch (einige tausend Produkte) → IndexedDB + In-Memory-Mirror tragen das mühelos.
- Offline ⇒ **nur Bargeld**; Karten (Stripe) & Online-TSE (Fiskaly) sind offline nicht möglich (geerbte Constraints).

---

## 1. Vollständige Liste offline benötigter Datensätze

### A) Read-Cache (Stammdaten/Kontext für die Bestellaufnahme)

| Service | Begründung Order-Flow | Delta-Schlüssel |
|---|---|---|
| `products` | Product-First: `PRODUCT`/`MODIFIER`/`BUNDLE`; `price`, `mainPrice`, `taxInside/taxOutside`, `optionGroups`, `bundlePricingMode`, `availability`, `ui`, `categoryIds`, `ingredient/recipeReferences` | `updatedAt` ✓ |
| `product-groups` | Kategorien-Navigation, Kachel-Sortierung | `updatedAt` (verifizieren) |
| `pricelists` | Aktive Preisliste / Preis-Auflösung | `updatedAt` (verifizieren) |
| `discounts`, `discount-codes` | Rabatt-Definitionen für `appliedDiscounts` | `updatedAt` (verifizieren) |
| `recipes`, `ingredients` | Rezept-/Modifier-Auflösung, Bestands-Referenzen, Aggregator-Input | `updatedAt` (verifizieren) |
| `locations` | Aktive Location + `currentBusinessDay`-Kontext (`loadDocuments`-Gate) | `updatedAt` ✓ (laut Memory) |
| `businessdays` | Aktiver Geschäftstag (Kontext, nicht offline öffnen) | `updatedAt` ✓ |
| `users` (PosUser) | Login-Auswahl + Identität (`creationContext.createdBy`) | `updatedAt` (verifizieren) |
| `private-customers`, `corporate-customers` | Bankett/Firmenkunde (optional, `customerPaymentInfo`) | `updatedAt` (verifizieren) |
| `cash-sessions` | Bargeld-Kontext/Schublade (für Bar-Buchung offline) | `updatedAt` (verifizieren) |
| Tische/Bereiche | `order.table` ist heute freies String-Feld — **Service-Pfad zu verifizieren** (evtl. kein eigener Service) | — |

**Steuersätze:** kein eigener Service — inline auf `product.taxInside/taxOutside`. **Zahlarten:** kein Service — Enum `cash\|card\|online\|other`; offline nur `cash`.

### B) Write-Outbox (offline erzeugte Mutationen)

| Service | Operationen | Priorität |
|---|---|---|
| `orders` | `create`, `patch` (Status/Payment) | **Primär** |
| `order-interactions` | `create` (Storno/Modifikation) | Primär (wenn offline erlaubt) |
| `cash-sessions` | `patch`/Custom (Bar-Bewegung) | Sekundär |
| `working-times` | `checkin/checkout` (Clock-in offline) | Sekundär |

### C) Lokale Identität/Auth (bereits persistiert, nicht Teil des neuen Cache)

- `DeviceConfig` (localStorage) + Device-JWT (sessionStorage). **Offline-Staff-PIN-Verifikation** (`verifyPin`/bcrypt) ist serverseitig → **offener Sicherheitspunkt** (siehe Risiken).

---

## 2. Storage-Entscheidung (begründet)

**IndexedDB via `idb` (Jake Archibald), hinter `CACHE_STORAGE_PORT`-Abstraktion.**

- **Trägt in beiden Hüllen ohne Sonderpfad:** IndexedDB ist in Tauri-WebView (WebView2/WKWebView) und in der künftigen Capacitor-WKWebView/Android-WebView identisch verfügbar — **kein natives Plugin** nötig. Client-SQLite bräuchte zwei Implementierungen (wa-sqlite/WASM in Tauri vs. `@capacitor-community/sqlite` nativ) und nähert sich der Edge an (Scope-Verstoß).
- **Async, Promise-basiert** (kein synchrones `localStorage` → kein Main-Thread-Block); `localStorage` (~5–10 MB, String-only) scheidet für Katalogdaten aus.
- **Datenmenge:** Connect-Katalog liegt weit unter IndexedDB-Grenzen; `idb` ist ein ~1 KB Typed-Wrapper über native Versionierung/Indizes.
- **Abstraktion:** `CACHE_STORAGE_PORT` (Interface `get/getAll/put/bulkPut/delete/clear/queryByIndex`) entkoppelt die Engine — ein späterer SQLite-Adapter (falls das Gerät Richtung Operate-Tier wächst) ist ein Adapter-Tausch ohne Konsumenten-Änderung.

**Persistenz härten:** `navigator.storage.persist()` beim ersten Bootstrap anfordern (verhindert Eviction unter Storage-Druck).

---

## 3. Architektur & Code-Verortung

**Neue Lib `@panary/shared/offline-cache`** (`libs/shared/offline-cache/`, via `nx g @nx/angular:library`), enthält:

- `CACHE_STORAGE_PORT` + `IdbStorageAdapter` (idb)
- `OfflineCacheStore` — namespaced Object-Stores pro Service, In-Memory-Mirror (Signals)
- `CatalogSyncService` — Bootstrap + Delta-Cursor
- `OutboxStore` + `OutboxReplayService`
- `OfflineStatusService` — leitet Connect-Offline aus `ConnectionService` ab
- `OFFLINE_CACHE_REGISTRY` — Whitelist cachebarer Services + Read-Policy

**Integration in `BaseService` (minimaler Diff, opt-in):**

- `BaseService` injiziert `OfflineCacheStore` **optional** (`inject(..., { optional: true })`) — exakt wie `scopeGuard` heute. Admin-Dashboard liefert keinen Provider → Verhalten unverändert. POS liefert ihn → Cache aktiv.
- Neues geschütztes Flag `protected cachePolicy: 'none' | 'master-data' | 'transactional' = 'none'`. `ProductService`, `ProductGroupService` etc. setzen `'master-data'`; `OrderService` setzt `'transactional'`.
- `find()/get()`: bei `cachePolicy !== 'none'` durch die Cache-Logik (§4) leiten.
- `create()/patch()/remove()`: offline → in Outbox (§5) statt Socket; online → Socket + Write-Through in Cache.
- `handleItemCreated/Updated/Removed`: zusätzlich `OfflineCacheStore.upsert/remove` (idempotent per `_id`), weiterhin durch `acceptsRealtimeItem`/`matchesRealtimeScope` gefiltert.

Die Domain-Data-Access-Services (`OrderService` etc.) behalten ihre Signal-API; `loadDocuments()` liest künftig über den cache-bewussten `find()`.

---

## 4. Read-Pfad

**In-Memory-Mirror als Render-Quelle, IndexedDB als Persistenz.** Beim App-Start hydratisiert `OfflineCacheStore` die Mirror-Signals **einmal** aus IndexedDB (async, nicht blockierend) → Katalog-Render aus dem Speicher (kein IDB auf dem kritischen Pfad → kein Ruckeln).

**Read-Policy pro Service-Typ:**

- **`master-data` (Katalog) → Cache-first + Stale-While-Revalidate:** `find()` liefert sofort den Mirror-Stand; parallel (online) Hintergrund-Revalidierung via Delta-Sync; Ergebnis upsertet Mirror + IndexedDB → Signal-Update rendert nach. Schnellste Navigation, keine Netz-Latenz im Klickpfad.
- **`transactional` (orders) → Network-first mit Cache-Fallback + Outbox-Merge:** online normaler Socket-Read (+ Cache-Write-Through); offline `merge(Cache-Snapshot, Outbox-pending)` → optimistische Orders erscheinen sofort. Realtime-Events bleiben die Live-Quelle.

**Indizierung (IndexedDB):** je Store Index auf `[tenantId, locationId]` (Scope-Reads), `updatedAt` (Delta), `status`/`recordingDate`/`businessDayId` (orders), `categoryIds` (Katalog-Filter).

---

## 5. Write-Pfad (Outbox)

**Schema:** `SyncOutboxEntry`-Muster aus `@panary/sync/domain` als geteilten Typ wiederverwenden (`SyncOp`=create/patch/remove, Status `pending/in-flight/acked/rejected`, `attempts/nextAttemptAt`, Backoff-Plan 30 s→1 m→5 m→30 m→2 h→6 h). **Nicht** die Edge-Engine importieren — eigener schlanker Client-Replay.

- **Client-IDs:** `_id` = `uuidv7()` (bereits im Order-Flow etabliert). Zeitstempel `recordingDate`/`occurredAt` lokal (ISO 8601). `dailySequenceNumber` = provisorisch aus lokalem Zähler + Flag `offlineSequence: true`.
- **Optimistisches Anlegen:** Order sofort in Mirror/Outbox → UI zeigt sie ohne Server-Roundtrip; Bon druckt mit TSE-Ausfallvermerk (§7).
- **Idempotenz beim Replay:** Server-Upsert per `_id` (uuidv7 stabil) → Re-Send nach unklarer Antwort dupliziert nicht. Realtime-Echo nach Replay wird per `_id`-Upsert absorbiert.
- **Reihenfolge:** FIFO pro `entityId` (create vor zugehörigem patch); Replay seriell pro Entity, parallel über verschiedene Entities erlaubt.
- **Teil-Fehler:** Antwort-Klassifikation `transient` (Backoff-Retry), `terminal` (Status `rejected` → Operator-Hinweis), `conflict` (Cloud-LWW gewinnt bei Stammdaten; bei Orders eskalieren — selten, da Single-Device neue Orders erzeugt, keine fremden ändert).
- **Trigger:** Replay startet, wenn `connectionState()` auf `connected/authenticated` wechselt — via `effect()` mit **Pflicht-`untracked()`** (Regel angular.md §2.1), zzgl. manuellem „Jetzt synchronisieren".
- **Kartenzahlung & TSE-Signatur werden NIE in die Outbox geschrieben** (geerbte Constraints).

---

## 6. Freshness / Delta-Sync (Hybrid)

Spiegelt das vorhandene `sync-pull`-Muster auf der Client-Seite (eigene, schlanke Implementierung):

1. **Bootstrap (leerer Cache / Re-Pairing / Version-Bump):** Voll-Load pro Whitelist-Service via paginierten `find()` (`$limit`, `$skip`), Tenant/Location-gescopet. `cursor[service].lastPullAt = serverTimestamp` setzen.
2. **Delta (Reconnect/periodisch):** `find({ query: { tenantId, locationId, updatedAt: { $gt: lastPullAt }, $sort: { updatedAt: 1 }, $limit } })`, seitenweise bis erschöpft; `deletedAt`/Soft-Delete → aus Cache entfernen; danach `lastPullAt` vorrücken. Backend-`updatedAt` ist serverseitig gesetzt (Konsistenz-Anker).
3. **Cursor-Persistenz:** eigener `cache-cursor`-Store (pro Service `lastPullAt`), analog `sync-cursor.schema.ts`.
4. **Fallback:** Bei Cache-Korruption, Schema-Migration oder `cacheBuildId`-Mismatch → Store wipen + Voll-Bootstrap.

**Empfehlung umgesetzt:** Delta ist Default (performant), Voll-Refresh ist Erst-Bootstrap + Notnagel.

---

## 7. Konsistenz, Tenant-Scoping & TSE/Bargeld

- **Tenant-/Location-Isolation (absolut):**
  - DB-Name **namespaced**: `panary-cache::{tenantId}::{locationId}::{serverHost}` — fremder Scope liegt physisch in anderer DB.
  - Jeder Cache-Write zusätzlich durch `matchesRealtimeScope(item, posCtx)` (Defense-in-Depth, identisch zum Realtime-Pfad).
  - Jeder Cache-Read re-appliziert Tenant/Location-Filter (nie scope-fremde Auslieferung).
- **TSE-Ausfallmodus (KassenSichV):** offline `order.tse` als dokumentierter Ausfall markieren (Ausfallbeginn/-zeitraum protokollieren), Bon trägt TSE-Ausfallvermerk. **Kein Nachsignieren** bei Reconnect — nur der Order-Datensatz läuft per Outbox nach.
- **Bargeld-Zwang:** offline UI auf `cash` beschränken (Karten-Button disabled + Hinweis); `card/online`-Transaktionen werden weder erzeugt noch gequeued.

### 7a. Write-Pfad — abgestimmtes Phase-4-Design (2026-06-15)

**Entscheidung:** vertikaler Slice, **orders-only**. Code-Realität verifiziert:
- api-edge Order-Resolver `_id = value || uuidv7()` → **client-gelieferte `_id` wird akzeptiert** (idempotentes Replay).
- `assignDailySequenceNumber()` stempelt server-seitig **immer** → Replay re-stampt die finale Sequenz (Cloud autoritativ).
- `signOrderTse`-Hook signiert bei jedem create → **Replay würde rückwirkend signieren** ⇒ **Backend-Marker zwingend**.

**Bausteine:**
1. **`OutboxStore`** (offline-cache): `__outbox`-Store; Eintrag `{ _id, service, op, entityId, payload, occurredAt, status (pending|in-flight|acked|rejected), attempts, nextAttemptAt }` (Muster `sync-outbox-entry`).
2. **Schema-Marker** `offlineCreated` (+ `provisionalSequenceNumber`) in `@panary/orders/domain` (geteilt, additiv).
3. **Backend** (api-cloud Connect + api-edge): Order-create mit `offlineCreated` ⇒ `signOrderTse` **skippen** (analog `fromSync`); Sequenz-Re-Stamp bleibt; provisorische Nummer fürs Audit erhalten.
4. **`BaseService` (transactional)**: offline → Entität client-vervollständigen (uuidv7-`_id`, provisorische Sequenz, `offlineCreated`), optimistisch in Cache + Outbox, optimistisch zurückgeben statt zu werfen.
5. **`PosOutboxReplayService`** (pos-client): auf Reconnect FIFO pro `entityId`, create→patch, „existiert bereits"=acked, Backoff, `rejected`→Operator (Phase 5).

**Build-Reihenfolge:** (1) OutboxStore → (2) Schema-Marker → (3) Backend-TSE-Skip (Core + Cloud-Pin) → (4) BaseService-Write + Order-Anlegen → (5) Replay. Bargeld-Zwang/TSE-Bon/Banner/Operator-UI = Phase 5 (UX).

---

## 8. Verbindungs-/Status-Erkennung & UX

- **Wiederverwenden:** `ConnectionService` (`connectionState`, `serverLink.isConnected`, `/health`-Poll, `tier()`).
- **Neue Lücke schließen:** `cloudUnreachable` greift nur in Tier 3. `OfflineStatusService` leitet für **Connect (`cloud-direct`)** einen `posOffline`-Zustand ab (Socket disconnected ODER `/health`-Fetch scheitert über N Polls).
- **Banner:** `cloud-status-banner`-Komponente + Selector wiederverwenden; **neuer priorisierter Eintrag** `connect-offline` (hohe Priorität, unter `client-offline`): „Offline — nur Barzahlung, TSE-Ausfall wird protokolliert. Bestellungen werden bei Wiederverbindung übertragen." + Outbox-Zähler (`n ausstehend`).
- **Reconnect-Feedback:** Banner zeigt Replay-Fortschritt; bei `rejected`-Einträgen Operator-Hinweis.

---

## 9. Versionierung & Migration

- **IndexedDB-`version` + `onupgradeneeded`** über `CACHE_SCHEMA_VERSION` (Object-Store-Struktur/Indizes).
- **Meta-Store** mit `cacheBuildId` (App-Version + Schema-Hash). Mismatch beim Start → wipe + Voll-Bootstrap (verhindert Drift nach App-Update).
- **Re-Pairing / Tenant- oder Location-Wechsel:** `DeviceConfigService`-Change erkannt → alte namespaced DB löschen, neue Bootstrappen.
- **`device:deactivated` / `clearConfig()`:** alle Cache-DBs + Outbox löschen (kein Datenrest auf entkoppeltem Gerät).

---

## 10. Performance-/UX-Budgets

| Budget | Ziel | Einhaltung |
|---|---|---|
| App-Start bis Login interaktiv | < 2 s kalt | IDB-Hydration async, nicht blockierend |
| Katalog-Erst-Render | < 150 ms | Aus In-Memory-Mirror, IDB off-critical-path |
| Katalog-Navigation | 60 fps, kein Jank | Signals + `OnPush`, keine IDB-Reads im Klickpfad |
| Delta-Sync | Main-Thread frei | Chunked Upserts + `requestIdleCallback`; **Phase 6:** optional Web-Worker (idb läuft im Worker, via Comlink) wenn Profiling Jank zeigt |
| Speicher | IDB < 50 MB, Mirror < ~30 MB | Keine Bilder heute; nur Katalog-/Order-Daten |

**Lazy vs. Full:** Stammdaten **Full-Load in den Cache** (offline-Vollständigkeit nötig), aber **lazy in den Mirror/Render** (nur sichtbare Kategorien materialisieren).

---

## 11. Assets (Produktbilder)

Heute **kein** Bild-Feld auf `product` → **kein akutes Asset-Caching**. Vorausschauend: sobald `imageUrl`
eingeführt wird, Blobs in eigenem IndexedDB-Store (`product-images`) mit Größenbudget (z. B. < 20 MB, LRU-Evict),
Cache-on-demand beim ersten Online-Render. Als Stub dokumentieren, nicht jetzt bauen.

---

## 12. Domain-Logik teilen statt duplizieren

- **TypeBox-Schemas** der Domains (`@panary/orders/domain`, `products/domain`, …) für Cache-Validierung **wiederverwenden** — keine Parallel-Typen.
- **`@panary/sync/domain`**-Schemas (`SyncOp`, Outbox-Entry, Cursor, Backoff) als geteilte Typen/Konstanten nutzen; nur die **Engine** ist client-schlank neu.
- **`@panary/businessdays/aggregator`** für jede offline nötige Berechnung (deterministisch, kein I/O) — kein Re-Implementieren, kein Edge-Klon.

---

## 13. Teststrategie

- **Unit (Vitest):** Cache-Key/Namespace, Scope-Filter (Reuse `matchesRealtimeScope`), Delta-Merge (updatedAt-Grenze, Soft-Delete), Outbox-Backoff/FIFO, provisorischer Sequenz-Zähler.
- **Integration:** `fake-indexeddb` (Dev-Dependency) für IDB in Node; `ConnectionService` durch Signal-Toggle offline/online simulieren.
- **Offline-Simulation:** Socket-Disconnect → Reads aus Cache, Writes in Outbox; Reconnect → Replay → Orders in Cloud, **keine Duplikate** (Idempotenz-Check).
- **Konsistenz:** Delta-Cursor-Korrektheit; Voll-Bootstrap-Fallback bei `cacheBuildId`-Bump; Tenant-Isolation (scope-fremder Record wird nie gelesen/geschrieben).
- **E2E (Playwright/Preview):** Offline-Katalog-Navigation, Bar-Bestellung offline anlegen, reconnect, Erscheinen in Cloud + Banner-Verlauf.

---

## 14. Risiken & offene Punkte

1. **Offline-Staff-PIN — ENTSCHIEDEN (Option A):** Geräte-Session bleibt offline gültig; **Benutzerwechsel/Staff-Logout offline gesperrt** (UI-Guard auf der Wechsel-Aktion — die Geräte-Socket-Session ist ohnehin geschützt: `socketLogout()` ignoriert Device-Mode). Optionale Ausbaustufe B (kurzlebiger lokaler Hash nur für heute angemeldete Mitarbeiter) später. Umsetzung in Phase 5.
2. **Belegnummer-Reconcile — ENTSCHIEDEN (Cloud autoritativ), Implementierung erforderlich:** Schema-Feld `offlineSequence: boolean` in `@panary/orders/domain` (panary-core) + Ingest-Re-Stamp in `api-cloud` (panary-cloud). Klein und gut abgrenzbar, aber **cross-repo** → eigener abgestimmter Schritt in Phase 5/6.
3. **Geschäftstag offline — ENTSCHIEDEN (Option A):** offline nur innerhalb offenen Tags; Eröffnung/Abschluss online. „Kaltstart ohne Netz" als akzeptierte Einschränkung dokumentiert. Keine Implementierung nötig — reine Annahme + UI-Hinweis, wenn kein offener Tag vorliegt.
4. **Socket.IO-Buffering:** disconnected-Emits puffert socket.io → Doppel-Sends möglich. Explizites Offline-Kurzschließen + Outbox als einzige Replay-Quelle; Socket-Buffer ignorieren.
5. **Storage-Eviction:** IndexedDB unter Druck evictbar → `navigator.storage.persist()`.
6. **Tische/Bereiche-Service:** `order.table` ist freies String-Feld — Service-Pfad verifizieren, ob überhaupt zu cachen.
7. **Konflikt bei Stammdaten-Patch offline:** Single-Device erzeugt v. a. neue Orders; LWW (Cloud gewinnt) für Stammdaten ausreichend, aber dokumentieren.

---

## 15. Schrittweiser Umsetzungsplan

> Jede Phase endet mit Pflicht-Commit (CLAUDE.md Git-Disziplin) + Doku bei Doku-Trigger. `nx lint` + `nx test` je betroffenem Projekt; bei Domain-Import zusätzlich `nx build`.

- **Phase 0 — Setup:** `idb` (+ `fake-indexeddb` dev) via `pnpm add -w` (Consent vorhanden); ADR `documentation/offline-cache-architecture.md` + INDEX-Eintrag anlegen.
- **Phase 1 — Storage-Fundament:** Lib `@panary/shared/offline-cache`; `CACHE_STORAGE_PORT` + `IdbStorageAdapter`; Namespacing, Meta/`cacheBuildId`, `persist()`, Wipe-on-Repair. Unit-Tests mit `fake-indexeddb`.
- **Phase 2 — Read-Pfad:** `BaseService` cache-bewusst (optional injizierter Store + `cachePolicy`-Flag); In-Memory-Hydration; Cache-first/SWR (master-data) + network-first/fallback (orders); Reuse `matchesRealtimeScope`. POS-Provider verdrahten; Admin unverändert.
- **Phase 3 — Freshness:** `CatalogSyncService` (Bootstrap + Delta-Cursor pro Service), Trigger via `connectionState`-`effect()` + `untracked()`. Cursor-Store.
- **Phase 4 — Write-Pfad:** `OutboxStore` + `OutboxReplayService` (uuidv7, idempotent, FIFO, Backoff, Klassifikation); optimistisches Order-Anlegen + Mirror-Merge.
- **Phase 5 — Offline-UX:** `OfflineStatusService` (Connect-Offline-Erkennung); Banner-Eintrag `connect-offline` + Outbox-Zähler; Bargeld-Zwang; TSE-Ausfallvermerk; provisorische `dailySequenceNumber`.
- **Phase 6 — Hardening:** Performance-Profiling + optional Web-Worker; Asset-Caching-Stub; Reconcile-Kontrakt `api-cloud` (Belegnummer) abstimmen; Doku finalisieren.

---

## 16. Verifikation (End-to-End)

1. `nx lint @panary/shared/offline-cache && nx test @panary/shared/offline-cache` (+ betroffene Domain-Data-Access-Projekte); bei Domain-Imports `nx build`.
2. **Offline-Simulation (Preview/DevTools):** `pos-client` starten, einloggen, Netz trennen (Socket-Disconnect). Erwartet: Katalog navigierbar, Banner `connect-offline`, Karten-Button disabled.
3. Bar-Bestellung offline anlegen → erscheint sofort (optimistisch), Bon mit TSE-Ausfallvermerk, Outbox-Zähler steigt.
4. Netz wiederherstellen → Replay läuft, Order in Cloud sichtbar, **keine Duplikate**, Banner zurück auf normal, provisorische Sequenz re-gestampt.
5. Delta-Konsistenz: online Produkt in Cloud ändern → nach Reconnect via `updatedAt`-Delta im POS-Katalog aktualisiert, ohne Voll-Reload.
6. Re-Pairing/Tenant-Wechsel → alte Cache-DB verworfen, frischer Bootstrap, kein scope-fremder Datensatz.
