---
type: ADR
title: 'KDS — Küchen-Projektion, Betriebsmodi als Konfiguration und Scheduling-Strategien'
description: 'KDS-Zustand als eigene Projektion neben der fiskalisch unveränderten Order; Stationen, Routing, Sicht- und Startregeln, Bump-Modus als Konfiguration; Scheduler als Strategy (fifo, prep-time, anchor-started, gelernt) mit Prognose-Rückkanal auf estimatedDuration.'
tags: [kds, orders, products, devices, scheduling, realtime]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-11-01T00:00:00Z }
---

# KDS — Küchen-Projektion, Betriebsmodi und Scheduling

> Setzt [ADR 0065](0065-kds-laufzeit-topologie.md) B und [ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md) voraus. Belege: [KDS-Befund](../architecture/kds-befund-ist-stand.md) („Befund §x").

## Entscheidungsstand (G4–G8, Michael, 2026-11-01)

Diese Festlegungen gehen den Vorschlägen weiter unten vor.

- **G4:** Eigene Projektion **mit Grobzustand am `KitchenTicket`** (`queued | in-progress | ready | served | voided`) und ETA. Beides wird **ab v1 per Outbox in die Cloud synchronisiert** und als Vertrag behandelt. Keine Rückspiegelung in v1. `ready → produced` kommt später als additiver Hook ([S3-Nachtrag](../architecture/kds-bewertungen-skalierung-open-core.md) §3).
- **G5: Alle Modi in v1:** Station/Insel, Expo, Linie, All-Day, Single-Screen, jeweils mit Vorlage. *(Abweichend vom Vorschlag „Station + Expo". Umfangsfolge für den ~3-Monats-Piloten siehe Risiken in S5.)*
- **G6:** Messen und transparente Planung mit konfigurierten Zeiten. Gelernte Zeiten laufen im Schatten mit. Umschalten nach 4 Wochen anhand der Metrik aus §7.
- **G7: Eigene App `apps/kds-client`** (abweichend vom Vorschlag in §6).
  - Teilt Pairing, Discovery, UI-Skalierung und Datendienste über Nx-Libs mit dem pos-client.
  - Eigene Hüllen (Tauri, Capacitor/Sunmi, Browser), eigene APK, eigener Release-Kanal.
  - Passt zur Separierungs-Leitlinie aus [ADR 0065](0065-kds-laufzeit-topologie.md).
- **G8:** Pilot-Default ist `immediate` + `anchor-started`, mit Rückfall auf `timer-from-fire` nach Toleranz und Eskalation `forgotten`. Je Station umschaltbar.

## Problem

Das KDS soll Station/Insel, Linie, Expo, All-Day und Single-Screen als **Konfiguration** abbilden, nicht als Produktvarianten. Es soll Zubereitungszeiten messen und Positionen so einplanen, dass ein Ticket gleichzeitig fertig wird. Es soll warnen und eine Wartezeit-Prognose an die Kasse zurückgeben.

Der Pilot arbeitet mit drei Stationen und einer eigenen Ausgabe (Expo). Er hat Nachbestellungen, aber keine Gänge, und hat Dual Bump zugesagt. Dual oder Single Bump muss umschaltbar bleiben.

Randbedingungen aus dem Bestand:

- **Unveränderliche Bestellpositionen.** `lineItems` sind unveränderlich, der Patch ist still gesperrt (Rechtsgutachten zu panary/panary-core#345, `order.schema.ts:322-330`).
- **Order-Status mit Nebenwirkungen.** Der Status trägt Abrechnungsumfang (`settlement-scope.ts:82-83`) und Lagerbuchung (`→ produced`). Niemand setzt `production`. Die Kasse rendert `production` heute als „storniert" (Befund F1).
- **Zeiten.** `productionTime` am Produkt gibt es, es ist aber ungenutzt. `estimatedDuration` an der Order kommt aus einer Kachel an der Kasse und speist Bon und Verspätungsanzeige (Befund §3.4).
- **Kein Stations-Routing.** ADR 0045 hat Routing nach Warengruppe für den **Druck** verworfen.
- **Kein Replay.** Es gibt kein Replay und kein Ack für Geräte (Befund §3.2).

## Was der Markt kann (geprüft am 2026-11-01)

| Aussage im Prompt | Befund | Quelle |
|---|---|---|
| Versetztes Starten nach Zubereitungszeit ist etabliert | **bestätigt**: Toast „Item Fire by Prep Time" (Zeiten je Artikel, Modifier addieren), Oracle „Timing by Order", LS Central „Synchronized Production Timing" | [Toast](https://doc.toasttab.com/doc/platformguide/adminFireByPrepTime.html), [Toast Modifier](https://support.toasttab.com/en/article/Modifier-Prep-Times), [Oracle](https://docs.oracle.com/en/industries/food-beverage/simphony/kdscu/c_kds_menu_item_timing_by_order.htm), [LS](https://help.lscentral180.lsretail.com/Content/LS-Hospitality/Kitchen-Display-System/Synchronized-Production-Timing-For-KOTs.htm) |
| Zeiten sind statisch konfiguriert | **bestätigt** bei allen drei | dito |
| (b) Stationskapazität ist ein Panary-Alleinstellungsmerkmal | **widerlegt**: Oracle hat „KDS Capacity Scheduling" | [Oracle Capacity](https://docs.oracle.com/en/industries/food-beverage/simphony/kdscu/c_kds_capacity_scheduling.htm) |
| (e) Markt verdeckt Positionen bis zum Feuern | **teilweise widerlegt**: LS zeigt noch nicht fällige Positionen sofort grau, Toast zeigt ungefeuerte Positionen auf dem Expo grau/kursiv | [LS Timing vs. Display](https://help.lscentral180.lsretail.com/Content/LS-Hospitality/Kitchen-Display-System/Synchronized%20Timing%20vs.%20Display%20on%20Adding.htm), [Toast](https://doc.toasttab.com/doc/platformguide/adminFireByPrepTime.html) |
| Dual Bump existiert vereinzelt | bestätigt, aber **nur eine Quelle** (Händlerseite oneView) | [oneView](https://unopos.com/?p=2188) |
| Nachbestellungen brechen die Sortierlogik | bestätigt: LS braucht für Synchronized Timing „Add Item to New KOT" | LS, dito |

**Was nach dieser Prüfung als Differenzierung übrig bleibt:**

1. **Startauslöser `anchor-started`.** Startsignale hängen am **tatsächlichen** Start des Anker-Items, nicht an einem Timer ab Bestellung. Das erwähnt keine der gelesenen Quellen.
2. **Gelernte statt konfigurierte Zeiten.**
3. **Prognose-Rückkanal** an Kasse, Storefront und Voice.
4. **Eskalation** bei fälligen, nicht gestarteten Positionen. LS schweigt dazu, die anderen wurden nicht geprüft.
5. **Modus als Konfiguration** je Station und Filiale.

## Entscheidung

### 1. Eigene Projektion statt Order-Status (G4)

Der Küchenzustand lebt in eigenen Entitäten. Die Order bleibt fiskalisch unverändert. Begründung:

- `lineItems` sind gesperrt, ein Zustand je Position hat dort keinen Platz.
- Bei Dual Bump wären es zwei Patches je Position auf einen fiskalisch relevanten, synchronisierten Datensatz. Das kostet Outbox-Volumen und berührt Abrechnungs- und Lagerlogik.
- Stornos, Splits und Nachbestellungen bleiben Order-Wahrheit. Die Projektion folgt ihnen.

**Teilfrage (offen):**

- Soll die Projektion grob auf den Order-Kopf zurückspiegeln, etwa `→ production` beim ersten Start und `→ produced` wenn alles fertig ist? Das brächte die Lagerbuchung zum richtigen Zeitpunkt und die „Abholtafel-Sicht" (`order.schema.ts:19`).
- Voraussetzung wäre die Behebung von F1 (panary/panary-core#1264). Außerdem müsste geklärt sein, was `produced` in der Lagerbuchung auslöst, wenn ein Teil storniert wird.
- **Vorschlag v1:** **keine** Rückspiegelung. Als v2-Kandidat vormerken.

### 2. Entitäten

| Entität | Persistiert | Inhalt |
|---|---|---|
| `Station` | ja, je Filiale, cloud-gepflegt, Sync an den Edge | `type: production \| expo \| pass`, `capacity` (parallele Slots), `bumpMode: single \| dual`, `bumpPolicy: own-items \| wait-for-all \| manual`, `visibilityPolicy: immediate \| at-fire-time`, `startTrigger: timer-from-fire \| anchor-started \| manual`, Eskalationsschwellen, zugeordnete Geräte |
| `RoutingRule` | ja, je Filiale | Bedingung (Produkt, Produktgruppe/`categoryIds`, Modifier, Produkttyp) → Station(en). Dazu Priorität und **genau eine Fallback-Station je Filiale** |
| `KitchenTicket` | ja (Projektion) | **genau eine je Order** (`orderId`), dazu `settlementScope` der Order für die Gruppierung, Grobzustand, Ziel-Fertigzeit, Prognosequalität (`estimated \| anchored`) |
| `KitchenItem` | ja (Projektion) | `ticketId`, `orderId`, `lineItemId`, `stationId`, Menge, Status, Zeitstempel `dueAt`, `startedAt`, `doneAt`, `servedAt`, `voidedAt`. Monotone `seq` je Filiale für das Replay |
| `ItemDependency` | **nein** | Ergebnis des Schedulers. Abgeleitet: `plannedStart(x) = start(anchor) + prep(anchor) − prep(x)` |
| `PrepTimeProfile` | ja | je Produkt × Station [× Modifier]: konfigurierter Wert (Vorbelegung aus `productionTime`), gelernter Wert, Stichprobe n, Streuung. **Ohne Personenbezug** (Michaels Entscheidung) |
| `ScheduleStrategy` | Code (Interface) | `fifo`, `fire-by-prep-time`, `anchor-started`, `smart-learned`. Reine Funktion `plan(state, now, profiles) → schedule` ([ADR 0065](0065-kds-laufzeit-topologie.md)) |

**Zustände von `KitchenItem`:**

- Hauptpfad: `queued → scheduled → due → started → done → served`
- quer dazu: `voided`, `recalled`
- `escalated` ist **kein** Zustand. Es ist eine abgeleitete Stufe (`due-soon | late | forgotten`), damit der Zustandsautomat klein bleibt.
- Bei `bumpMode: single` entfällt `started`. Der Startzeitpunkt wird dann aus `doneAt − prep` geschätzt und als geschätzt markiert. Er fließt nicht als Messung ins Lernen.

### 3. Betriebsmodi als Konfiguration

| Modus | Konfiguration |
|---|---|
| **Station/Insel** (Pilot) | mehrere `production`-Stationen parallel plus eine `expo`-Station mit `bumpPolicy: wait-for-all` |
| **Linie** | Stationen in Reihe. `done` an Station n erzeugt `queued` an Station n+1 (Übergabe-Regel) |
| **Expo** | Station `type: expo`, sieht ganze Tickets mit dem Fortschritt je Station |
| **All-Day** | Ansicht (Summe offener Mengen je Produkt), keine Entität |
| **Single-Screen** | eine Station als Fallback für alles |

**Vorlagen** (Michaels Wunsch: Vorschläge nach anerkannten Mustern) erzeugen Stationen und Regeln als Startpunkt, zum Beispiel „Imbiss mit Inseln und Ausgabe", „Linie" oder „Ein Bildschirm". Danach wird frei angepasst.

### 4. Abgrenzung zu ADR 0045

ADR 0045 hat die Zuordnung Warengruppe→**Drucker** verworfen, weil der Unterschied zwischen Küchenbon und Quittung „nicht im Sortiment" liegt. Das bleibt richtig, und dieser ADR ändert den Druck nicht.

Das KDS-Routing löst eine andere Frage: **Welche Position bereitet wer zu.** Die liegt sehr wohl im Sortiment.

Die Kritik aus ADR 0045 am Pflegeaufwand trifft auch hier. Die Antworten darauf:

- **Fallback-Station:** Eine leere oder lückenhafte Zuordnung ergibt nie eine verlorene Position.
- **Vorlagen** für die Erstbefüllung.
- **Warnung im Admin** für Produkte, die nur über den Fallback geroutet werden.
- Regeln greifen bevorzugt auf **Produktgruppen**, damit neue Artikel automatisch mitlaufen.

### 5. Scheduling

- **Zeitmodell:**
  - Je Profil zählt der konfigurierte Wert, solange n unter der Mindeststichprobe liegt (konfigurierbar, Vorschlag 20).
  - Danach gilt ein robuster gleitender Schätzer: P50 für den Plan, P80 für die Prognose an den Kunden.
  - Ausreißer, etwa vergessene Bumps mit Dauer über k × P80, werden verworfen und gezählt.
  - Modifier-Offsets sind additiv, wie bei Toast.
- **Plan je Ticket:**
  - Anker ist die Position mit der längsten Zubereitungszeit unter Berücksichtigung der Warteschlange ihrer Station.
  - Ziel-Fertigzeit = Start(Anker) + prep(Anker).
  - Start der übrigen Positionen = Ziel − prep.
- **`anchor-started`:**
  - Solange der Anker nicht gestartet ist, ist die Ziel-Fertigzeit eine Schätzung (`estimated`), abgeleitet aus der Warteschlange der Anker-Station.
  - Mit dem Start des Ankers wird sie fixiert (`anchored`) und als Event an alle beteiligten Stationen verteilt.
  - **Gleichstand:** Anker wird die Station mit der längeren Warteschlange, danach die mit der kleineren `stationId`. Deterministisch und damit replaybar.
  - **Rückfall (Hypothese):** Startet der Anker nicht binnen `plannedStart + Toleranz`, fällt das Ticket auf `timer-from-fire` zurück, und der Anker eskaliert zu `forgotten`.
- **Eskalation:**
  - `due-soon`, `due`, `late` und `forgotten` werden an der eigenen Station angezeigt.
  - Ab `late` zusätzlich am Expo.
  - Alle Schwellen sind je Station konfigurierbar.
- **Nachbestellungen** *(in S4 am Code korrigiert)*:
  - Eine Nachbestellung ist in panary **eine neue Order im selben Abrechnungskreis** (`settlementScope`, `order.schema.ts:422`, `assign-settlement-scope.hook.ts`). Positionen werden nie an eine bestehende Order angehängt. Das ist der rechtlich vorgegebene Weg (Bon-Split/Nachbuchung panary/panary-core#345/panary/panary-core#352).
  - Deshalb gilt: **ein `KitchenTicket` je Order**. Jedes Ticket wird eigenständig geplant, das Expo gruppiert nach `settlementScope`.
  - So umgeht das Modell den Sortierbruch, den LS mit „Add Item to New KOT" löst, und braucht keinen eigenen Zähler.
- **Storno:** Ein Order-Event erzeugt `voided` an allen betroffenen `KitchenItem` und wird als Event verteilt. Ziel unter 500 ms, im selben Prozess ([ADR 0065](0065-kds-laufzeit-topologie.md)).
- **Replay:**
  - Der Client merkt sich die höchste empfangene `seq`.
  - Nach einem Reconnect holt er per `find({ seq > lastSeq })` nach. Das ist ein normaler Feathers-Lesepfad, kein neuer Kanal, nach dem Vorbild des Sync-Cursors.
  - Ein Ack ist für v1 nicht nötig. Der Zustand liegt serverseitig, der Client ist nur eine Ansicht.
- **Prognose an die Kasse:**
  - Erwartete Fertigzeit einer neuen Bestellung = Simulation gegen die aktuellen Warteschlangen je Station (einfaches Listen-Scheduling mit `capacity`).
  - Andockpunkt ist die Wartezeit-Kachel im Bestelldialog. Die Prognose **schlägt** `estimatedDuration` vor, die Kasse kann übersteuern.
  - Bon und Verspätungsanzeige lesen `estimatedDuration` unverändert weiter (Befund §3.4).
  - Storefront und Voice erst in v2 (Kanäle v1: nur POS).

### 6. Client (G7)

> **Überholt durch den Entscheidungsstand oben (eigene App `apps/kds-client`).** Der folgende Text zeigt den ursprünglichen Vorschlag.

**Eine App mit Geräterolle.**

- Der pos-client routet nach `DeviceType` (aus dem Pairing) auf eine KDS-Shell.
- Begründung:
  - Alle drei Hardware-Wege (Sunmi/Android über Capacitor, Mini-PC über Tauri, Tablet über den Browser) hängen an dieser einen App.
  - Pairing, mDNS, Auth und UI-Skalierung sind schon da.
- Das KDS kommt als lazy geladene Feature-Lib, deshalb wächst das Bundle nur für KDS-Geräte.
- **Offen:** Läuft der pos-client im Browser ohne Hülle vollständig? (Befund §6)
- Eine Bump-Bar per Tastatur-Emulation ist für v2 vorgemerkt.

### 7. Erfolgsmetrik (Hypothese „gelernt schlägt konfiguriert")

- Nach 4 Wochen Pilot: mittlerer absoluter Fehler zwischen prognostizierter und tatsächlicher Fertigzeit je Ticket, in Minuten.
- Verglichen werden (a) die Kachel-Wartezeit, (b) die Prognose aus konfigurierten Zeiten, (c) die Prognose aus gelernten Zeiten.
- Dazu als Datenqualität der Anteil der Positionen mit beiden Zeitstempeln.
- **Gelernt gilt als besser,** wenn (c) um mindestens 20 % und mindestens 2 Minuten besser ist als (b). Die Schwelle ist ein Vorschlag, abzustimmen.

## Konsequenzen

- **Neue Domäne in core:** `libs/domains/kitchen/*`. Stationen und Regeln laufen per Sync an den Edge. Zeitstempel der Positionen müssen Edge→Cloud ins Lernen fließen, damit landet eine neue Sync-Entität in Allowlist und Felddeklarationen.
- **Order, Abrechnung und Lager bleiben in v1 unberührt.** F1 ist als Bug-Issue panary/panary-core#1264 angelegt. Seine Behebung ist Voraussetzung für den späteren Hook `ready → produced`.
- **Der Kassendialog bekommt einen Prognose-Vorschlag.** Eine Kasse ohne KDS sieht unverändert die Kacheln.
- **Risiken:**
  - Inkonsequentes Bumpen verschlechtert die Daten. Gegenmittel: Ausreißerfilter, Quote im Admin, Single-Bump-Modus.
  - Kleine Stichproben → Rückfall auf konfigurierte Werte.
  - Positionen an mehreren Stationen (Burger + Pommes im Menü). Die Bundle-`components` routen einzeln, das Expo führt zusammen.
  - Vorgezogene Arbeit, etwa Pommes auf Vorrat, verfälscht die Messung. Gegenmittel: Station-Option „Vorratsartikel, nicht messen".

## Ursprünglicher Vorschlag zu G5, G6, G8 (überholt durch den Entscheidungsstand oben)

| Gate | Vorschlag |
|---|---|
| G5 v1-Umfang | Station + Expo (der Pilot hat eine Ausgabe). Linie, All-Day und Single-Screen sind durch das Modell abgedeckt, ihre Vorlagen und Sonder-UI kommen erst in v2 |
| G6 Smart in v1 | **Messung und transparente Planung mit konfigurierten Zeiten** in v1. Gelernte Zeiten **schattenweise** mitrechnen und vergleichen (Metrik oben). Umschalten erst nach 4 Wochen Daten |
| G8 Pilot-Default | `immediate` + `anchor-started` mit Rückfall `timer-from-fire` nach Toleranz. Umschaltbar je Station |

## Quellen

- Befund §3.1–3.4, F1 (panary/panary-core#1264)
- ADR 0045, ADR 0049 (Split, core)
- Marktquellen in der Tabelle oben
