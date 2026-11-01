---
type: Report
title: 'KDS — Codebase-Befund (S2, PNRY-FEAT-KDS-001)'
description: 'Ist-Stand von panary-core und panary-cloud für ein Kitchen Display System: was vorhanden, teilweise oder fehlend ist, mit Belegen; Hypothesen zu AP1–AP5.'
tags: [kds, discovery, orders, edge, realtime, devices]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-01T00:00:00Z }
---

# KDS — Codebase-Befund (S2)

Stand: `main` beider Repos am 2026-11-01. Pfade ohne Präfix gelten in `panary-core/`, `cloud:` meint `panary-cloud/`.
**Belegt** heißt: gelesen bzw. per Grep bestätigt. **Hypothese** heißt: Schluss daraus, noch nicht entschieden.
Ablage vorläufig als Entwurf. Endgültig nach `docs/` des Repos, das G2 bestimmt, über einen Worktree.

## 1. Kurzfazit

1. **Ein KDS war schon angelegt und wurde nie gebaut.** Den Gerätetyp `kds`, die Rolle `DEVICE_KDS` mit Rechten, die Auswahl im Setup und im Admin, die Gerätezählung im Heartbeat und den Order-Status `production` gibt es. Eine KDS-Ansicht, Positions-Status, Stationen und Routing gibt es nicht. **Niemand setzt `production`.**
2. **Echtzeit für einen zweiten Client existiert an beiden Enden.** Edge und Cloud nutzen Feathers mit Socket.IO und einem Handshake per API-Key und `deviceId`. Ein gekoppeltes KDS-Gerät bekäme Order-Events heute schon. Es gibt **kein Replay und kein Ack**, verpasste Events fängt nur ein Neuladen auf.
3. **„Order Event Channel (Inbox/Ack/Replay)" existiert nicht.** Das Nächstliegende sind die Sync-Outbox Edge→Cloud, der Cursor-Pull und die geparkten Force-Sync-Trigger (cloud ADR 0029). Für Orders an Geräte gibt es das nicht.
4. **Zwei Entscheidungen im Bestand stehen dem Zielbild entgegen:**
   - ADR 0045 hat Stations-Routing für den **Druck** ausdrücklich verworfen.
   - Der Tarifkatalog bindet **Gerät koppeln** und **Print/KDS** an `offlinePos`, also Operate+. Connect kann heute kein Gerät koppeln (G3).
5. **Die Cloud ist Single-Instance** und hat keinen Socket.IO-Adapter. Lastmessungen für Sockets gibt es nicht. Cloud-direktes KDS für Connect ist deshalb vor allem eine Kapazitäts- und Betriebsfrage.
6. **Das Wartezeit-Problem ist im Code sichtbar.** `estimatedDuration` stammt aus einer Kachelauswahl an der Kasse, also einer von Hand gewählten Zahl. Das Produktfeld `productionTime` gibt es, gelesen wird es nur in auskommentiertem Import-Code.
7. **Go gibt es nicht im Stack.** Edge ist `apps/api-edge` (Feathers/SQLite), `tse-gateway` ist Node/TS. Rust gibt es nur in der **Tauri-Hülle des POS-Clients** (MQTT-Publish per `rumqttc`, ADR 0036). Der MQTT-Broker im Edge-Deployment (ADR 0018) ist Fremdsoftware. **Einen eigenen Serverprozess in einer zweiten Sprache gibt es am Edge nicht.** *(Korrigiert in S3. Die erste Fassung nannte fälschlich einen Rust-Prozess am Edge.)*

## 2. Ist-Stand-Tabelle

| Baustein | Stand | Kernbeleg |
|---|---|---|
| Gerätetyp KDS | vorhanden | `libs/domains/devices/domain/src/lib/device.schema.ts:8-13` |
| Rolle `DEVICE_KDS` (orders R/U, products R, print C) | vorhanden | `libs/domains/users/domain/src/lib/roles.matrix.ts:1027-1040` |
| KDS wählbar in Setup / Admin | vorhanden | `libs/domains/system/feature-pos-setup/src/lib/setup.component.ts:98,122`; cloud: `libs/domains/settings/feature-admin/src/lib/devices/new-device-dialog.component.ts:67-70` |
| KDS-Ansicht / Route | **fehlt** | Shell-Routen `libs/apps/pos-client/shell/src/lib/app.routes.ts` (dashboard, kasse, orders/*, settings, working-times, pre-orders) |
| Order-Status für Küche | teilweise (Enum ja, Nutzung nein) | `libs/domains/orders/domain/src/lib/order.schema.ts:11-34`; kein Code setzt `production`/`produced` |
| Positions-Status | **fehlt**, `lineItems` gesperrt | `order.schema.ts:322-330` (Patch-Sperre, Rechtsgutachten zu panary/panary-core#345) |
| Station / Routing Item→Station | **fehlt**, für Druck verworfen | `docs/adr/0045-druckerrollen-statt-stations-routing.md:74-87,160` |
| Zeitfelder | teilweise | Produkt `productionTime` `product.schema.ts:161` (ungenutzt); Order `estimatedDuration`, `remainingTime`, `targetCompletionAt` `order.schema.ts:400-402` |
| Echtzeit Edge | vorhanden | `apps/api-edge/src/channels.ts:55-90` (Handshake), `:239-257` (Publish nur nach Tenant) |
| Echtzeit Cloud | vorhanden | cloud: `apps/api-cloud/src/channels.ts:313-353` (Geräte-Join), `:700-732` (Publisher mit Rechtefilter) |
| Replay / Ack für Geräte | **fehlt** | keine Fundstelle; Sync-Cursor als Vorlage: cloud `services/sync/sync.ts:935-958` |
| Sync Edge→Cloud für Orders | vorhanden | Outbox-Hook `apps/api-edge/src/app.ts:371,385`, `hooks/sync-outbox-recorder.hook.ts:20-22` |
| Edge-Discovery | vorhanden | mDNS `apps/api-edge/src/mdns-advertiser.ts`, Client `libs/shared/data-access-config/src/lib/services/hub-discovery.service.ts` |
| Device-Pairing Edge / Cloud | vorhanden | `apps/api-edge/src/device-pairing.ts:17-30`; cloud `apps/api-cloud/src/device-pairing.ts` |
| Attestation `self/certified/managed` | **fehlt** | keine Fundstelle für Geräte; Re-Verifikation und Schlüsselrotation: ADR 0042/0043 |
| Feature-Flags | cloud vorhanden, core **fehlt** | cloud ADR 0024 („Nicht-Ziel v1: POS/Edge"); `apps/admin-client/src/app/layout/admin-layout.ts:37` |
| Tarif-Gate für KDS | teilweise (kein eigener Key) | `libs/domains/tenants/domain/src/lib/subscription-plan.schema.ts:190-218`; cloud `docs/domains/freemium-basic-tier-plan.md:33-37` |
| Schema-Export core→cloud | vorhanden | `nx.json:112-120` (Tag `publishable`, fixed), `.github/workflows/publish-libraries.yml`; cloud `package.json:139-177` (`^26.11.3`) |
| Hüllen: Tauri / Android / Browser | vorhanden / vorhanden / unbelegt | `apps/pos-client/src-tauri`, `apps/pos-client/android` + `capacitor.config.ts` (ADR 0057) |
| Nx-Modulgrenzen | core offen, cloud geregelt | core `eslint.config.mjs:26-31` (`* → *`); cloud `eslint.config.mjs:58-100` |
| C4 im Repo | cloud vorhanden (LikeC4), core fehlt | cloud `docs/architecture/c4/{model,views}/*.c4`, ADR 0028/0085 |

## 3. Befunde im Einzelnen

### 3.1 Order-Modell und Status-Maschine

- **Positionen:** `lineItems` mit `_id`, `externalId` (Produkt), `amount`, `name`, `price`, `parentId`, `topic` (Warengruppe), `acronym`, `productGroupExternalId`, `bundleNumber`, `modifiers[]`, `components[]` (`order.schema.ts:148-254`, `:382`). Ein Notizfeld je Position wurde nicht gefunden.
- **`lineItems` sind unveränderlich.** Der `orderPatchResolver` sperrt sie still, eine Vorgabe des Rechtsgutachtens zum Split (`order.schema.ts:322-330`). Ein Küchenzustand je Position **kann nicht** an `lineItems` hängen.
- **Status-Guard:** Er sperrt nur Rücksprünge aus `completed` und `aborted`, Vorwärtssprünge sind frei (`libs/domains/orders/domain/src/lib/order-state-machine.ts:4-6,34-52`; Edge `apps/api-edge/src/services/orders/orders.ts:205`).
- **Wer setzt welchen Status:** `active` ist Default. `completed` setzt das Frontend und toggelt dabei zwischen `active` und `completed` (`order.service.ts:553,641,659`). `production` und `produced` setzt niemand.
- **Folgen von `production` heute:**
  - Es zählt in den Abrechnungsumfang (`libs/domains/orders/domain/src/lib/settlement-scope.ts:82-83`).
  - Die Lagerbuchung hängt an `→ produced` (Kommentar `order.schema.ts:24-27`).
  - Die Kasse rendert bei `production` den Stempel **„storniert"** (`libs/domains/orders/feature-pos-active/src/lib/active-orders.component.html:344`). Das widerspricht dem Schema-Kommentar und ist ein eigener Bug-Kandidat.
- **Folgerung (belegt):** Der Order-Status ist schon mit Fiskal-, Abrechnungs- und Lagerwirkung verdrahtet. Küchen-Feinzustände dort hinein zu legen, hieße fiskalisch relevante Datensätze bei jedem Bump zu patchen und zu synchronisieren.

### 3.2 Echtzeit und Ereignisfluss

| | Edge | Cloud |
|---|---|---|
| Transport | Feathers + Socket.IO, Port 3030 | Feathers + Socket.IO auf `/ws` (cloud `app.ts:231-233`) |
| Geräte-Auth | `apiKey` + `deviceId` im Handshake, Connection trägt `tenantId/locationId/deviceId/deviceRole` | dito, virtueller User `device:<id>`, Rolle aus API-Key (cloud `apikeys.schema.ts:63-68`) |
| Scoping | nur Tenant, bewusst ohne Location und ohne Rolle (`channels.ts:239-257`) | Tenant- bzw. Location-Channel plus Filter `canReadPath(role)` (cloud `channels.ts:700-732`); KDS-Matrix geprüft in `channels-read-matrix.spec.ts:102-110` |
| Order-Events an KDS | ja, alle `orders`-Events des Tenants | ja, soweit die Rolle lesen darf |
| Replay / Ack | fehlt | fehlt; nur Force-Sync-Trigger werden geparkt (ADR 0029) |
| Instanzen | 1 je Filiale | **1 gesamt**, kein Socket.IO-Adapter (cloud ADR 0033:29, `lib/user-activity.ts:149`) |

- **Sync:**
  - Der Edge schreibt für `orders`, `order-interactions`, `working-times` und `audit-events` per globalem after-Hook in eine Outbox.
  - Push geht in Batches bis 100 (`libs/domains/sync/domain/src/lib/sync-push.schema.ts:6`) als idempotenter Upsert (cloud `sync.ts:279-326`).
  - Cloud→Edge läuft nur als Trigger (`edge-events`), die Daten holt der Edge per Cursor-Pull.
- **Relevante Fallen:**
  - `serviceEvents: []` ist der eigentliche Schalter gegen Event-Lecks (cloud `docs/security/sync-service-event-leak.md`).
  - Die Publish-Sperrlisten in cloud `channels-publisher.ts:46-120` nennen „jedes POS-/KDS-Gerät" ausdrücklich als Mithörer.
- **Last (Hypothese, nicht gemessen):**
  - Jedes KDS ist ein dauerhaftes Mitglied des Tenant-Channels. Pro Event läuft der Rechtefilter über alle Verbindungen des Tenants.
  - Connect/Disconnect stempelt `devices.lastSeen` per Mongo-Patch (cloud `channels.ts:99-120`), Reconnect-Stürme erzeugen also Schreiblast.
  - Die Online-Zählung liest `app.io.sockets` des eigenen Prozesses. Ein Scale-out bricht sie.

### 3.3 Geräte, Pairing, Clients

- **Edge erreichen:** mDNS `_panary._tcp`, vor dem Pairing `http://localhost:3030` (`apps/pos-client/src/app/edge-url.ts:5`), danach `serverUrl` aus der Gerätekonfiguration.
- **Pairing:**
  - Am Edge ein 6-stelliger Kurzcode.
  - In der Cloud ein Code mit 10 Minuten TTL, nur einmal einlösbar.
  - In der Cloud gilt fail-closed **`offlinePos === true`**, sonst 403 „Geräte koppeln erfordert den Operate-Tarif" (cloud `apps/api-cloud/src/device-pairing.ts:199-223`, `services/devices/devices.ts:81-86`).
- **Weitere Geräte-Merkmale:**
  - `DeviceAccessMode` (`shared`/`assigned`, ADR 0023) regelt, wer sich anmelden darf.
  - `DeviceOrderChannel` (`pos`/`telephone`) ist die Standard-Bestellart je Terminal.
  - Einen Rollen- oder Modus-Wechsel der App nach Gerätetyp gibt es nicht.
- **Attestation `self/certified/managed`:** Kein Gerätekonzept. `CERTIFIED` gibt es nur am Tenant (SOC2, `tenant.enums.ts:147-151`) und `PROVENANCE_VERIFIED` an Edge-Images. Vorhanden sind Schlüsselrotation (ADR 0042) und Re-Verifikation nach Offline-Phase (ADR 0043).
- **Bedienertoken am cloud-direkten POS:** cloud ADR 0094, umgesetzt am 2026-10-30. Die Auswertung in Orders und Storno steht laut Frontmatter noch aus.

### 3.4 Produktstammdaten, Zeiten, Druck-Routing

- **Produkttypen:** `productType` PRODUCT/BUNDLE/MODIFIER/SERVICE (`product.schema.ts:117-123`).
  - Kategorien laufen über `categoryIds`.
  - `acronym` ist als Kurzname für den Küchenbon gedacht (`:106`).
  - Ein Stationsfeld gibt es nicht.
- **`productionTime`** steht im Produktschema (`:161`) und in der Edge-Migration (`apps/api-edge/migrations/20260219000005_products.ts:35`). Ausgewertet wird es nirgends, der Import ist auskommentiert (`libs/domains/products/data-access/src/lib/services/product.service.ts:201`).
- **`estimatedDuration` an der Order** kommt aus der Kachelauswahl im Bestelldialog (`apps/api-edge/src/print-server/order-receipt.renderer.ts:394-406`, `libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.ts:314-315,689`).
  - Der Bon druckt `recordingDate + estimatedDuration`.
  - Die Liste aktiver Bestellungen markiert damit Verspätung (`active-orders.component.ts:763-766`).
  - **Das ist genau der Punkt, an dem eine Prognose die von Hand gewählte Zahl ersetzen würde.**
- **Druck:**
  - Die Druckerrolle `kitchen|receipt|both` je Filialdrucker (`libs/domains/locations/domain/src/lib/location.schema.ts:112-138`) bestimmt die Bon-Variante.
  - Jeder Drucker bekommt den ganzen Bon (`apps/api-edge/src/print-server/print-job.builder.ts:42-44,144`).
  - ADR 0045 verwirft „Warengruppe→Drucker", weil der Unterschied Küchenbon vs. Quittung „nicht im Sortiment" liege.
  - **Einordnung (Hypothese):** Das Argument trifft die Trennung von Bon und Quittung, nicht die Zuordnung von Positionen zu Stationen. Ein KDS-Routing widerspricht ADR 0045 also nicht in der Sache, muss sich aber ausdrücklich davon abgrenzen. Die Pflegeaufwand-Kritik aus dem ADR (`:84-85`) gilt auch fürs KDS: leere Zuordnung, neues Sortiment.

### 3.5 Tarife und Flags

- **Plan-Feature-Keys** (`subscription-plan.schema.ts:190-218`): `onlineOrdering`, `offlinePos`, `fiscalCashier`, `physicalPrintServer`, `aiExtraction`, `fraudAnalytics`, `multiLocationConsolidation`. Einen KDS-Key gibt es nicht.
- **Beschreibung von Operate:** „physischer Druck/KDS" (`:206`). Die cloud-Matrix ordnet „Offline-Kasse + Print/KDS + Z-Bon" und „Gerät koppeln" `offlinePos` zu. „Cloud-POS / Online-Bons" läuft für Connect über `onlineOrdering`.
- **Feature-Flags** (cloud ADR 0024, CLAUDE.md „Feature Flag Considerations"):
  - Namen in camelCase ohne Abkürzung. `kds-v1` wäre also nicht regelkonform, eher z. B. `kitchenDisplay`.
  - Defaults: `defaultEnabled: false`, Ablauf nach 3 Monaten.
  - Scope ist Tenant oder Prozentsatz, **ausdrücklich nicht Plan oder Location**.
  - **Auswertung auf Edge oder POS ist kein Ziel von v1.** Ein KDS am Edge kann heute kein Flag abfragen.

### 3.6 Repo-Struktur, Export, Konventionen

- **Export:** core veröffentlicht 41 `publishable`-Libs fix versioniert per `v*`-Tag nach GitHub Packages (ADR 0002). cloud pinnt alle auf `^26.11.3`. Schemaänderungen brauchen ein core-Release und einen cloud-Pin-Bump (cloud ADR 0018).
- **Nx-Struktur:** Layout `libs/domains/<d>/{domain,data-access,feature-*}` in beiden Repos. In core sind die Modulgrenzen faktisch offen (`* → *`), Isolation läuft dort über Konvention. `CODEOWNERS` enthält nur `* @michaelratke`.
- **ADR-Format** in beiden Repos:
  - Frontmatter `type: ADR`, `title`, `description`, `tags`, `status`, `decision`, `implementation`, `generated`.
  - Gliederung Problem → Entscheidung → Konsequenzen.
  - Index wird generiert.
  - Nummer vor dem Anlegen mit `pnpm docs:adr:next` ermitteln.
- **Diagramme:** cloud nutzt **LikeC4** (`docs/architecture/c4/model/{edge,pos,sync,cloud}.c4`). `actors.c4:2` lässt Geräterollen bewusst weg. Mermaid wird praktisch nicht genutzt, ASCII-Diagramme sind verbreitet.
  - **Hypothese für S4:** C4 als LikeC4 im bestehenden cloud-Modell erweitern, statt Mermaid-C4 daneben zu stellen. Sequenz- und Zustandsdiagramme in Mermaid.
- **Präzedenz für einen eigenen Prozess:**
  - `apps/tse-gateway`: Node-HTTP, Port 3040, eigenes Dockerfile, aber nicht in `docker-compose.edge*.yml` eingebunden.
  - Rust nur clientseitig in der Tauri-Hülle (ADR 0036). Der MQTT-Broker im Edge-Compose ist Fremdsoftware (ADR 0018), also kein Präzedenzfall für eigenen Servercode.
  - Das Edge-Image entsteht aus `tools/docker/Dockerfile.edge`.

## 4. Widersprüche und Funde außerhalb des KDS

| # | Fund | Wirkung |
|---|---|---|
| F1 | Die Kasse zeigt bei `production` „storniert" (`active-orders.component.html:344`) | Sobald irgendwer `production` setzt, sieht die Kasse falsche Stornos. Bug-Issue: panary/panary-core#1264 |
| F2 | Connect bekommt laut Matrix „Cloud-POS", kann aber kein Gerät koppeln (cloud `device-pairing.ts:199-223`) | G3 ist ohne Tarifänderung nicht umsetzbar |
| F3 | „Print/KDS" hängt an `offlinePos`, ein eigener Key fehlt | Tarifzuordnung für KDS braucht einen neuen Feature-Key oder eine bewusste Bindung |
| F4 | Feature-Flags erreichen weder Edge noch POS (cloud ADR 0024 Nicht-Ziel) | Die Flag-Pflicht fürs KDS am Edge braucht erst den Erweiterungspfad §15 |
| F5 | `productionTime` am Produkt ist unbenutzt | Kann als konfigurierter Rückfallwert dienen, schon synchronisiert |

## 5. Hypothesen zu AP1–AP5 (nicht entschieden, Grundlage für S3)

- **AP1 Topologie:**
  - Beide Server haben schon Geräte-Sockets, Rollen und Order-Events. **B** (modularer Monolith: `libs/domains/kitchen/*` in derselben API) ist der kürzeste Weg.
  - **C / C'** (eigener Prozess) hätte als Vorbild nur tse-gateway, und das ist nicht eingebunden. Damit kämen ein Image, ein Port und ein Discovery-Ziel mehr dazu.
  - Für die Go-Bewertung ist der Vergleichsmaßstab Node/TS gegen Go (Rust gibt es nur clientseitig in der Tauri-Hülle).
  - Eine ehrliche Vorab-These: Ein Scheduler mit Dutzenden Tickets je Filiale ist kein CPU-Problem. Vorteile von Go lägen bei Speicherbedarf, Einzel-Binary und Robustheit des Prozesses, nicht beim Durchsatz.
- **AP2 Repo / Edge-Cloud:**
  - Entitäten und Basis-KDS müssen in **core** liegen, weil der Edge sie braucht und cloud sie per Export bekommt.
  - Cloud-direkt für Connect scheitert heute an F2, dem fehlenden Socket-Scale-out und dem fehlenden Replay.
  - Für den Piloten (Operate mit Edge) gibt es keinen dieser Blocker.
- **AP3 Domänenmodell:** Die **eigene Projektion** ist praktisch erzwungen.
  - `lineItems` sind gesperrt.
  - Der Order-Status trägt Abrechnung und Lager.
  - Bumps würden sonst fiskalische Orders patchen und synchronisieren.
  - `KitchenItem` referenziert `order._id` und `lineItem._id`. Ob `production` und `produced` am Order-Kopf als grobe Spiegelung gesetzt werden, ist eine eigene Teilfrage (F1 beachten).
- **AP4 Smart-Scheduling:**
  - Ausgangsdaten gibt es nicht, es gibt keine Start- oder Fertig-Zeitstempel.
  - Konfigurierte Rückfallwerte gibt es teilweise (`productionTime`).
  - Der Rückkanal hat einen klaren Andockpunkt: `estimatedDuration` und die Kachelauswahl im Bestelldialog sowie der Bon-Renderer.
- **AP5 Client:**
  - Alle drei Hardware-Wege (Sunmi/Android, Tauri, Browser) hängen an **einer** Angular-App, die Hüllen gibt es schon.
  - Gerätetyp und Rolle kommen schon aus dem Pairing.
  - Es fehlt nur das Routing der Shell nach `DeviceType`. Das spricht für **gleiche App mit Geräterolle** (G7).
  - Unbelegt ist, ob der pos-client ohne Hülle im Browser vollständig läuft.

## 6. Für S3 noch zu messen oder zu lesen

- **Last der Echtzeitkanäle in der Cloud:**
  - Verbindungen und Events je Sekunde einer Wegwerf-Instanz unter N simulierten KDS-Geräten.
  - Speicher je Socket.
  - Wirkung von `lastSeen`-Stempeln bei Reconnect.
  - Heute gibt es keine einzige Messung.
- **Go-Bewertung:** Kriterien und Kosten gegen Node/TS. Rust in der Tauri-Hülle (ADR 0036) ist nur ein clientseitiger Erfahrungswert.
- **Nicht gelesen:**
  - cloud ADR 0018 (Schema-Release)
  - core ADR 0006 (Tarifmodell)
  - der Hook `order-stock-update`
  - cloud `feature-flag-evaluations` und Erweiterungspfad §15 von ADR 0024
  - der Positionsaufbau im Bon-Renderer
- **Nicht geprüft:** Browser-Lauffähigkeit des pos-client ohne Hülle; Instanzzahl von api-cloud in der Coolify-UI (nur aus Doku belegt).
- **Kurze Web-Recherche:** Fire by Prep Time, Dual Bump, Item-Routing bei den genannten Anbietern.
