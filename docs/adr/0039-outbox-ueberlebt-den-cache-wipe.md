---
type: ADR
title: 'Die Offline-Outbox überlebt den Cache-Wipe'
description: 'Der Build-Mismatch-Wipe leert die fachlichen Stores selektiv statt die Datenbank zu verwerfen — nicht regenerierbare Outbox-Einträge überleben App- und Schema-Update.'
tags: [offline-cache, orders, pos, devices, sync]
status: stable
decision: accepted
implementation: 'umgesetzt in panary/panary-core#322'
generated: { by: claude-code/opus-5, at: 2026-09-16T09:45:00Z }
---

# Die Offline-Outbox überlebt den Cache-Wipe

Präzisiert die Wipe-Regel aus [ADR 0008](0008-offline-cache-architecture.md) („Mismatch beim
Öffnen ⇒ Wipe + Voll-Bootstrap"). Die Regel bleibt — sie gilt ab jetzt nur nicht mehr für
Daten, die der Server nicht zurückliefern kann.

## Problem

`openCacheDatabase` verwarf bei einer abweichenden `buildId` die **gesamte**
IndexedDB-Datenbank (`port.destroy(databaseName)`). Das war für den Cache gedacht: Stammdaten
sind jederzeit nachladbar, eine feingranulare Migration wäre teurer als ein Voll-Bootstrap.

Der Outbox-Store liegt aber in genau dieser Datenbank — als interner Store `__outbox`, seit
jeher zusammen mit `__cache_meta` und `__cursors` in `withMetaStore()` angelegt. Sein Inhalt
sind **offline erzeugte Bestellungen**, die noch niemand außer diesem Gerät kennt. Der Server
kann sie nicht zurückliefern; sie sind das genaue Gegenteil von regenerierbar.

Drei Eigenschaften machten daraus einen stillen Umsatzverlust:

1. **Die `buildId` ist `appVersion#schemaVersion`.** Sie ändert sich bei **jedem** App-Update,
   nicht erst bei einer Schema-Änderung.
2. **Der Tauri-Auto-Updater stößt das Update selbst an.** Es braucht keine Handlung des
   Personals, und es gibt keinen Moment, in dem jemand „erst noch synchronisieren" könnte.
3. **Es gab keine Spur.** `cache-bootstrap.ts` loggte den Wipe nicht, schon gar nicht mit
   Zähler. Ob in der Vergangenheit real Umsätze verloren gingen, ist deshalb nicht messbar —
   der Verlust hinterlässt per Definition nichts.

Ein zweiter, unabhängiger Wipe-Pfad lag im `IdbStorageAdapter`: Sein `upgrade`-Callback löschte
bei jedem IndexedDB-Versionssprung **alle** Object-Stores und legte sie neu an. Auch dort fiel
die Outbox mit. Ein Fix nur an `openCacheDatabase` hätte den Fall „Schema-Bump" offen gelassen —
also genau den, den der Verifikationsschritt des Issues prüft.

Verschärfend: Ein Gerät mit abgelehntem Handshake kann sich nicht mehr entkoppeln (der
Unpair-Dialog verifiziert die PIN über den Socket). Der Ausweg aus einem ausgesperrten Terminal
ist Neuaufsetzen — und `unpair()` löschte alle IndexedDB-Datenbanken ohne Rückfrage, obwohl der
`pendingCount()` in der Settings-Komponente daneben lag.

## Entscheidung

**1. Der Build-Mismatch leert selektiv statt zu zerstören.** `openCacheDatabase` ruft kein
`port.destroy()` mehr, sondern leert jeden Store aus `port.storeNames()`, der nicht in
`CACHE_STORES_PRESERVED_ON_WIPE` steht. Erhalten bleiben `__outbox` (nicht regenerierbar) und
`__cache_meta` (wird direkt danach überschrieben).

Gelesen wird aus `storeNames()`, nicht aus dem Schema: Sonst bliebe ein aus dem Schema
entfernter, physisch noch vorhandener Store mit Altbestand stehen.

**2. `__cursors` wird bewusst mitgeleert.** Die Delta-Cursor gehören zum Cache-Inhalt. Bliebe
ein `lastPullAt` stehen, während die fachlichen Stores leer sind, zöge der Delta-Sync nur noch
Deltas seit diesem Zeitpunkt nach — der Cache bliebe dauerhaft unvollständig. Das tauschte
stillen Datenverlust gegen stille Unvollständigkeit, also einen sichtbaren Fehler gegen einen
unsichtbaren.

**3. `preserveOnUpgrade` schließt den Adapter-Pfad.** Ein Store mit diesem Flag wird beim
Versionssprung übernommen statt verworfen; fehlende Indizes zieht der Adapter nach, überzählige
entfernt er. Ohne den Index-Abgleich bekäme ein übernommener Store einen später ergänzten Index
nie, und `getAllByIndex` schlüge zur Laufzeit fehl — im POS gefangen vom try/catch der
Cache-Init, also wieder still.

**4. Der Fehlerfall propagiert.** Schlägt das Leeren fehl, wirft `openCacheDatabase`. Der POS
lässt den Cache dann inaktiv (er läuft online normal weiter) und die Outbox bleibt auf der
Platte; der nächste Start versucht es erneut. Ein Rückfall auf `destroy()` wäre genau der
Verlust, den diese Entscheidung verhindert.

**5. Veraltete Payloads werden abgelehnt, nicht verworfen.** Ein Eintrag, der ein Schema-Update
überlebt, kann ein Payload-Format tragen, das der Server nicht mehr annimmt. Das bestehende
Replay-Verhalten ist dafür bereits richtig und bleibt unverändert: `classifyOutboxError` stuft
400/401/403/422 als `terminal` ein, `PosOutboxReplayService` markiert den Eintrag als
`rejected`. Er ist damit **sichtbar** (Operator-Sicht in den Geräte-Einstellungen) und manuell
heilbar (`requeueRejected()` nach einem Fix, `clearRejected()` als bewusstes Verwerfen). Ein
Eintrag zu einem Service, den der Client nicht mehr kennt, läuft über `#targetFor() === null` in
denselben Zustand.

Bewusst **nicht** gebaut: eine Payload-Migration über Schemagrenzen. Sie bräuchte eine
versionierte Payload-Historie im Client und träfe einen Fall, der bisher nie eintrat. Die
Ablehnung ist die ehrlichere Antwort — sie zeigt dem Betreiber, welcher Eintrag klemmt, statt
ihn im Hintergrund umzuschreiben.

**6. Entkoppeln fragt bei ausstehenden Einträgen zweimal.** Der Unpair-Dialog schiebt bei
`pendingCount() > 0` einen Schritt mit der Anzahl und einem Abbruch-Weg ein. Bei leerer Outbox
bleibt der Ablauf unverändert: Eine Rückfrage, die immer kommt, wird weggeklickt wie jede
andere.

Die Prüfung sitzt **im Dialog, nicht im Service**. `DeviceConfigService` liegt in
`shared/data-access-config`; der `OFFLINE_OUTBOX`-Token in `shared/data-access`, das seinerseits
von `data-access-config` abhängt — die Gegenrichtung wäre ein Zyklus. Den Token nach
`shared-common` zu verschieben scheidet aus: Das Paket ist bewusst Angular-frei (published, nur
`tslib`), ein `InjectionToken` zöge `@angular/core` hinein. `unpair(options)` nimmt die Anzahl
stattdessen entgegen und protokolliert sie.

## Konsequenzen

- **`CacheStoragePort` wächst um `storeNames()`** und `CacheStoreDefinition` um
  `preserveOnUpgrade`. Ein späterer SQLite-Adapter (ADR 0008) muss beides mitbringen; beides ist
  dort trivial (Tabellenliste, Tabelle beim Migrieren stehen lassen).
- **`OpenCacheResult` trägt `preservedOutboxCount`.** Der POS-Provider loggt nach jedem Wipe eine
  Zeile mit der Zahl. Sie landet im Log-Export und ist der einzige Beleg, dass Einträge den Wipe
  überstanden haben — bisher war weder Verlust noch Rettung nachweisbar.
- **`UnpairResult` trägt `databasesDeleted`,** `unpair()` nimmt `UnpairOptions`. Bestehende
  Aufrufer bleiben gültig (Parameter optional).
- **Ein `preserveOnUpgrade`-Store trägt Daten über Schemagrenzen.** Das ist der Preis: Genau
  diese Struktur muss künftig abwärtskompatibel bleiben oder ihre Alt-Einträge beim Replay
  sauber ablehnen (Punkt 5). Für `OutboxEntry` heißt das konkret: Felder ergänzen ja, Felder
  umdeuten nein.
- **Bereits verlorene Einträge sind nicht rekonstruierbar.** Der Fix wirkt nur nach vorn.
- **Der manuelle Testfall gehört dazu.** Die
  [Smoke-Test-Anleitung](../guides/offline-cache-smoke-test.md) führt ihn als Abschnitt 11
  (App-Update mit gefüllter Outbox) und 12 (Entkoppeln mit ausstehenden Einträgen) — beide
  brauchen eine offline entstandene Outbox und sind deshalb von keiner CI zu ersetzen.
- **Nicht abgedeckt:** Ein Geräte-Wipe durch das Betriebssystem (Neuinstallation, gelöschtes
  Nutzerprofil, Eviction unter Storage-Druck trotz `requestPersistentStorage()`) bleibt
  außerhalb unserer Kontrolle. Und der Test auf leerer Datenbank zeigt den Fehler gar nicht — er
  braucht eine **gefüllte** Outbox, die nur offline entsteht.

## Betroffene Pfade

| Datei | Änderung |
|---|---|
| `libs/shared/offline-cache/src/lib/cache-bootstrap.ts` | selektives Leeren, `CACHE_STORES_PRESERVED_ON_WIPE`, `preservedOutboxCount` |
| `libs/shared/offline-cache/src/lib/cache-storage.port.ts` | `storeNames()`, `preserveOnUpgrade` |
| `libs/shared/offline-cache/src/lib/idb-storage.adapter.ts` | `upgrade` respektiert `preserveOnUpgrade`, Index-Abgleich |
| `apps/pos-client/src/app/offline-cache.provider.ts` | Diagnose-Zeile nach dem Wipe |
| `libs/shared/data-access-config/src/lib/services/device-config.service.ts` | `UnpairOptions`, `databasesDeleted`, Protokollzeile |
| `libs/domains/devices/feature-pos-settings/src/lib/unpair-device-dialog/` | Schritt `confirm-pending` |
