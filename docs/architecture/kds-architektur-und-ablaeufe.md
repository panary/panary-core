---
type: Architecture
title: 'KDS — Architektur und Abläufe (S4, PNRY-FEAT-KDS-001)'
description: 'C4-Sichten (LikeC4, aus dem bestehenden cloud-Modell erzeugt), Vertrag API ↔ Küchenmodul, Sequenz- und Zustandsdiagramme der KDS-Abläufe für die gewählte Topologie (Edge-Pilot, Connect als Ziel).'
tags: [kds, architecture, c4, orders, realtime, sync]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-01T00:00:00Z }
---

# KDS — Architektur und Abläufe (S4)

**Grundlage:** die Gate-Entscheidungen G1–G8 ([ADR 0065](../adr/0065-kds-laufzeit-topologie.md), [ADR 0066](../adr/0066-kds-repo-zuordnung-und-edge-cloud.md), [ADR 0067](../adr/0067-kds-kuechen-projektion-und-scheduling.md), [S3-Nachtrag](kds-bewertungen-skalierung-open-core.md)).

**Quellen der Diagramme:**

- **C4:** Modelliert als **LikeC4-Erweiterung des bestehenden Modells** in `panary-cloud/docs/architecture/c4/` (neue Dateien `model/kds.c4` und `views/kds.c4`). Validiert mit `likec4 validate` (19 Dateien, gültig). Die Mermaid-Fassungen unten sind daraus mit `likec4 gen mmd` erzeugt, nicht von Hand gezeichnet. Alle KDS-Elemente tragen `#planned`.
- **Abläufe und Zustände:** Mermaid, von Hand. Gegen den Code geprüft sind Nachbestellung, Storno/Split und `estimatedDuration`. Alles Übrige ist Entwurf.

> **Zum Durchgehen:** Jeder Ablauf endet mit „Offen". Diese Punkte bitte gemeinsam klären, bevor die Entitäten final sind (Vorgabe aus S4).

## 1. C4

### 1.1 Kontext

```mermaid
graph TB
  KitchenStaff@{ icon: "fa:user", shape: rounded, label: "Kuechenpersonal" }
  PassStaff@{ icon: "fa:user", shape: rounded, label: "Ausgabe / Expo" }
  Cashier@{ icon: "fa:user", shape: rounded, label: "Cashier" }
  Manager@{ icon: "fa:user", shape: rounded, label: "Location Manager" }
  KdsClient@{ shape: rounded, label: "KDS Client" }
  Pos@{ shape: rounded, label: "Panary Terminal" }
  Edge@{ shape: rectangle, label: "Panary Edge" }
  Cloud@{ shape: rectangle, label: "Panary Cloud" }
  KitchenStaff -. "`Start / Fertig / Recall`" .-> KdsClient
  PassStaff -. "`Ausgabe bestaetigen (served)`" .-> KdsClient
  Cashier -.-> Pos
  KdsClient -. "`REST + Socket.IO, API-Key + deviceId 
(LAN, mDNS)`" .-> Edge
  Pos -. "`Bestellungen, Katalog, Login — LAN, 
Socket.IO`" .-> Edge
  Edge -. "`Kuechen-Events (created/patched)`" .-> KdsClient
  Manager -.-> Cloud
  KdsClient -. "`Connect: Socket.IO direkt (Ziel, nach 
V1-V5)`" .-> Cloud
  Pos -. "`[...]`" .-> Cloud
  Edge -. "`[...]`" .-> Cloud
  Cloud -. "`[...]`" .-> Edge
```

### 1.2 Container — Operate (Pilot)

```mermaid
graph TB
  KitchenStaff@{ icon: "fa:user", shape: rounded, label: "Kuechenpersonal" }
  PassStaff@{ icon: "fa:user", shape: rounded, label: "Ausgabe / Expo" }
  Cashier@{ icon: "fa:user", shape: rounded, label: "Cashier" }
  subgraph Cloud["`Panary Cloud`"]
    subgraph Cloud.AdminDashboard["`Admin Dashboard`"]
      Cloud.AdminDashboard.FeKitchen@{ shape: rectangle, label: "Kueche" }
    end
    subgraph Cloud.CloudApi["`api-cloud`"]
      Cloud.CloudApi.SvcKitchen@{ shape: rectangle, label: "Kitchen" }
    end
    Cloud.Mongo@{ shape: cylinder, label: "MongoDB 7" }
  end
  KdsClient@{ shape: rounded, label: "KDS Client" }
  Pos@{ shape: rounded, label: "Panary Terminal" }
  subgraph Edge["`Panary Edge`"]
    Edge.EdgeSales@{ shape: rectangle, label: "Sales Services" }
    Edge.EdgePublic@{ shape: rectangle, label: "Public Endpoints" }
    Edge.Kitchen@{ shape: rectangle, label: "Kitchen Module" }
    Edge.EdgeSync@{ shape: rectangle, label: "Sync Services" }
    Edge.SyncScheduler@{ shape: horizontal-cylinder, label: "Sync Scheduler" }
  end
  KitchenStaff -. "`Start / Fertig / Recall`" .-> KdsClient
  PassStaff -. "`Ausgabe bestaetigen (served)`" .-> KdsClient
  Cashier -.-> Pos
  KdsClient -. "`Bumps (patch), Replay (find seq > 
lastSeq)`" .-> Edge.Kitchen
  Pos -. "`Prognose fuer neue Bestellung (Vorschlag 
fuer estimatedDuration)`" .-> Edge.Kitchen
  Edge.EdgeSales -. "`Order-Events im selben Prozess`" .-> Edge.Kitchen
  Edge.Kitchen -. "`Kuechen-Events (created/patched)`" .-> KdsClient
  Edge.Kitchen -. "`Outbox: Aggregate, Ticket-Grobzustand + 
ETA`" .-> Edge.EdgeSync
  Edge.EdgeSync -. "`sync-pull: Stationen, Regeln, Profile, 
Parameter`" .-> Edge.Kitchen
  Edge.EdgeSync -. "`Outbox-Eintraege bereitstellen`" .-> Edge.SyncScheduler
  KdsClient -. "`POST /device-pairing/redeem (vorhanden)`" .-> Edge.EdgePublic
  Edge.SyncScheduler -. "`[...]`" .-> Cloud.CloudApi.SvcKitchen
  Cloud.AdminDashboard.FeKitchen -. "`REST`" .-> Cloud.CloudApi.SvcKitchen
  Cloud.CloudApi.SvcKitchen -. "`Konfiguration, Aggregate (dauerhaft), 
Ticketzustaende (TTL)`" .-> Cloud.Mongo
```

### 1.3 Container — Connect cloud-direkt (Ziel nach V1–V5)

```mermaid
graph TB
  KitchenStaff@{ icon: "fa:user", shape: rounded, label: "Kuechenpersonal" }
  Cashier@{ icon: "fa:user", shape: rounded, label: "Cashier" }
  KdsClient@{ shape: rounded, label: "KDS Client" }
  Pos@{ shape: rounded, label: "Panary Terminal" }
  subgraph Cloud["`Panary Cloud`"]
    Cloud.KitchenRuntime@{ shape: rectangle, label: "Kitchen Runtime (Connect)" }
    subgraph Cloud.CloudApi["`api-cloud`"]
      Cloud.CloudApi.SvcOrders@{ shape: rectangle, label: "Orders" }
      Cloud.CloudApi.SvcKitchen@{ shape: rectangle, label: "Kitchen" }
    end
    Cloud.Mongo@{ shape: cylinder, label: "MongoDB 7" }
  end
  subgraph CorePackages["`Panary Core Packages`"]
    CorePackages.PkgKitchen@{ shape: rectangle, label: "@panary/kitchen/domain" }
  end
  KitchenStaff -. "`Start / Fertig / Recall`" .-> KdsClient
  Cashier -.-> Pos
  KdsClient -. "`Connect: Socket.IO direkt (Ziel, nach 
V1-V5)`" .-> Cloud.KitchenRuntime
  Cloud.KitchenRuntime -. "`Order-Events ueber denselben Vertrag`" .-> Cloud.CloudApi.SvcOrders
  Cloud.CloudApi.SvcKitchen -. "`Konfiguration, Aggregate (dauerhaft), 
Ticketzustaende (TTL)`" .-> Cloud.Mongo
  Cloud.KitchenRuntime -. "`importiert (dieselbe Lib)`" .-> CorePackages.PkgKitchen
```

### 1.4 Komponenten des Küchenmoduls

```mermaid
graph TB
  KdsClient@{ shape: rounded, label: "KDS Client" }
  Pos@{ shape: rounded, label: "Panary Terminal" }
  EdgeEdgeSales@{ shape: rectangle, label: "Sales Services" }
  EdgeEdgeSync@{ shape: rectangle, label: "Sync Services" }
  subgraph EdgeKitchen["`Kitchen Module`"]
    EdgeKitchen.KitchenPort@{ shape: rectangle, label: "Order-Event-Port" }
    EdgeKitchen.KitchenConfig@{ shape: rectangle, label: "Konfiguration" }
    EdgeKitchen.KitchenRouting@{ shape: rectangle, label: "Routing" }
    EdgeKitchen.KitchenProjection@{ shape: rectangle, label: "Projektion" }
    EdgeKitchen.KitchenScheduler@{ shape: rectangle, label: "Scheduler" }
    EdgeKitchen.KitchenAggregator@{ shape: rectangle, label: "Zeit-Aggregator" }
  end
  CorePackagesPkgKitchen@{ shape: rectangle, label: "@panary/kitchen/domain" }
  KdsClient -. "`Bumps (patch), Replay (find seq > 
lastSeq)`" .-> EdgeKitchen.KitchenProjection
  Pos -. "`Prognose fuer neue Bestellung (Vorschlag 
fuer estimatedDuration)`" .-> EdgeKitchen.KitchenScheduler
  EdgeEdgeSales -. "`Order-Events im selben Prozess`" .-> EdgeKitchen.KitchenPort
  EdgeEdgeSync -. "`sync-pull: Stationen, Regeln, Profile, 
Parameter`" .-> EdgeKitchen.KitchenConfig
  EdgeKitchen.KitchenPort -. "`neue Positionen`" .-> EdgeKitchen.KitchenRouting
  EdgeKitchen.KitchenPort -. "`Storno/Split -> voided`" .-> EdgeKitchen.KitchenProjection
  EdgeKitchen.KitchenRouting -. "`KitchenItems je Station`" .-> EdgeKitchen.KitchenProjection
  EdgeKitchen.KitchenConfig -. "`Stationen, Regeln`" .-> EdgeKitchen.KitchenRouting
  EdgeKitchen.KitchenProjection -. "`Zustandsaenderung (Bump, neues Ticket)`" .-> EdgeKitchen.KitchenScheduler
  EdgeKitchen.KitchenProjection -. "`abgeschlossene Positionen`" .-> EdgeKitchen.KitchenAggregator
  EdgeKitchen.KitchenScheduler -. "`dueAt, Ziel-Fertigzeit, Eskalationsstufe`" .-> EdgeKitchen.KitchenProjection
  EdgeKitchen.KitchenConfig -. "`Profile, Schwellen, Strategie`" .-> EdgeKitchen.KitchenScheduler
  EdgeKitchen.KitchenProjection -. "`Kuechen-Events (created/patched)`" .-> KdsClient
  EdgeKitchen.KitchenAggregator -. "`Outbox: Aggregate, Ticket-Grobzustand + 
ETA`" .-> EdgeEdgeSync
  EdgeKitchen -. "`importiert`" .-> CorePackagesPkgKitchen
```

### 1.5 KDS-Client innen

```mermaid
graph TB
  subgraph KdsClient["`KDS Client`"]
    KdsClient.KdsShell@{ shape: rectangle, label: "KDS Shell" }
    KdsClient.KdsViews@{ shape: rectangle, label: "Ansichten" }
    KdsClient.KdsReplay@{ shape: disk, label: "Replay-Cursor" }
  end
  subgraph Edge["`Panary Edge`"]
    Edge.KitchenKitchenProjection@{ shape: rectangle, label: "Projektion" }
  end
  KdsClient.KdsShell -. "`aktive Station, Modus`" .-> KdsClient.KdsViews
  KdsClient.KdsViews -. "`lastSeq`" .-> KdsClient.KdsReplay
  KdsClient.KdsViews -. "`Bumps (patch), Replay (find seq > 
lastSeq)`" .-> Edge.KitchenKitchenProjection
  Edge.KitchenKitchenProjection -. "`Kuechen-Events (created/patched)`" .-> KdsClient.KdsViews
```

## 2. Vertrag API ↔ Küchenmodul (G1-Leitlinie „separierbar")

Das Küchenmodul berührt die Order-Domäne **nur** über diesen Vertrag. Läuft es später in einem eigenen Prozess, wird der Port vom Funktionsaufruf auf eine Nachricht umgehängt, ohne die Logik umzubauen.

| Richtung | Nachricht | Inhalt | Quelle / Ziel heute |
|---|---|---|---|
| Order → Küche | `order.created` | `orderId`, `settlementScope`, `channel`, `recordingDate`, Positionen aus `effectiveLineItems()` (Produkt, Menge, Modifier, Bundle-Komponenten, `productGroupExternalId`) | after-Hook am `orders`-Service des Edge |
| Order → Küche | `order.statusChanged` | `orderId`, neuer Status (relevant: `aborted`, `completed`) | dito |
| Order → Küche | `order.lineItemsChanged` | `orderId`, neue effektive Positionen (Split, Storno einzelner Positionen) | dito; die Küche berechnet die Differenz selbst |
| Küche → Geräte | `kitchen-items` created/patched | Zustand, `dueAt`, Eskalationsstufe, `seq` | Feathers-Channel der Filiale |
| Küche → Geräte | `kitchen-tickets` patched | Grobzustand, Ziel-Fertigzeit, `estimated \| anchored` | dito |
| Kasse → Küche | `kitchen-forecast` find | Positionen einer geplanten Bestellung → erwartete Fertigzeit (P50/P80) | neuer Lese-Service |
| Küche → Cloud | Outbox `kitchen-ticket-states` | Grobzustand + ETA je Ticket | `recordSyncOutbox` |
| Küche → Cloud | Outbox `kitchen-aggregates` | Produkt × Station × Stunde: Anzahl, Summe, Buckets | dito |
| Cloud → Küche | sync-pull | Stationen, Routing-Regeln, Profile, gelernte Parameter | Sync-Scheduler |

**Regeln:**

- Jede Nachricht trägt `contractVersion`. Änderungen sind nur additiv.
- Das Küchenmodul ist idempotent pro `orderId`: Ein wiederholtes `order.created` erzeugt nichts doppelt.
- Die Küche schreibt nie in `orders`. Das hält G4 (keine Rückspiegelung) technisch ein.

## 3. Abläufe

### Entscheidungen aus dem Durchgang (Michael, 2026-11-01)

Diese Festlegungen gehen den „Offen"-Punkten unter den Diagrammen vor.

| Punkt | Entscheidung |
|---|---|
| Expo-Bump (3.1) | Expo bestätigt `served`, je Station abschaltbar |
| Positionen ohne Küchenbezug (3.1) | `RoutingRule` „nicht ins KDS" für Produktgruppen/-typen. Ohne Regel landet die Position auf der Fallback-Station |
| Anker-Wahl (3.2) | Warteschlange **plus** `prep`. Braucht `capacity` je Station |
| Eskalation (3.2) | Schwellen als Filial-Default mit Überschreibung je Station. `forgotten`-Alarm auf dem Expo, Admin-Glocke erst in v2 |
| Storno (3.3) | Gestartete Positionen muss die Station quittieren, nicht gestartete verschwinden ohne Quittung |
| Recall (3.3) | Station und Expo dürfen zurückholen. Das Ticket fällt von `ready` auf `in-progress` |
| Nachbestellung (3.4) | eigenständig fertig, Expo gruppiert nach `settlementScope` |
| Prognose (3.5) | Die Kasse zeigt **P80** als Vorschlag, übersteuerbar |
| Verbindungsverlust A (3.6) | Bumps sperren, Anzeige mit Hinweis „offline", nach Reconnect Replay |
| Edge-Ausfall C (3.6) | offen, als Risiko R3 nach S5 |

### 3.1 Bestellung → Routing → Stationen → Expo → Abschluss

```mermaid
sequenceDiagram
  autonumber
  actor K as Kasse (pos-client)
  participant O as api-edge orders
  participant P as Order-Event-Port
  participant R as Routing
  participant J as Projektion
  participant S as Scheduler
  participant Pz as KDS Pizza
  participant Gr as KDS Grill
  participant Ex as KDS Expo
  participant Q as Sync-Outbox

  K->>O: create order (2 Pizza, 1 Schnitzel, 1 Pommes)
  O-->>K: Order angelegt (fiskalisch unverändert weiter)
  O->>P: order.created (effectiveLineItems, settlementScope)
  P->>R: Positionen auflösen
  R->>J: KitchenItems: Pizza×2→Pizza, Schnitzel→Grill, Pommes→Fritteuse (bzw. Fallback)
  J->>S: neues Ticket
  S->>J: Anker = Pizza (längste prep), Ziel-Fertigzeit (estimated), dueAt je Item
  J-->>Pz: kitchen-items created (due)
  J-->>Gr: kitchen-items created (scheduled, "nicht vor 18:42")
  J-->>Ex: kitchen-tickets created (Fortschritt je Station)
  Note over Pz,Gr: G8: sofort sichtbar (immediate)
  Pz->>J: Start (Dual Bump)
  Pz->>J: Fertig
  Gr->>J: Start / Fertig (nach Startsignal, siehe 3.2)
  J-->>Ex: Ticket ready (alle Stationen done)
  Ex->>J: served
  J->>Q: kitchen-ticket-states (served), Aggregate
```

**Offen:**

- Soll Expo `served` bestätigen, oder reicht `ready`? Davon hängt ab, ob der Pilot ohne Expo-Bump arbeiten kann.
- Positionen ohne Küchenbezug, etwa Getränke: Station „keine" oder Ausschluss per Regel?

### 3.2 Anker-Start → Signal an abhängige Stationen → Eskalation

```mermaid
sequenceDiagram
  autonumber
  participant Pz as KDS Pizza (Anker)
  participant J as Projektion
  participant S as Scheduler
  participant Gr as KDS Grill
  participant Ex as KDS Expo

  Note over S: Ticket estimated: Ziel = Queue(Pizza) + prep(Pizza)
  Pz->>J: Start Pizza (startedAt)
  J->>S: Anker gestartet
  S->>J: Ziel fixiert (anchored) = startedAt + prep(Pizza)
  S->>J: Schnitzel dueAt = Ziel − prep(Schnitzel)
  J-->>Gr: Schnitzel: scheduled, dueAt 18:42 (Countdown)
  J-->>Ex: Ticket anchored, ETA 18:51
  alt Startzeit erreicht
    S->>J: Schnitzel due (Startsignal)
    J-->>Gr: due "jetzt beginnen"
    alt Grill startet rechtzeitig
      Gr->>J: Start Schnitzel
    else nicht gestartet nach dueAt + Toleranz 1
      S->>J: Stufe late
      J-->>Gr: Warnung
      J-->>Ex: late (ab dieser Stufe auch Expo)
      Note over S: nach Toleranz 2 Stufe forgotten → Alarm Expo/Leitung
    end
  end
  alt Anker startet nicht binnen plannedStart + Toleranz
    S->>J: Rückfall timer-from-fire, Anker forgotten
    J-->>Pz: Alarm
    J-->>Ex: Anker forgotten
  end
```

**Offen:**

- **Anker-Wahl bei Kapazität:** Wenn der Ofen voll ist (`capacity`), verschiebt sich der Anker-Start durch die Warteschlange. Zählt dann die Warteschlange oder nur `prep`? Vorschlag aus [ADR 0067](../adr/0067-kds-kuechen-projektion-und-scheduling.md): Warteschlange plus `prep`.
- **Schwellen** für `due-soon`, Toleranz 1 und 2: je Station oder je Filiale?
- **Leitungsalarm:** nur Expo-Bildschirm, oder zusätzlich die Glocke im Admin?

### 3.3 Storno und Split (Void-Propagation)

```mermaid
sequenceDiagram
  autonumber
  actor K as Kasse
  participant O as api-edge orders
  participant P as Order-Event-Port
  participant J as Projektion
  participant St as KDS betroffene Station
  participant Ex as KDS Expo

  alt ganze Bestellung storniert
    K->>O: patch status=aborted
    O->>P: order.statusChanged(aborted)
    P->>J: alle offenen Items → voided
  else einzelne Position (Split / Teilstorno)
    K->>O: Split / Storno-Vorgang (lineItems bleiben, splitOff wächst)
    O->>P: order.lineItemsChanged (effectiveLineItems)
    P->>J: Differenz → betroffene Items voided bzw. Menge reduziert
  end
  J-->>St: voided (hervorgehoben, Quittieren nötig)
  J-->>Ex: Ticket aktualisiert
  Note over P,St: Ziel < 500 ms, im selben Prozess ([ADR 0065](../adr/0065-kds-laufzeit-topologie.md))
  St->>J: Storno quittiert
```

**Offen:**

- Muss eine Station den Storno einer **schon gestarteten** Position quittieren? Vorschlag: ja, mit eigener Farbe. Ware ist eventuell schon in Arbeit, die Info für Verwurf oder Lager kommt von dort.
- **Recall** (fertig gemeldet, aber zurückgeholt): Nur die Station, oder auch das Expo?

### 3.4 Nachbestellung (am Code geprüft)

```mermaid
sequenceDiagram
  autonumber
  actor K as Kasse
  participant O as api-edge orders
  participant P as Order-Event-Port
  participant J as Projektion
  participant Ex as KDS Expo

  K->>O: neue Order, gleicher settlementScope (Tisch 4#1)
  Note over O: Positionen werden NIE an die bestehende Order angehängt (panary/panary-core#345/panary/panary-core#352)
  O->>P: order.created (settlementScope 4#1)
  P->>J: neues KitchenTicket (eigene Planung)
  J-->>Ex: gruppiert unter Kreis 4#1 neben dem ersten Ticket
```

**Offen:** Soll die Nachbestellung auf das erste Ticket warten („zusammen ausgeben") oder eigenständig fertig werden? Vorschlag: eigenständig. Das Expo zeigt die Gruppe.

### 3.5 Prognose-Rückkanal zur Kasse

```mermaid
sequenceDiagram
  autonumber
  actor M as Mitarbeiter Kasse
  participant K as Kasse Bestelldialog
  participant S as Scheduler (kitchen-forecast)
  participant O as api-edge orders
  participant B as Bon-Renderer

  M->>K: Positionen erfasst
  K->>S: find kitchen-forecast (Positionen)
  S->>S: Listen-Scheduling gegen aktuelle Queues je Station (capacity)
  S-->>K: P50 = 24 min, P80 = 31 min, Qualität (konfiguriert | gelernt-Schatten)
  K->>M: Vorschlag "ca. 30 min" statt Kachel-Default
  alt Mitarbeiter übernimmt
    K->>O: create order estimatedDuration = 31
  else übersteuert (Kachel)
    K->>O: create order estimatedDuration = Kachelwert
  end
  O->>B: Bon: recordingDate + estimatedDuration (unverändert)
  Note over S: G6: v1 rechnet mit konfigurierten Zeiten, gelernte laufen im Schatten (MAE-Vergleich)
```

**Offen:**

- Soll die Kasse P50 oder P80 anzeigen? Vorschlag: **P80**. Lieber realistisch als zu optimistisch, das war das 10-gegen-45-Minuten-Problem.
- Wie verhält sich die Kasse ohne KDS? Unverändert Kacheln, weil `kitchen-forecast` dann nicht existiert.

### 3.6 Verbindungsverlust

```mermaid
sequenceDiagram
  autonumber
  participant D as KDS-Gerät
  participant E as api-edge (Küchenmodul)
  participant C as Cloud

  rect rgba(128,128,128,0.08)
  Note over D,E: Fall A — WLAN des KDS kurz weg
  D--xE: Socket getrennt
  Note over D: Anzeige eingefroren + Hinweis "offline", keine Bumps lokal puffern (v1)
  D->>E: Reconnect (API-Key, deviceId)
  D->>E: find kitchen-items seq > lastSeq
  E-->>D: verpasste Änderungen
  end

  rect rgba(128,128,128,0.08)
  Note over E,C: Fall B — Internet weg (Operate)
  E--xC: Sync pausiert
  Note over D,E: Küche läuft unverändert, Outbox puffert Aggregate/Ticketzustände
  E->>C: Sync holt nach (Batches)
  end

  rect rgba(128,128,128,0.08)
  Note over D,E: Fall C — Edge weg
  D--xE: kein Server
  Note over D: KDS zeigt letzten Stand read-only, Kasse verliert den Edge ebenfalls
  Note over D,E: Rückfall Küchenbon nur, wenn Druck nicht am Edge hängt (Risiko R3)
  end
```

**Offen:**

- **Fall A:** Bumps offline puffern, oder Bump-Tasten sperren? Vorschlag v1: sperren. Puffern erzeugt Konflikte, wenn zwei Geräte dieselbe Station zeigen.
- **Fall C:** Welche Druckwege überleben einen Edge-Ausfall? IP-Drucker laufen über den Print-Server des Edge, MQTT-Drucker publiziert die Tauri-Kasse selbst (ADR 0036). Für S5 als Risiko geführt.

## 4. Zustände

### 4.1 KitchenItem

```mermaid
stateDiagram-v2
  [*] --> queued: order.created → Routing
  queued --> scheduled: Plan mit späterem Start
  queued --> due: Plan "sofort"
  scheduled --> due: Startsignal (Timer oder Anker gestartet)
  due --> started: Start-Bump (nur bumpMode dual)
  due --> done: Fertig-Bump (bumpMode single)
  started --> done: Fertig-Bump
  done --> served: Expo bestätigt
  done --> due: Recall
  queued --> voided
  scheduled --> voided
  due --> voided
  started --> voided: Storno (Quittieren nötig)
  served --> [*]
  voided --> [*]
```

Die Eskalationsstufe ist **kein** Zustand. Sie wird aus `dueAt`, `now` und den Schwellen abgeleitet:

```mermaid
flowchart LR
  A[scheduled / due] -->|now ≥ dueAt − x| B(due-soon)
  B -->|now ≥ dueAt| C(due)
  C -->|nicht gestartet, now ≥ dueAt + Toleranz 1| D(late: Station + Expo)
  D -->|now ≥ dueAt + Toleranz 2| E(forgotten: Alarm Expo/Leitung)
```

### 4.2 KitchenTicket (Grobzustand, synchronisierter Vertrag, G4)

```mermaid
stateDiagram-v2
  [*] --> queued: Ticket angelegt
  queued --> in_progress: erstes Item started/done
  in_progress --> ready: alle nicht stornierten Items done
  ready --> in_progress: Recall eines Items
  ready --> served: Expo bestätigt
  queued --> voided: alle Items voided
  in_progress --> voided: alle Items voided
  served --> [*]
  voided --> [*]
  note right of ready
    künftiger additiver Hook
    ready → Order produced (Lager)
  end note
```

## 5. Entitäten (Übersicht nach S4)

| Entität | Persistiert | Ort | Sync | Schlüsselfelder |
|---|---|---|---|---|
| `Station` | ja | Cloud-Pflege → Edge | pull | `type`, `capacity`, `bumpMode`, `bumpPolicy`, `visibilityPolicy`, `startTrigger`, Schwellen |
| `RoutingRule` | ja | Cloud-Pflege → Edge | pull | Bedingung, Ziel-Station(en), Priorität; Fallback-Station je Filiale |
| `KitchenTicket` | ja | Edge (bzw. Cloud bei Connect) | Grobzustand + ETA → push | `orderId` (1:1), `settlementScope`, Grobzustand, Ziel, `estimated \| anchored` |
| `KitchenItem` | ja, TTL | Edge | **nein** (nur Aggregate) | `ticketId`, `lineItemId`, `stationId`, Zustand, Zeitstempel, `seq` |
| `KitchenAggregate` | ja | Edge → Cloud | push | Produkt × Station × Stunde: n, Summe, Buckets |
| `PrepTimeProfile` | ja | Edge (lokal gelernt) + Cloud-Parameter | pull (Parameter) | konfiguriert, gelernt, n, Streuung |
| `ItemDependency` | nein | Scheduler | — | abgeleitet |

## 6. Ablage

- Das C4-Modell liegt in panary-cloud unter `docs/architecture/c4/model/kds.c4` und `views/kds.c4`. Die C4-Blöcke oben sind daraus erzeugt (Stand 2026-11-01). Bei Abweichung gilt das LikeC4-Modell.
- Die Entscheidungen stehen in ADR 0065–0067, die Umsetzung im [Briefing](kds-v1-briefing.md).
