---
type: ADR
title: 'Versions-Kompatibilität je Strecke — Cloud zuerst, Rückstand in Monatsständen, Mindestversion von Hand, nie eine Sperre im laufenden Betrieb'
description: 'Für Browser-Clients, POS ↔ Edge und Edge ↔ Cloud gilt je eine Regel: zulässiger Rückstand in Monatsständen (YY.MM), Erkennungsort und Verhalten bei Überschreitung. Release-Reihenfolge Cloud → Edge → POS dauerhaft, Mindestversion nur von Hand, der POS wird nie im laufenden Betrieb gesperrt. Der ADR baut keinen Mechanismus, er schneidet die Folge-Issues.'
tags: [versionierung, kompatibilität, sync, pos-client, api-edge, release]
status: stable
decision: accepted
generated: { by: claude-code/sonnet-5.5, at: 2026-11-15T17:00:00Z }
---

# ADR 0070 — Versions-Kompatibilität je Strecke

> **Entschieden am 2026-11-15** von Michael (panary/panary-core#1411, zwei Kommentare): die Entscheidungen 1–4
> am Vormittag, das Toleranz-Fenster („Fenster je Strecke") am Abend mit „Ja, so festschreiben".

## Problem

Zwischen den Teilen des Systems prüft heute nichts, ob sie zueinander passen. Der Auslöser war die
Frage, wie viele Versionen Rückstand je Strecke tragbar sind, ob Gleichstand erzwungen wird und ob eine
neue Version das Weiterarbeiten sperren soll. Die Bestandsaufnahme am Code (`origin/main` core
`d3e292e9`, cloud `8158e7e50`, 2026-11-15) ergibt:

| Strecke | Was heute geschieht | Beleg |
| --- | --- | --- |
| Browser ↔ Cloud (`admin-dashboard`) | Der einzige Vergleich im System: `VersionMonitorService` pollt `/health` der Cloud alle 60 s, bei Abweichung zeigt ein Banner „Neue Version verfügbar" mit Reload-Knopf. Rein informativ. | `panary-cloud/libs/shared/ui-layout/src/lib/version-monitor.service.ts:7,47-51,107-114` |
| Browser ↔ Edge (`admin-client`, `setup-client`) | Kein Vergleich. Der Admin-Client zeigt die Edge-Version aus `/health` an und vergleicht sie nicht mit der eigenen. | `apps/admin-client/src/app/core/edge-version.service.ts` |
| POS → Edge | Kein Versions-Header, kein Interceptor, kein Handshake. Das Socket-`auth` trägt nur `apiKey`, `deviceId`, `deviceName`. `appVersion` ist Anzeige und Cache-Schlüssel, kein Vertragscheck. | `libs/shared/data-access/src/lib/services/connection.service.ts:712-716`, `libs/shared/offline-cache/src/lib/cache-namespace.ts:45` |
| POS-Selbstaktualisierung | Tauri-Updater prüft 5 s nach Start und alle 30 min gegen `latest.json`, Banner nur auf der Login-Seite. Vergleich mit dem Edge: keiner. Geräte aktualisieren sich laut panary/panary-workbench#214 nie selbst. Sunmi: nur Debug-APK per `adb`. | `libs/shared/data-access-updater/.../update.service.ts:24-47`, `tools/scripts/android-apk.sh` |
| Edge → Cloud | Der Edge sendet `edgeVersion` im Heartbeat, die Cloud liest es dort nicht. Gespeichert ist nur der **Pairing-Stand**, einziger Schreiber ist `edge-pairing.ts:388`. | `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts:1194`, `panary-cloud/apps/api-cloud/src/services/sync/sync.ts:1027-1130` |
| Mindestversion | `requiredEdgeMinVersion` existiert nur als optionales Schema-Feld, ohne Setzer und ohne Leser. | `libs/domains/sync/domain/src/lib/sync-status.schema.ts:19` |
| Messfelder | `posClientVersion` und `edgeAppVersion` in `order_interactions` haben keinen Schreiber. | `libs/domains/order-interactions/domain/src/lib/order-interaction.schema.ts:110-111` |
| Sync-Vertrag | Gemeinsame TypeBox-Schemas, Lockstep per Pin-Bump (cloud ADR 0018). Payloads tragen keine Versionsfeld. Geschlossene Schemas (`additionalProperties: false`) machen jedes neue Feld zum Vertragsbruch. | cloud ADR 0018, `panary-cloud/docs/log.d/2026-08-15-291-pin-bump-26-8-21.md` |

**Der Vorfall, der die Reihenfolge begründet:** Am 2026-08-15 trug `receiptSchema` mit `v26.8.21` das neue
Feld `discounts`; die Cloud lief noch auf den Libs von `26.8.20`. Ein Edge auf `26.8.21` schickte
rabattierte Belege mit dem Feld, die Cloud wies sie bei der Validierung ab. Sync **TERMINAL**, kein Retry,
die Operation war weg (ADR 0002, Abschnitt „Das Gate gegen den stillen Fehlschlag"; dort war die Ursache ein vergessenes Lib-Publish, der Pfad „Edge kennt ein Feld, das die Cloud-Libs nicht kennen" ist derselbe). Ein Edge, der **neuer** ist als die Cloud, ist
damit kein Schönheitsfehler, sondern ein Datenverlust-Pfad.

**Warum eine Versionsprüfung kein Sicherheits-Gate sein kann:** `edgeVersion` ist ungeprüfte Selbstauskunft
(cloud ADR 0014, Zeile 26). Ein Gate darauf läuft in dasselbe Argument wie der Outbox-Backlog als
Tagesabschluss-Gate (cloud ADR 0032). Die Versionsprüfung dient der **Erkennung von Drift**, nicht der
Abwehr.

## Datenbasis

Gemessen am 2026-11-15 aus den Git-Tags beider Repos (`git for-each-ref refs/tags`).

| Reihe | Zahl | Zeitraum |
| --- | --- | --- |
| core `v*` (Edge-Release) | 142 Tags; je Monat 13 / 19 / 24 / 18 / 17 / **40** / 11 (Apr, Jun–Nov) | seit 2026-04-01 |
| core `pos-v*` (POS-Release) | 88 Tags; je Monat 11 / 6 / 13 / 10 / 7 / **32** / 9 | seit 2026-04-06 |
| cloud `v*` (Prod-Release) | 51 Tags; je Monat 3 / 22 / 7 / 7 / 8 / 4 (Jun–Nov) | seit 2026-06-12 |
| Releases innerhalb von 14 Tagen nach einem core-`v*`-Tag | Median 12, p90 23, max 28 | |
| Releases innerhalb von 30 Tagen nach einem core-`v*`-Tag | Median 19, p90 39, max 41 | |
| Releases innerhalb von 14 Tagen nach einem cloud-`v*`-Tag | Median 4, p90 7, max 11 | |
| Pausen ohne core-Release | 27 Tage (2026-08-15 → 09-11), 22 Tage (07-09 → 07-27), 56 Tage (04-11 → 06-07) | |
| Edge-Rückstand im Feld | zwei Installationen standen **38** und **31 Tage** auf `v26.8.6` bzw. `v26.8.17`, rund 30 Releases, weil Watchtower still ausfiel | `docs/infrastructure/edge-auto-update-watchtower.md` |
| Schema-Änderungen (`*.schema.ts` in `libs/domains/*/domain`) | 17 / 15 / 16 Commits je Monat (Aug–Okt) | |
| Edge-Migrationen | 3 / 8 / 8 je Monat (Aug–Okt) | |

Was die Zahlen aussagen:

1. **„N Release-Stände" ist als Einheit unbrauchbar.** Eine Woche bringt zwischen 2 und über 10 core-Releases,
   der Oktober allein 40. Ein Fenster von „5 Releases" wären 3 Wochen im ruhigen Sommer und 4 Tage im Oktober.
2. **Der Monatsstand (`YY.MM`) ist die stabile Einheit.** Die Version hat das Format `YY.MM.INDEX`, der Index
   springt im neuen Monat auf 1 zurück (`tools/scripts/bump-version.mjs`). Ein Monatsstand ist also immer ein
   Kalendermonat, unabhängig von der Release-Frequenz.
3. **Schema- und Vertragsänderungen sind der Normalfall:** rund 16 Schema-Commits und 8 Migrationen im Monat.
   Das Fenster hat also nicht zu sagen, ob Brüche vorkommen, sondern wie lange die Cloud sie alten Ständen
   gegenüber abfedert.
4. **Der reale Rückstand war schon einmal über einen Monat und blieb unbemerkt.** Ein Fenster, das kleiner
   ist als dieser Fall, macht aus einem stillen Ausfall einen Sperr-Ausfall.

**Nicht messbar (ehrlich benannt):**

- **Edge-Rückstand im Betrieb.** `cloud_edges.edgeVersion` ist der Pairing-Stand, kein Laufzeitwert. Eine
  belastbare Zahl gibt es erst nach dem ersten Folge-Issue (Heartbeat-`edgeVersion` persistieren). Die 31 und
  38 Tage oben sind zwei zufällig entdeckte Fälle, keine Verteilung.
- **POS-Rückstand.** Es gibt keinen Schreiber für `posClientVersion`, die Cloud sieht keine POS-Version. Die
  Zahl lässt sich nur an den Pilot-Terminals von Hand erheben.
- **Dauer eines Release-Fensters Cloud → Edge.** Die Cloud-Prod-Releases (`v*`) laufen werktäglich im
  Staging (ADR 0034 der Cloud), Prod-Tags kommen 4 bis 8 im Monat. Wie viele Stunden oder Tage zwischen
  „Cloud auf Prod" und „Edge-Image veröffentlicht" liegen, ist nicht erhoben.

## Entscheidung

### 1. Release-Reihenfolge: Cloud → Edge → POS, dauerhaft (Michael, 2026-11-15)

Die Cloud ist zu **älteren Edges und Kassen abwärtskompatibel**, ein Edge ist nie neuer als die Cloud, ein POS
nie neuer als sein Edge. Begründung ist der Vorfall `v26.8.21` oben: Die Cloud muss ein neues Pflicht- oder
Zusatzfeld kennen, bevor der erste Edge es schickt. Die Reihenfolge ist keine Übergangsregel.

Folgen für die Umsetzung (Prüfpunkte der Folge-Issues, hier nicht gebaut):

- Neue Felder im Sync-Vertrag erscheinen erst in der Cloud, dann im Edge, mit eigenem Release je Seite.
- Die Richtung Cloud → Edge (Pull-Payloads an einen **älteren** Edge) ist hier nicht belegt: Ob ein alter Edge
  Felder, die er nicht kennt, toleriert, ist Gegenstand des Kompatibilitätstests (Folge-Issue).

### 2. Mindestversion: von Hand, nie abgeleitet (Michael, 2026-11-15)

Die Mindestversion ist eine **Plattform-Einstellung**, die Michael bewusst anhebt. Sie wird nie automatisch
aus einem Release, einem Tag oder einem Heartbeat abgeleitet. Ein `v*`-Tag belegt einen Build, keinen Rollout
(panary/panary-workbench#214), und `edgeVersion` ist Selbstauskunft.

### 3. Der POS wird nie im laufenden Betrieb gesperrt (Michael, 2026-11-15)

Während einer Schicht gibt es nur einen **Warnhinweis**. Gesperrt wird frühestens beim nächsten **Login** oder
**Schichtstart** und nur gegen die von Hand gesetzte Mindestversion. Ein laufender Verkauf scheitert nie an
der Versionsprüfung. Offline-Betrieb bleibt unberührt: Die Prüfung braucht den Edge, nie die Cloud.

### 4. Die Browser-Strecke (Michael, 2026-11-15)

Zur Strecke „Browser-Client" gehören **Admin-Dashboard** (ausgeliefert von der Cloud), **core-Admin-Client**
und **Setup-Client** (ausgeliefert vom Edge). **Storefront und Beleg-Portal sind ausgenommen:** Sie sind
öffentlich, haben keinen angemeldeten Dauer-Tab, und eine Reload-Pflicht hat dort keinen Sinn.

### Fenster je Strecke

> Einheit ist der Monatsstand `YY.MM`. „M" ist der Monatsstand des
> Referenzteils (bei Edge ↔ Cloud die Cloud, bei POS ↔ Edge der Edge). Ein Rückstand von 2 heißt:
> Der ältere Teil steht auf `M−2` oder neuer. Weil der Index im Monatswechsel zurückspringt, entspricht
> das je nach Stichtag etwa 60 bis 90 Kalendertagen.

| Strecke | Garantie (der neuere Teil trägt den älteren) | Warnung ab | Verhalten bei Überschreitung | Erkennungsort |
| --- | --- | --- | --- | --- |
| Browser ↔ ausliefernder Server | Gleichstand. Es gibt kein Fenster: Ein offener Tab ist nach einem Deploy sofort veraltet. | jede Abweichung | Banner mit Reload-Knopf (Bestand in der Cloud, neu im core-Admin-Client und Setup-Client). Reload-Pflicht nur über die manuelle Mindestversion. | Browser, durch Vergleich der eigenen Version mit `/health` |
| POS ↔ Edge | Der Edge versteht POS-Stände bis `M−2`. | POS steht auf `M−1` oder älter | Warnhinweis in der Schicht. **Keine Sperre im Betrieb.** Login oder Schichtstart nur gegen die manuelle Mindestversion verweigert. | POS (kennt seine Version) gegen die Edge-Version aus `/health`; Edge erfasst die POS-Version im Socket-`auth` |
| Edge ↔ Cloud | Die Cloud versteht Edge-Stände bis `M−2`. Ein Edge neuer als die Cloud ist ein Fehler im Ablauf. | Edge steht auf `M−1` oder älter, oder ist **neuer** als die Cloud | Alarm und Anzeige in der Edge-Verwaltung der Cloud. **Die Cloud sperrt den Sync eines zu alten Edges nie, auch nicht über die manuelle Mindestversion:** Bei einer Mindestversion bekommt der Edge-Admin einen Hinweis, der Sync läuft weiter. | Cloud, aus dem persistierten Heartbeat-`edgeVersion` |

Warum **2 Monatsstände** und nicht 1 oder 3:

- **1 ist zu eng.** Der Watchtower-Ausfall war 31 bis 38 Tage lang unbemerkt. Ein Fenster von einem
  Monatsstand hätte genau diese Edges beim Monatswechsel ausgesperrt, ohne dass jemand vorher gewarnt war.
- **2 deckt diesen Fall ab** und lässt Zeit, den Ausfall nach der Warnung zu beheben, bevor die Garantie
  endet.
- **3 trägt die Rückwärtskompatibilität der Cloud zu lange.** Bei rund 16 Schema-Änderungen im Monat sind das
  etwa 50 Änderungen, die jede einzeln gegen einen alten Stand getestet sein müssten.
- **POS und Edge bekommen dasselbe Fenster,** weil der POS laut panary/panary-workbench#214 nie selbst
  aktualisiert; ein engeres Fenster träfe Geräte, die nicht ohne Hand aktualisieren können.

## Verworfene Alternativen

| Alternative | Warum nicht |
| --- | --- |
| (c) Gleichstand erzwingen, überall | Der POS ist offline-fähig und aktualisiert nicht selbst. Gleichstand heißt: Nach jedem Release steht jede nicht aktualisierte Kasse still. |
| (b) Harte Mindestversion mit automatischer Sperre, abgeleitet aus dem Release | Ein Tag belegt keinen Rollout, `edgeVersion` ist fälschbar, und eine Sperre ist für Terminals, die nicht selbst aktualisieren können, ein Point of no Return. Ein Watchtower-Ausfall sperrte unbemerkt alle veralteten Edges auf einmal. |
| Fenster in „N Release-Ständen" | Unbrauchbare Einheit, siehe Datenbasis 1. |
| Versionsfeld in jedem Sync-Payload | Ändert den geschlossenen Vertrag in jedem Schema, löst aber das Problem nicht: Die Cloud muss den älteren Stand ohnehin verstehen. Die Versionserkennung gehört in Heartbeat und Handshake. |
| Edge-Rückstand aus `cloud_edges.edgeVersion` ablesen | Pairing-Stand, nicht Laufzeit. Vor dem ersten Folge-Issue wäre die Zahl falsch, nicht fehlend. |

## Konsequenzen

- ✅ Jede Strecke hat eine Regel: Rückstand, Verhalten, Erkennungsort. Das „kein Mechanismus" von heute ist
  eine bewusste Zwischenstufe mit festgelegtem Ziel.
- ✅ Ein laufender Verkauf scheitert nie an der Versionsprüfung.
- ⚠️ **Der Mechanismus ist noch nicht gebaut.** Bis die Folge-Issues fertig sind, gilt die Reihenfolge
  Cloud → Edge → POS als Betriebsregel ohne Prüfung. Der Pin-Bump-Ablauf (cloud ADR 0018) bleibt der einzige
  Schutz.
- ⚠️ **Die Garantie „Cloud versteht Edges bis `M−2`" ist eine Zusage, keine Messung.** Der Kompatibilitätstest
  mit alten Edge-Images (Folge-Issue) ist die Voraussetzung, sie wirklich zu geben.
- ⚠️ **Die Selbstauskunft bleibt Selbstauskunft.** Die Prüfung erkennt Drift ehrlicher Edges, nicht Edges, die
  eine falsche Version melden.
- ⚠️ Eine manuelle Mindestversion kann einen Edge oder POS sperren, den niemand aktualisieren kann. Das
  Anheben ist deshalb ein Schritt für Michael, mit vorheriger Drift-Anzeige (Folge-Issue).

## Folge-Issues

Je PR-groß, als Unter-Issues von panary/panary-core#1411 mit blocked-by-Reihenfolge angelegt (Nummern stehen
im Issue). Reihenfolge nach Abhängigkeit:

1. Heartbeat-`edgeVersion` in der Cloud persistieren (cloud) — liefert die erste echte Messung.
2. Versionsvergleich `YY.MM.INDEX` mit Monatsstand-Differenz als geteilte Hilfsfunktion (core, `shared-common`), dazu die additiven Felder `requiredEdgeMinVersion` und `requiredPosMinVersion` in der **Heartbeat-Antwort**, nicht im Sync-Status-Schema (core#1437, Nachtrag unten).
3. Mindestversion je Strecke als Plattform-Einstellung von Hand (cloud, Feature-Flag-Abstimmung nötig).
4. Drift-Anzeige und Alarm für veraltete oder zu neue Edges in der Edge-Verwaltung (cloud).
5. Versions-Handshake POS ↔ Edge: Version im Socket-`auth`, Erfassung am Edge, tote Spalten
   `posClientVersion`/`edgeAppVersion` entweder befüllen oder entfernen (core).
6. `requiredEdgeMinVersion` und `requiredPosMinVersion` verdrahten: erst liefert die Cloud, dann wertet der Edge aus und reicht die POS-Mindestversion weiter (je ein Issue in cloud und core).
7. POS: Warnhinweis in der Schicht, Prüfung bei Login und Schichtstart gegen die Mindestversion (core).
8. Update-Hinweis im core-Admin-Client und Setup-Client (core).
9. Kompatibilitätsgate in der Cloud-CI: Sync-Payloads der letzten zwei Monatsstände aus den publizierten Paketen gegen die aktuellen Validatoren, beide Richtungen (cloud).

### Nachtrag: Umsetzung der geteilten Bausteine (core#1437)

- **Übertragungsweg der Mindestversionen ist die Heartbeat-Antwort** (`syncHeartbeatResponseSchema`,
  `/sync-heartbeat`), nicht `/sync-status`: Der Edge liest die Heartbeat-Antwort schon heute, `/sync-status`
  ruft er nirgends auf. Beide Felder sind optional und höchstens 50 Zeichen lang; ältere Edges lesen die
  Antwort ohne Schemaprüfung und ignorieren sie. `requiredEdgeMinVersion` im Status-Schema bleibt unangetastet.
- **Die Funktionen leben in `@panary/shared-common`** (`libs/shared/common/src/lib/utils/panary-version.ts`):
  `parsePanaryVersion`, `compareVersions`, `monthsBehind(referenz, kandidat)`. Alles, was nicht `YY.MM.INDEX`
  ist, ist `null` („unbekannt"), nie ein Rückstand: `staging-<sha>`, `pr-check`, `smoke`, `0.0.0` und
  gewöhnliches Semver wie `1.2.3` (zweistelliges Jahr verlangt).
- **Vorzeichen von `monthsBehind`:** positiv = der Kandidat liegt hinter der Referenz zurück, negativ = er ist
  **neuer** als die Referenz. Der zweite Fall ist der Datenverlust-Pfad (Edge neuer als die Cloud-Libs) und
  braucht deshalb ein eigenes Zeichen statt eines Betrags. Verglichen wird nur der Monatsstand, nie der Index.
- **Ohne Verhaltensänderung.** Cloud und core nutzen die Bausteine erst in den Folge-Issues, nach dem
  Core-Release der Libs und dem Pin-Bump der Cloud.

## Referenzen

- panary/panary-core#1411 (Entscheidung), panary/panary-workbench#214 (Tag ≠ Rollout)
- ADR 0002 (Library-Publishing, Vorfall `v26.8.21`), cloud ADR 0018 (Schema-Sharing), cloud ADR 0014
  (Selbstauskunft), cloud ADR 0032 (kein Gate auf Selbstauskunft)
- `docs/infrastructure/edge-auto-update-watchtower.md`
