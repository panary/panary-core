---
type: ADR
title: 'KDS-Laufzeit-Topologie — Küchenmodul im Edge-Prozess hinter einem Vertrag, Cloud-Laufzeit offen'
description: 'Die Küchenlogik läuft am Edge als modularer Monolith in api-edge, getrennt von der Order-Domäne durch einen expliziten Vertrag; ob die Cloud ein Modul oder einen eigenen Dienst bekommt, wird nach Edge-Erfahrung entschieden, Go wurde bewertet und verworfen.'
tags: [kds, architecture, api-edge, api-cloud, realtime]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-11-01T00:00:00Z }
---

# KDS-Laufzeit-Topologie

> Grundlage: [KDS-Befund](../architecture/kds-befund-ist-stand.md), im Folgenden „Befund §x".

## Entscheidungsstand (G1, Michael, 2026-11-01)

- **Edge: Option B**, modularer Monolith in `api-edge`. Eine Filiale je Edge, also unkritische Last.
- **Cloud: bewusst offen.** Ob in der Cloud ein eigener Prozess oder ein eigener Dienst entsteht, entscheidet sich nach Erfahrungen mit dem Edge. Ein Dienst in anderer Sprache ist dabei nicht ausgeschlossen. Bewertungsgrundlage ist der [S3-Nachtrag](../architecture/kds-bewertungen-skalierung-open-core.md) §1: Lastmodell, Filial-Partitionierung, Aggregat-Sync.
- **Leitlinie „KDS separierbar halten"** (Michaels Intuition: andere Teams sollen daran arbeiten können, das KDS soll bei API-Neustarts und Deploys nicht mit neu starten):
  - Das Küchenmodul spricht mit der API **nur über einen expliziten Vertrag**: eingehende Order-Events über einen Port, ausgehende Küchen-Events und eigene Services.
  - Es greift nie direkt auf Order-Tabellen oder -Services zu.
  - So wird der Auszug in einen eigenen Prozess zur Umhängung, nicht zum Umbau.
  - Den Vertrag selbst (Events, Felder, Versionierung) legt S4 fest.

## Problem

Ein KDS braucht drei Laufzeitbausteine:

- ein **Routing**, das Positionen auf Stationen verteilt;
- eine **Küchen-Projektion** mit Zustand je Position und Station (siehe [ADR 0067](0067-kds-kuechen-projektion-und-scheduling.md));
- einen **Scheduler**, der Startzeiten, Eskalationen und eine Prognose berechnet und an Geräte verteilt.

Zu entscheiden ist, ob diese Bausteine im Prozess der bestehenden Feathers-API laufen (`apps/api-edge`, `apps/api-cloud`) oder als eigener Dienst.

Die Bausteine müssen **an beiden Enden** laufen. Am Edge ist das für den Piloten (Operate) Pflicht. In der Cloud wird es gebraucht, wenn Connect ein KDS bekommt ([ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md)).

Ausgangslage laut Befund:

- **Beide Server können schon an Geräte verteilen.** Sie haben Socket.IO, den Handshake per API-Key und `deviceId` und die Rolle `DEVICE_KDS` (Befund §3.2, §3.3).
- **Die Order-Domäne liefert die Daten**, und `lineItems` sind unveränderlich (Befund §3.1). Das KDS hängt eng an Order-Events: Neue Bestellung, Storno und Nachbestellung lösen jeweils Küchenaktionen aus.
- **Der Edge ist eine Node-Laufzeit** im Image `tools/docker/Dockerfile.edge`.
  - Einen eigenen Serverprozess in einer zweiten Sprache gibt es nicht.
  - Rust gibt es nur clientseitig in der Tauri-Hülle (ADR 0036).
  - `apps/tse-gateway` ist ein eigenständiger Node-Prozess mit eigenem Dockerfile, aber nicht im Edge-Compose eingebunden (Befund §3.6).
- **Team:** 1–2 Entwickler, ein Code-Owner.

## Optionen

| | Beschreibung |
|---|---|
| **A** | Küchen-Services und Hooks direkt in `apps/api-edge` bzw. `apps/api-cloud`, Logik in den Apps |
| **B** | Modularer Monolith: Domänen-Libs `libs/domains/kitchen/{domain,…}` mit Schema, Routing und reiner Scheduler-Funktion. Die Apps binden nur dünne Services ein. Gleicher Prozess, gleiches Deployment |
| **C** | Eigener Prozess bzw. Container in Node/TS. Er spricht mit der API nur über Events und Endpunkte |
| **C'** | Wie C, aber in **Go**. Auf Michaels Wunsch ausdrücklich bewertet, nicht als Strohmann |

## Kriterien

| Kriterium | A | B | C (Node) | C' (Go) |
|---|---|---|---|---|
| **Kopplung an die Order-Domäne.** Storno, Nachbestellung und Split kommen als Order-Events. | eng, ungeordnet | eng, aber hinter der Lib-Grenze | lose; braucht einen belastbaren Event-Kanal, den es **nicht gibt** (Befund §1.3) | wie C |
| **Latenz Storno → Küche < 500 ms** (marktüblich) | Hook im selben Prozess, ~ms | dito | ein Hop mehr (IPC/HTTP), unkritisch | dito |
| **Offline am Edge** | gegeben | gegeben | gegeben, aber ein zweiter Prozess muss laufen | dito |
| **Wiederverwendung Edge und Cloud** | doppelt implementiert in zwei Apps | **eine Lib**, zwei dünne Adapter (Knex/Mongo über die Feathers-Adapter-API) | ein Image für beide, aber eigene Persistenz und Auth | dito, ohne TypeBox |
| **Gemeinsame Schemas** (core exportiert TypeBox) | ja | ja | ja | **nein**: Codegen aus JSON-Schema oder Duplikat, also Drift-Risiko |
| **Scheduler-Last** (zustandsbehaftet, CPU-leicht: Dutzende Tickets je Filiale) | unkritisch | unkritisch | unkritisch | unkritisch, Go-Vorteil hier ohne Wirkung |
| **Prozess-Isolation** (Absturz trifft nicht die Kasse) | nein | nein | **ja** | **ja**, aber das liegt an C, nicht an Go |
| **Betrieb** (Image, Port, Healthcheck, Discovery, Updates) | 0 | 0 | +1 Container am Edge und +1 in Coolify | dito, dazu eine zweite Toolchain |
| **Test- und Replaybarkeit** | Feathers-Tests | **reine Funktion** `schedule(ticketState, now) → plan` ohne I/O, plus Feathers-Tests | Vertragstests über die Prozessgrenze nötig | dito, zwei Testwelten |
| **Teamgröße 1–2** | gut | gut | mäßig | schlecht: zwei Ökosysteme (Lint, Test, CI, Release) |
| **Open-Core-Grenze** | an die App gebunden | eine Lib ist veröffentlichbar (`publishable`) oder nicht, also klar ziehbar | klar | klar |
| **„Sequencing matters"** | — | Domänengrenze wird erst sauber | Microservice vor sauberer Grenze | dito |

### Go im Einzelnen

Michael hat gefragt, ob Go technologische Vorteile hätte. Die ehrliche Antwort ist kategorisiert und hat keine erfundenen Zahlen, weil es keine Messung gibt.

| Mögliches Go-Argument | Trägt es hier? |
|---|---|
| **Durchsatz und CPU** | Nein. Der Scheduler plant wenige Dutzend offene Tickets je Filiale und läuft bei Events, nicht in einer engen Schleife. Node reicht um Größenordnungen. |
| **Speicher und Startzeit** | Theoretisch ja: kleineres RSS, schneller Start. Praktisch spart es am Edge wenig, weil das Edge-Image ohnehin Node für `api-edge` mitbringt. Nur ein **Ersatz** von `api-edge` durch Go würde das ausnutzen, und das steht nicht zur Debatte. |
| **Einzel-Binary, einfache Verteilung** | Ein Vorteil für Geräte ohne Container. Hier läuft aber alles im Edge-Container. Für ein „KDS-Gerät als Mini-Edge" ([ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md)) wäre es interessant. Dafür käme eher ein Node-Bundle oder das schon vorhandene Rust in Tauri in Frage, nicht eine dritte Sprache. |
| **Robustheit** (Typsystem, keine `undefined`, gezielte Nebenläufigkeit) | Teils. Robuster wird der Dienst vor allem durch die **Prozessgrenze** (C), und die gibt es auch in Node. Das strikte TypeScript plus TypeBox-Validierung an der Grenze deckt die Typfrage im bestehenden Stack ab. |
| **Echtzeit-Fan-out** (viele Sockets) | Das ist ein Cloud-Thema ([ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md)). Dort ist der Engpass die Single-Instance ohne Adapter, nicht die Sprache. |

**Das kostet Go hier:**

- Die geteilten TypeBox-Schemas aus core lassen sich nicht nutzen. Codegen oder Duplikat bedeuten Drift-Risiko an genau der Stelle, an der KDS und Order zusammenpassen müssen.
- Eine zweite Kette für Lint, Test, CI und Release.
- Auth über API-Key und Device-Token sowie Multi-Tenancy-Hooks müssten nachgebaut werden. Das sind die sicherheitskritischen Teile (Befund §3.2, cloud `channels.ts`).

**Fazit Go:** Kein technischer Vorteil, der diese Kosten trägt, solange das KDS am bestehenden Node-Edge hängt. Neu zu bewerten wäre Go nur für ein geräteeigenes Mini-Edge ohne Container. Das ist ein eigener ADR, kein Teil von v1.

## Entscheidung

**Option B: modularer Monolith.**

- `libs/domains/kitchen/domain` in **panary-core**. Repo-Frage siehe [ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md).
  - Enthält TypeBox-Schemas, Routing-Auflösung und Scheduler als **reine Funktionen** ohne I/O und ohne Zeitquelle. `now` wird übergeben, deshalb sind die Funktionen replaybar.
- Dünne Feathers-Services je App (`api-edge` mit SQLite/Knex, `api-cloud` mit Mongo). Sie bauen die Küchen-Projektion aus Order-Events und verteilen sie über die bestehenden Channels.
- Feature-Libs für die UI (`libs/domains/kitchen/feature-kds-*`) im pos-client (G7, [ADR 0067](0067-kds-kuechen-projektion-und-scheduling.md)/AP5).
- **Harte Grenze trotz offener Nx-Boundaries** (core `eslint.config.mjs:26-31` erlaubt `* → *`):
  - `kitchen/domain` importiert aus `orders/domain` nur Typen.
  - Es gibt keinen Rückimport aus `orders` in `kitchen`.
  - Die Grenze ist per Tag-Regel oder Lint-Ausnahme durchgesetzt, nicht nur per Konvention. Für den PR vorgemerkt.

### Wann von B nach C

Ein Wechsel nach C (Node) wird fällig, sobald **einer** dieser Auslöser messbar eintritt:

1. Abstürze oder Speicherdruck im Scheduler gefährden nachweislich die Kasse am Edge.
2. Die Cloud muss den KDS-Fan-out getrennt von der API skalieren ([ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md), Lastmessung).
3. Das Smart-Scheduling braucht Modelle oder Bibliotheken, die nicht in den API-Prozess gehören (z. B. Python/ML).
4. Ein zweites Team übernimmt das KDS.

Weil der Scheduler eine reine Funktion in einer Lib ist, bedeutet der Wechsel einen neuen Host-Prozess um dieselbe Lib, keinen Neubau.

## Konsequenzen

- Kein zusätzliches Image, kein Port, kein Discovery-Ziel. Pairing, mDNS und Auth bleiben, wie sie sind (Befund §3.3).
- Das KDS erbt die Schutzschichten der API: Multi-Tenancy-Hooks, `serviceEvents`-Regel, Publish-Sperrlisten.
  - Neue Küchen-Services müssen dort eingetragen werden.
  - Die Event-Rechte für `DEVICE_KDS` müssen in beiden Rechte-Matrizen gepflegt werden (core `roles.matrix.ts`, cloud `channels-read-matrix.spec.ts`).
- Ein fehlerhafter Scheduler läuft im Prozess der Kasse. Abhilfe: Der Scheduler läuft nur ereignisgetrieben und begrenzt (Ticketzahl, Laufzeit). Fehler fängt er ab und meldet sie, statt zu werfen.
- **Offen** (nicht Teil dieses ADR): Replay und Ack für Geräte ([ADR 0067](0067-kds-kuechen-projektion-und-scheduling.md)), Last in der Cloud ([ADR 0066](0066-kds-repo-zuordnung-und-edge-cloud.md)).

## Quellen

- Befund §3.1–3.3, §3.6
- ADR 0036, ADR 0018 (core)
- `tools/docker/Dockerfile.edge`, `apps/tse-gateway/Dockerfile`
- cloud ADR 0033 (Single-Instance)
