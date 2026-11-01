---
type: Report
title: 'KDS — S3-Nachtrag: Cloud-Skalierung, Open-Core-Grenze, Rückspiegelung'
description: 'Drei Bewertungen auf Michaels Rückfragen zu G1, G2 und G4: Wie skaliert KDS-Last in der Cloud, wo liegt der proprietäre Mehrwert unter BSL-1.1, und wann braucht es einen Küchenzustand am Order-Kopf.'
tags: [kds, architecture, scaling, licensing, orders]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-01T00:00:00Z }
---

# S3-Nachtrag: drei Bewertungen

**Bestätigt:**

- **G3:** Connect cloud-direkt ist Ziel und kommt erst nach V1–V5.
- **G1 am Edge:** modularer Monolith.

**Offen:**

- G1 in der Cloud
- G2 (Grenze des Open Core)
- G4 (Rückspiegelung)

## 1. KDS-Last in der Cloud bei Hunderten bis Tausenden Kunden (G1, Cloud-Seite)

### Größenordnung

Das ist eine Überschlagsrechnung. **Alle Annahmen sind gesetzt, nichts davon ist gemessen.**

| Annahme | Wert |
|---|---|
| Filialen mit KDS | 1 000 (Szenario M) / 10 000 (Szenario L) |
| Bestellungen je Filiale und Tag | 500 |
| davon in der Spitzenstunde | 15 % |
| Positionen je Bestellung | 4 |
| Events je Position | 4 (`queued`, `started`, `done`, `served`), dazu selten `voided` |
| Geräte je Filiale, die Events empfangen | 5 (3 Stationen, Expo, Kasse) |

| Größe | Szenario M (1 000) | Szenario L (10 000) |
|---|---|---|
| Küchen-Events je Tag | 8 Mio. | 80 Mio. |
| Mittel je Sekunde | ~90 | ~900 |
| **Spitze je Sekunde** (15 % in einer Stunde) | **~330** | **~3 300** |
| Socket-Nachrichten Spitze (× 5 Empfänger) | ~1 700/s | ~17 000/s |
| gleichzeitige Sockets | ~5 000 | ~50 000 |
| neue Datensätze je Tag (1 Item = 1 Datensatz, Updates in place) | 2 Mio. | 20 Mio. |

Michaels Intuition stimmt also: Es werden schnell Millionen Events am Tag. Je Sekunde ist das aber eine überschaubare Rate.

**Engpass in Szenario M:** nicht der Durchsatz, sondern vier strukturelle Punkte, die schon heute im Code stecken (Befund §3.2):

1. **Fan-out je Tenant statt je Filiale.** Der Publisher filtert jedes Event über alle Verbindungen des Tenants (cloud `channels.ts:700-732`). Ein Tenant mit 50 Filialen und 250 Geräten zahlt 250 Prüfungen je Bump, obwohl 5 Geräte gemeint sind.
2. **Single-Instance.** Verfügbarkeit, nicht Kapazität: Ein Deploy oder OOM trifft alle Küchen gleichzeitig.
3. **Prozesslokaler Zustand:** Online-Zählung, Rate-Limit und Flag-Cache verhindern die horizontale Skalierung.
4. **Ein Mongo-Patch je Connect/Disconnect** (`lastSeen`). Ein Reconnect-Sturm nach einem Deploy bedeutet 5 000 bzw. 50 000 Schreibvorgänge auf einmal.

**Szenario L** braucht zwingend mehrere Instanzen (50 000 Sockets, 17 000 Nachrichten/s).

### Der größte Hebel: Wo Echtzeit überhaupt anfällt

- **Operate-Kunden (mit Edge):** Echtzeit-Events entstehen und enden **am Edge**. In die Cloud gehen nur gebündelte Zeitstempel per Outbox (Batches bis 100, `sync-push.schema.ts:6`).
  - Besser noch: nur **Aggregate** je Produkt × Station × Zeitfenster (Anzahl, Summe, Histogramm-Buckets) statt Rohzeilen.
  - Damit sinkt die Cloud-Last von ~4 Events je Position auf **eine Aggregatzeile je Produkt, Station und Stunde**.
  - Bei 1 000 Filialen mit je 40 Produkt-Stations-Paaren und 14 Betriebsstunden sind das ~560 000 Zeilen am Tag statt 8 Mio. Events.
- **Connect-Kunden (cloud-direkt):** Nur sie erzeugen Echtzeit-Last in der Cloud.
  - Wie viele Connect-Kunden ein KDS wollen, ist eine Produktfrage.
  - Ein Connect-Kunde mit mehreren Stationen und Ausgabe ist operativ ein Operate-Kandidat.

**Folgerung:** Der Edge ist für das KDS auch ein **Lastschutz für die Cloud**, nicht nur Resilienz. Das stützt ADR 0006: KDS als Betriebs-Capability.

### Architektur für den Cloud-Pfad: von Anfang an nach Filiale partitionierbar

Der Küchenzustand ist **strikt filiallokal**. Ein Ticket, eine Station, eine Warteschlange gehören zu genau einer `locationId`, und der Scheduler braucht nie Daten einer anderen Filiale.

Das ist der günstigste Fall für horizontale Skalierung:

1. **Jetzt (v1, ändert nichts am Edge):**
   - Küchen-Events werden in der Cloud **nur im Location-Channel** publiziert, nie im Tenant-Channel. Sie kommen auf die Liste `ROLE_RESTRICTED_PUBLISH_SERVICES` bzw. in einen eigenen Publisher.
   - Der Scheduler bleibt eine reine Funktion. Der Zustand liegt in Mongo, nicht im Prozess.
2. **Connect-Freigabe (V3):**
   - Lastmessung ([ADR 0066](../adr/0066-kds-repo-zuordnung-und-edge-cloud.md)).
   - `lastSeen` nicht mehr bei jedem Connect patchen, sondern drosseln oder sammeln.
3. **Ab einer gemessenen Schwelle:**
   - Ein eigener **Kitchen-Realtime-Dienst** in der Cloud (Option C, aber nur dort), horizontal skaliert.
   - Jede Filiale ist per konsistentem Hashing über `locationId` genau einer Instanz zugeordnet (Sticky Sessions am Load Balancer).
   - Ein Socket.IO-Redis-Adapter wird nur für Querschnitts-Events gebraucht.
   - Dieselbe Lib wie am Edge ([ADR 0065](../adr/0065-kds-laufzeit-topologie.md) B), nur ein anderer Host-Prozess.
4. **Speicher:**
   - Rohdaten der `KitchenItem` mit TTL (Vorschlag 90 Tage).
   - Dauerhaft bleiben nur die Aggregate und `PrepTimeProfile`.
   - Ohne TTL wären es bei Szenario M ~730 Mio. Datensätze im Jahr.

**Vorschlag G1 (präzisiert):**

- **B überall jetzt.**
- In der Cloud ist der Weg zu **C nur für die Cloud** schon angelegt: Filial-Partitionierung, Location-Channel, Zustand nicht im Prozess, TTL, Edge-Sync als Aggregate.
- Der Wechsel wird fällig, wenn die Messung aus V3 die Grenze einer Instanz zeigt oder Connect-KDS freigegeben wird.

## 2. Open-Core-Grenze: Wo der Mehrwert liegt (G2)

### Lizenz: core ist nicht Open Source im engen Sinn, sondern BSL-1.1

`panary-core/LICENSE`:

- **Additional Use Grant:** Die Nutzung ist erlaubt, außer als POS-, ERP- oder Food-Service-Produkt, das Dritten konkurrierend angeboten wird.
- **Ausdrücklich erlaubt** ist der Betrieb des eigenen Betriebs, also auch einer selbst gehosteten Gastronomie.
- **Change Date** 2030-11-01, danach Apache 2.0.

*(Das ist eine Lesart, keine Rechtsberatung.)*

Daraus folgt:

- Ein **Konkurrent** darf das KDS aus core vier Jahre lang nicht als Produkt anbieten. Der Schutz gegen Nachbau als Dienstleistung besteht schon.
- Ein **Gastronom** darf core selbst hosten und das KDS kostenlos nutzen. Das ist die eigentliche „Lücke".

Ob sie relevant ist, entscheidet die Zielgruppe. Selbsthosting heißt: kein Cloud-Admin, keine Filialverwaltung, kein Sync, keine Updates, keine Hardware, kein Support. Wer das kann, war selten zahlender Kunde.

### Optionen

| Option | Wie | Bewertung |
|---|---|---|
| **a) Alles in core** | Das gesamte KDS inkl. gelerntem Schätzer ist BSL | Einfach. Der Mehrwert für zahlende Kunden liegt dann in Betrieb und Cloud, nicht im Code |
| **b) Geschlossenes Paket im Edge-Image** | Privates npm-Paket aus GitHub Packages, das das offizielle Edge-Image einbindet und `ScheduleStrategy` implementiert. Builds aus dem offenen Code fallen auf `fire-by-prep-time` zurück | Technisch machbar. Aber der Code läuft auf Kundenhardware und ist als JS lesbar (Verschleierung ist schwach). Lizenzprüfung bräuchte Online-Kontakt, also Konflikt mit offline. Dazu zwei Build-Varianten und eine Glaubwürdigkeitsfrage beim Open Core |
| **c) „Code offen, Intelligenz aus Daten" (empfohlen)** | core enthält alle **Mechanismen**: Projektion, Routing, alle Strategien und den lokalen Basisschätzer (lernt aus den eigenen Daten der Filiale). Die **Cloud** liefert, was nur mit vielen Filialen und viel Historie entsteht, und zwar als **Parameter per Sync**, nicht als Code | Funktioniert offline. Der Edge braucht keinen geschlossenen Code. Der Mehrwert ist nicht kopierbar, weil er in den Daten liegt, nicht im Algorithmus |

### Was in Variante c) konkret in die Cloud gehört

1. **Kaltstart-Zeiten:** Vorschläge für neue Produkte und Filialen aus vergleichbaren Betrieben, statt `productionTime` von Hand zu pflegen.
2. **Muster nach Tageszeit und Wochentag:** Auslastungsprognose für Freitag 18 Uhr aus Wochen der Historie, nicht nur aus der aktuellen Warteschlange.
3. **Prognose für Storefront und Voice:** Die laufen ohnehin in der Cloud.
4. **Auswertung und Benchmarks:** Filialvergleich, Stationsauslastung, Engpass-Hinweise im Admin.
5. **Vorlagen für Stationen** aus realen Konfigurationen.

Am Edge ohne Cloud gibt es ein vollständiges KDS mit lokalem Lernen. Das ist der faire Open-Core-Kern. Mit Cloud wird es spürbar besser, und genau das ist zahlbar.

Bei a/c gilt das „ganze Gehirn in jedem Plan" (ADR 0006) für das KDS als Software. Der Plan entscheidet nur über die Betriebsart: Edge oder cloud-direkt.

**Vorschlag G2:** Split nach Variante c. Variante b ist nur eine Rückfalloption, falls ein Algorithmus später nachweislich selbst der Mehrwert ist. Die Strategy-Schnittstelle hält dafür die Tür offen.

## 3. Rückspiegelung auf den Order-Kopf: Wann braucht man sie? (G4)

Michaels Sorge: in einigen Wochen doch umbauen zu müssen. Dafür habe ich die künftigen Konsumenten eines Küchenzustands durchgespielt.

| Künftiger Bedarf | Braucht | Liefert die Projektion das? |
|---|---|---|
| **Abholtafel / Kundendisplay** („Nr. 42 ist fertig") | Ticket-Zustand `ready` | **ja**, wenn das Ticket einen Grobzustand hat, am Edge per Socket |
| **Storefront-Bestellstatus / Push „fertig"** | `ready` **in der Cloud** | **nur, wenn der Ticketzustand zur Cloud synchronisiert wird.** Edge-Orders gehen per Outbox in die Cloud, die Projektion bisher nicht |
| **Lieferplattformen** (Status „ready for pickup") | `ready` in der Cloud, ereignisgetrieben | dito |
| **Voice-Ordering** („wie lange noch?") | Ticket-ETA in der Cloud | dito |
| **Lagerbuchung zum richtigen Zeitpunkt** (`→ produced`, `order.schema.ts:24-27`) | Order-Status `produced` | **nein, das braucht wirklich die Order.** Heute bucht der Hook ersatzweise bei `→ completed`. Es fehlt also nichts, es ist nur später |
| **Kassen-Übersicht „in Küche / fertig"** | Ticket-Zustand am Edge | **ja**, per Socket, wie das KDS |
| **Abrechnung / Tagesabschluss** | offener oder geschlossener Kreis | **nicht betroffen**: `active`, `production` und `produced` sind alle „offen" (`settlement-scope.ts:81-85`). Eine Spiegelung ändert daran nichts |
| **Auswertung Küchenzeiten** | Rohdaten oder Aggregate | **ja**, über die Aggregate (Abschnitt 1) |

**Ergebnis:**

- Fast alles, was künftig einen Küchenzustand braucht, braucht ihn **auf Ticket-Ebene und in der Cloud**, nicht im Feld `order.status`.
- Einzige echte Ausnahme ist die **Lagerbuchung bei `produced`**. Sie ist zugleich der riskanteste Teil einer Spiegelung (Teilstorno nach `produced` erzeugt eine Lager-Gegenbuchung) und heute durch `completed` abgedeckt.

### Vorschlag G4 (präzisiert): Umbausicher ohne Rückspiegelung in v1

1. **Eigene Projektion** mit einem **Grobzustand am `KitchenTicket`** schon in v1: `queued | in-progress | ready | served | voided`, abgeleitet aus den Items.
2. **Ticket-Grobzustand und ETA ab v1 per Outbox in die Cloud** als eigener synchronisierter Dienst. Das ist klein: ein Datensatz je Ticket, wenige Statuswechsel. So sind Storefront, Lieferplattformen, Voice und Abholtafel später **reine Leser**, ohne Umbau.
3. **Spiegelung `→ produced`** als späterer, **additiver** Schritt:
   - Ein Hook „Ticket `ready` → Order `produced`", sobald Lagerbuchung im Küchentakt gewünscht ist.
   - Vorher F1 beheben und das Verhalten bei Teilstorno entscheiden.
   - Das ist ein neuer Hook, kein Umbau der Projektion.
4. **F1** („storniert" bei `production`) wird unabhängig davon jetzt als Bug-Issue angelegt. Der Fehler bleibt sonst eine Falle für jeden, der den Status je setzt.

Was umbausicher macht, ist also nicht die Spiegelung. Entscheidend ist, **den Ticketzustand von Anfang an zu synchronisieren und als Vertrag zu behandeln.**

## Rückwirkung auf die ADRs (eingearbeitet)

- **[ADR 0065](../adr/0065-kds-laufzeit-topologie.md):** Abschnitt „Cloud-Pfad partitionierbar". Migrationsauslöser nach C werden auf „nur Cloud" präzisiert.
- **[ADR 0066](../adr/0066-kds-repo-zuordnung-und-edge-cloud.md):**
  - Variante c als Open-Core-Grenze mit BSL-Kontext.
  - Edge-Sync als Aggregate.
  - TTL für Rohdaten.
- **[ADR 0067](../adr/0067-kds-kuechen-projektion-und-scheduling.md):**
  - Grobzustand des Tickets als synchronisierter Vertrag.
  - Spiegelung `produced` als vorgemerkter additiver Hook.
