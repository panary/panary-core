---
type: ADR
title: 'KDS — Repo-Zuordnung und Edge/Cloud je Tarif'
description: 'KDS-Domäne, Projektion und Basis-Scheduling in panary-core, Konfigurations-UI und filialübergreifende Auswertung in panary-cloud; Pilot über den Edge, Connect cloud-direkt erst nach Tarifrevision, Pairing-Gate, Lastmessung und Replay.'
tags: [kds, architecture, tenants, subscriptions, edge, api-cloud, realtime]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-11-01T00:00:00Z }
---

# KDS — Repo-Zuordnung und Edge/Cloud je Tarif

> Setzt [ADR 0065](0065-kds-laufzeit-topologie.md) Option B voraus. Belege: [KDS-Befund](../architecture/kds-befund-ist-stand.md) („Befund §x").

## Entscheidungsstand (G2/G3, Michael, 2026-11-01)

- **G2: Split, Open-Core-Grenze nach Variante c** ([S3-Nachtrag](../architecture/kds-bewertungen-skalierung-open-core.md) §2).
  - core (BSL-1.1) enthält alle Mechanismen und das lokale Lernen.
  - Die Cloud liefert, was nur aus vielen Filialen und Historie entsteht (Kaltstart-Zeiten, Tageszeit-Muster, Benchmarks, Prognose für Storefront und Voice), und zwar als **Parameter per Sync**, nicht als Code.
- **G3: Connect cloud-direkt ist Ziel**, freigegeben erst nach V1–V5. Pilot und v1 laufen über den Edge.
- **Ergänzung aus dem Nachtrag:**
  - Der Edge synchronisiert Küchenzeiten als **Aggregate** je Produkt × Station × Zeitfenster.
  - Rohdaten von `KitchenItem` bekommen eine TTL.

## Problem

Zwei getrennte Fragen:

1. **Repo:** Wo liegen Entitäten, Logik und UI des KDS?
   - panary-core ist Open Core, exportiert Schemas per GitHub Packages und betreibt Edge und POS.
   - panary-cloud ist geschlossen und betreibt Admin und Storefront.
2. **Topologie je Tarif:** Hängt ein KDS bei Connect-Kunden ohne Edge direkt an der Cloud? Was passiert bei Ausfällen?

Michael tendiert zu „auch Connect cloud-direkt" und will die Last für die Cloud bewertet sehen.

Ausgangslage:

- **Tarif:** ADR 0006 (core) legt „Das ganze Gehirn in jedem Plan" fest. Differenziert wird über Betriebs-Capability. Operate ist dort ausdrücklich „+ physischer Print-Server/**KDS**".
- **Präzedenz für das Entkoppeln** einer Capability von `offlinePos`: Die Teilrevision vom 2026-05-27 hat `fiscalCashier` als eigenes Add-on abgetrennt. Cloud-direktes fiskalisches Kassieren ist seitdem ein erstklassiger Pfad (ADR 0005/0006).
- **Pairing in der Cloud verlangt `offlinePos`**, fail-closed. Connect bekommt 403 (Befund F2, cloud `apps/api-cloud/src/device-pairing.ts:199-223`).
- **Feature-Flags erreichen Edge und POS nicht** (cloud ADR 0024, Nicht-Ziel v1). Der Erweiterungspfad §15 nennt einen „edge-token-scoped Read oder ein Sync-Feld" (Befund F4).
- **api-cloud ist Single-Instance** ohne Socket.IO-Adapter. Zu Socket-Last gibt es keine Messung (Befund §3.2).
- **Schema-Export:** core-Release per `v*`-Tag, danach ein Pin-Bump in cloud (Befund §3.6).

## Frage 1: Repo

| Option | Inhalt | Bewertung |
|---|---|---|
| **core komplett** | Domäne, Projektion, Scheduler, KDS-UI, Admin-UI im admin-client | Der Edge braucht alles offline. Die Konfiguration der Stationen pflegt die Cloud aber für alle Filialen (wie Drucker: cloud-zentral, unidirektional an den Edge, Befund §3.4) |
| **cloud komplett** | alles in cloud | **scheidet aus**: Der Edge kann cloud-Code nicht laufen lassen, und der Pilot ist Operate |
| **Split (empfohlen)** | **core:** `libs/domains/kitchen/domain` (Schemas `Station`, `RoutingRule`, `KitchenTicket`, `KitchenItem`, `PrepTimeProfile`), Routing, Projektion, Scheduler-Strategien inkl. gelerntem Basisschätzer, Edge-Services, KDS-UI im pos-client. **cloud:** Konfigurations-UI (Stationen, Routing, Schwellen) in `feature-admin`, Cloud-Services für Connect, filialübergreifende Auswertung (Prognosegüte, Benchmarks), später trainierte Parameter als Sync-Daten an den Edge | Folgt dem bestehenden Muster: Schema in core, Verwaltung in cloud, Sync an den Edge |

**Open-Core-Abwägung**

- Der Basisschätzer gehört nach core: ein gleitendes Mittel bzw. P50/P80 je Produkt × Station. Er muss am Edge offline laufen und ist kein Geschäftsgeheimnis.
- Proprietär bleiben kann, was **nur mit Daten vieler Filialen** entsteht. Das ist die eigentliche Differenzierung. Sie läuft in der Cloud und erreicht den Edge nur als **Parameter**, nicht als Code.
- Das Strategy-Interface `ScheduleStrategy` ([ADR 0067](0067-kds-kuechen-projektion-und-scheduling.md)) hält die Tür für eine geschlossene Implementierung offen, ohne dass core davon abhängt.

**Kosten des Splits**

- Jede Schemaänderung braucht ein core-Release und einen cloud-Pin-Bump (Befund §3.6).
- Neue Felder an Sync-Records müssen in den Sync-Allowlisten und Felddeklarationen beider Seiten nachgezogen werden.

## Frage 2: Topologie je Tarif

### Matrix Tarif × Topologie × Verhalten bei Ausfall

| Tarif | Topologie | Internet weg | Edge weg | Cloud-Instanz weg / Deploy |
|---|---|---|---|---|
| **Operate** (Pilot) | POS → Edge ← KDS (LAN, mDNS) | **Küche läuft**, Sync holt nach | Kasse und Küche verlieren den Edge. Rückfall Küchenbon? (Drucker hängen am Edge-Print-Server, siehe Risiko R3) | ohne Wirkung auf die Küche |
| **Connect** (cloud-direkt) | POS-Gerät/Browser → Cloud ← KDS | **Küche blind**, genauso wie die cloud-direkte Kasse: Beide verlieren ihre einzige Quelle. Konsistent, aber ohne Rückfall | — | **alle Connect-Küchen aller Tenants gleichzeitig blind** (Single-Instance, ADR 0033) |
| Enterprise | wie Operate, optional mehrere Edges | wie Operate | wie Operate | wie Operate |
| *Mini-Edge* (ein KDS-Gerät als Hub) | Gerät hält Projektion lokal | Küche läuft | — | — |

*Mini-Edge* ist **vertagt**: Es ist eine eigene offene Entscheidung der Edge-Hub-Roadmap und braucht Persistenz, Pairing und Sync auf dem Gerät.

**Folgerung:** „Kasse steht = Küche steht" ist bei Connect ehrlich und für den Kunden verständlich. Kritisch ist der Cloud-weite Ausfall (Deploy, OOM). Er trifft heute schon alle Edges (ADR 0033). Mit KDS träfe er zusätzlich laufende Küchen.

### Was Connect cloud-direkt voraussetzt

| # | Voraussetzung | Beleg / Präzedenz |
|---|---|---|
| V1 | **Teilrevision ADR 0006**: eigener Plan-Key (camelCase, Vorschlag `kitchenDisplay`), entkoppelt von `offlinePos` | Präzedenz `fiscalCashier` (2026-05-27) |
| V2 | **Pairing-Gate**: `device-pairing.ts` und `devices.create` lassen Gerätetyp `kds` mit `kitchenDisplay` statt `offlinePos` zu | Befund F2 |
| V3 | **Lastmessung** der Echtzeitkanäle (unten), vor der Freigabe für Connect | Befund §3.2 |
| V4 | **Replay nach Reconnect**: verpasste Küchen-Events, sonst fehlen bei jedem Funkloch Positionen | [ADR 0067](0067-kds-kuechen-projektion-und-scheduling.md) |
| V5 | Kläre, was „Cloud-POS / Online-Bons" für Connect heute konkret ist. Kein Gerät kann sich koppeln. Woher kommen dann die Bestellungen, die ein Connect-KDS anzeigen soll? | cloud `docs/domains/freemium-basic-tier-plan.md:33-37` |

Ohne V1–V4 bleibt das KDS faktisch Operate-only.

### Lastbewertung Cloud (ohne Zahlen, weil es keine Messung gibt)

**Mechanismen, die mit der Zahl der Geräte wachsen** (belegt):

1. Jedes Gerät ist dauerhaft Mitglied des Tenant- bzw. Location-Channels. Pro Event filtert `readableChannel` über **alle** Verbindungen des Tenants (cloud `channels.ts:700-732`).
2. Connect und Disconnect stempeln `devices.lastSeen` per Mongo-Patch (cloud `channels.ts:99-120`). Ein Reconnect-Sturm, etwa nach einem Deploy, ergibt N Schreibvorgänge auf einmal.
3. Die Online-Zählung liest `app.io.sockets` des eigenen Prozesses (cloud `docs/architecture/geraete-online-tracking.md`). Ein Scale-out bricht sie.
4. Kein Socket.IO-Adapter: Mehr als eine Instanz geht nur mit Redis-Adapter und Umbau der prozesslokalen Zähler (Rate-Limit, Flag-Cache, Online-Tracking).

**Hypothese:** Für die ersten Connect-Küchen ist die Single-Instance kein Kapazitätsproblem, aber ein **Verfügbarkeitsproblem**, weil Deploy und OOM alle gleichzeitig treffen. Die Last steigt mit Geräten × Events je Tenant. Ein KDS erzeugt mehr Events als ein Admin, weil jeder Bump ein Event ist.

**Messaufbau (V3)**

- Wegwerf-Instanz von api-cloud mit Wegwerf-Mongo (Memory `reference_wegwerf_mongo_messaufbau`).
- N simulierte KDS-Sockets: N = 10 / 100 / 500, verteilt auf 1 / 10 / 50 Tenants.
- Gemessen werden:
  - Speicher je Socket
  - Event-Latenz p95 von Bump zu Empfang
  - CPU bei 1 / 10 Bumps je Sekunde und Tenant
  - Dauer und Mongo-Last eines Reconnect-Sturms aller N
- Ergebnis als Entscheidungsgrundlage für G3. Eine Instanz reicht bis X Geräte, darüber braucht es einen Adapter.
- **Der Pilot hängt davon nicht ab.**

### Feature-Flag am Edge

Ein Flag (Vorschlag `kitchenDisplay` für den Rollout, `kitchenSmartScheduling` für die Planung) wirkt laut ADR 0024 nur in Cloud-Admin und api-cloud.

Für das KDS am Edge braucht es einen der beiden Wege aus §15:

- **(a)** Flag-Zustand als Sync-Feld an den Edge,
- **(b)** ein edge-token-gebundener Lesezugriff.

**Vorschlag:** (a). Der Edge braucht den Zustand offline, und das Muster „cloud pflegt, Edge liest per Sync" gibt es schon für die Drucker. Das ist ein eigener cloud-PR und für das KDS am Edge Vorbedingung, wenn die Flag-Pflicht gelten soll.

**Abzustimmen:** Ist für den Piloten ein Plan- oder Gerätetyp-Gate ausreichend statt eines Flags? Das KDS-Gerät existiert nur, wenn es gekoppelt wurde.

## Entscheidung

1. **Repo: Split.** Domäne, Projektion, Basis-Scheduling, Edge-Services und KDS-UI in **core**. Konfigurations-UI, Connect-Services und filialübergreifende Auswertung in **cloud**.
2. **Topologie:**
   - v1 und der Pilot laufen **über den Edge** (Operate).
   - **Connect cloud-direkt** wird als Ziel festgehalten, aber erst nach V1–V5 freigegeben.
   - Das Domänenmodell ist von Anfang an topologieneutral: Dieselbe Lib läuft in api-edge und api-cloud ([ADR 0065](0065-kds-laufzeit-topologie.md) B).
3. **Mini-Edge** ist vertagt (Edge-Hub-Roadmap).

## Konsequenzen

- Für den Piloten keine Tarif- und keine Cloud-Lastarbeit. Er nutzt Pairing, mDNS und Channels des Edge.
- Für Connect stehen fünf Vorbedingungen fest. Jede wird ein eigenes Issue, eines davon eine Teilrevision von ADR 0006.
- Ein cloud-weiter Ausfall trifft künftig auch Küchen. Ein Grund mehr, Single-Instance und Deploy-Verhalten früher anzugehen.
- **Risiken:**
  - **R1:** Die Pflege der Stationen in der Cloud setzt den Sync der Konfiguration an den Edge voraus. Er muss in Sync-Allowlist und Felddeklarationen eingetragen sein.
  - **R2:** Mehraufwand für das Release (core-Release, dann cloud-Pin-Bump).
  - **R3:** Rückfall „Küchenbon bei KDS-Ausfall" ist bei Edge-Ausfall nur nützlich, wenn der Druck nicht selbst am Edge hängt. Für [ADR 0067](0067-kds-kuechen-projektion-und-scheduling.md)/S4 klären.

## Quellen

- ADR 0005, 0006 (core)
- cloud ADR 0024 §15, 0033
- cloud `apps/api-cloud/src/device-pairing.ts`, `apps/api-cloud/src/channels.ts`
- cloud `docs/domains/freemium-basic-tier-plan.md`
- Befund §3.2–3.6, F2, F4
