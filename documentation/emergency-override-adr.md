---
title: ADR — Emergency-Override für Drucker-Konfiguration im Edge
date: 2026-05-14
category: Architektur-Entscheidungen
domains: [cloud-connection, locations, sync]
status: accepted
---

# ADR: Emergency-Override für Drucker-Konfiguration im Edge

## Problem

Im Cloud-zentralen Stammdaten-Modell ist die panary-cloud ab dem Pairing die Source of Truth für `location.settings`. Der `cloudManaged()`-Hook im Edge blockt jeden externen Schreibzugriff auf `locations`, sobald die Edge eine aktive Cloud-Connection hat. Das verhindert Drift — ist aber ein operationeller Showstopper bei Cloud-Ausfall:

> Im Ladengeschäft fällt der Bondrucker aus, ein neuer wird angeschlossen und braucht eine andere IP. Cloud ist gerade nicht erreichbar (ISP-Ausfall, Cloud-Wartung, …). Ohne Override kann der Edge die Drucker-Konfig nicht akzeptieren → der Betrieb steht.

## Entscheidung

Wir aktivieren bei Cloud-Heartbeat-Ausfall einen **eng begrenzten Notfall-Modus**:

1. **Trigger:** ≥ 3 konsekutive Heartbeat-Fehler **ODER** > 5 min seit letztem erfolgreichem Heartbeat.
2. **Whitelist:** Nur Patches, deren Datenobjekt **ausschließlich** `settings.printSettings` modifiziert, werden am Edge zugelassen. Andere Settings-Bereiche (Öffnungszeiten, Tische, Pager) bleiben gesperrt.
3. **Persistenz separat:** Override-Patches werden NICHT in die Sync-Outbox geschrieben, sondern in eine eigene SQLite-Tabelle `pending-local-overrides`. Sonst würden sie beim Cloud-Reconnect blind die Cloud-Werte überschreiben.
4. **Reconciliation:** Beim nächsten erfolgreichen Heartbeat schickt der Edge die gepufferten Patches an `POST /sync-reconcile-overrides`. Die Cloud entscheidet pro Feld:
   - Cloud-Wert unverändert seit Override → Edge-Wert übernehmen (Fast-Path)
   - Cloud-Wert geändert → Konflikt: Cloud bleibt Wahrheit, Edge-Eintrag erhält `status='CONFLICT'`
5. **Override-Deaktivierung:** `emergencyOverride` wird auf `false` zurückgesetzt, sobald alle pending Overrides abgearbeitet sind (kein Konflikt mehr offen).

## Begründete Konsequenzen

### Warum nur Drucker, nicht alle Settings?

Drucker-Konfigurationen sind das einzige Settings-Feld mit **akuter Hardware-Abhängigkeit**: Ein neu angeschlossener Drucker funktioniert ohne IP-Update nicht. Andere Bereiche (Öffnungszeiten, Steuern, Tische) ändern sich nicht akut — sie können auf den Cloud-Reconnect warten. Kleinste Angriffsfläche für Divergenzen.

### Warum nicht bidirektional + LWW?

LWW (Last-Write-Wins) zwischen zwei aktiven Mastern produziert "Lost-Update"-Bugs, die schwer zu mental modellieren sind. Edge-Patches sind im Normalbetrieb gesperrt — Override ist eine bewusste Ausnahme mit eigener Persistenz-Spur, eigenem Reconcile-Flow und eigenem UI-Indikator. Das hält das mentale Modell für 99 % der Operations klar (Cloud = Wahrheit).

### Warum Cloud-Werte gewinnen im Konflikt?

Konflikte können nur entstehen, wenn jemand parallel in der Cloud editiert hat, während der Edge im Override war. In der Praxis ist das selten (Cloud-Ausfall = niemand kann editieren) — und wenn doch, ist die Cloud-Edit meist die fundiertere (Admin im Backoffice sieht den ganzen Betrieb, Edge-Operator sieht nur sein Gerät vor sich). Edge-Eintrag bleibt sichtbar als `CONFLICT` für manuelle Auflösung (Folge-Phase).

### Warum 3 Failures ODER 5 min?

- **3 konsekutive Failures** (≈1,5 min bei 30 s Tick) fängt akute Ausfälle schnell.
- **5 min absolut** fängt Edge-Cases, bei denen der Scheduler länger pausiert hat (Restart, Worker-Crash, etc.) und der Failure-Counter nicht hochläuft.

Beide Trigger zusammen = robuste Erkennung ohne unnötige False-Positives (ein einzelner verlorener Heartbeat aktiviert keinen Override).

## Implementierung

### Edge (panary-core)

| Komponente | Datei |
|---|---|
| Heartbeat-Schwelle | `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts` |
| Whitelist im `cloudManaged()` | `apps/api-edge/src/hooks/cloud-managed.hook.ts` |
| Override-Persistenz | `apps/api-edge/src/hooks/record-emergency-override.hook.ts` |
| SQLite-Migration | `apps/api-edge/migrations/20260514000001_cloud_connection_emergency_override.ts` + `20260514000002_pending_local_overrides.ts` |
| Reconciliation-Push | `runReconcileOverrides()` in `cloud-sync-scheduler.worker.ts` |
| Schema-Felder | `libs/domains/cloud-connection/domain/src/lib/cloud-connection.schema.ts` (Edge-only Felder) |

Edge-only Felder im `CloudConnection`-Schema (werden NICHT zur Cloud synct):

- `emergencyOverride: boolean`
- `emergencyOverrideSince: string`
- `lastHeartbeatOk: string`
- `consecutiveHeartbeatFailures: number`

### Cloud (panary-cloud)

| Komponente | Datei |
|---|---|
| Reconciliation-Endpoint | `apps/api-cloud/src/services/sync/sync.ts` (`buildReconcileOverridesService`) |
| Endpoint-Pfad | `POST /sync-reconcile-overrides` |
| Schemas | inline im Service (request: `{ overrides[] }`, response: `{ accepted, conflicts }`) |

## Wide-Event-Logs

| Event | Felder |
|---|---|
| `emergency-override.activated` | `consecutiveFailures`, `elapsedMsSinceLastOk`, `reason` |
| `emergency-override.patch-allowed` | `locationId`, `tenantId`, `diffCount`, `fieldPaths` |
| `emergency-override.deactivated` | — |
| `emergency-override.persist_error` | `locationId`, `errorMessage` |
| `reconcile.fast-path` | `acceptedCount`, `conflictCount=0` |
| `reconcile.with-conflicts` | `acceptedCount`, `conflictCount` |
| `reconcile.cloud_error` | `status`, `body` |
| `reconcile.worker_exception` | `errorMessage` |

## Offene Punkte / Folge-Phasen

- **Konflikt-UI im Cloud-Admin:** Banner auf der Drucker-Settings-Seite, wenn `pending-local-overrides`-Einträge mit `status='CONFLICT'` existieren. Picker-Dialog für „Edge übernehmen / Cloud behalten / Feld-für-Feld mergen". Aktuell bleiben Konflikte sichtbar in der Edge-DB; der Notfall-Modus bleibt aktiv, bis sie aufgelöst sind.
- **Override-Kontroll-Switch im Edge-Admin:** UI-Banner „Notfall-Modus aktiv" mit einem Button „Sofort beenden (alle lokalen Änderungen verwerfen)" als Notausgang.
- **Sync-Conflicts-Collection in Cloud:** persistente Audit-Spur der Konflikt-Resolutions (heute nur Wide-Event-Log).
- **Tests:** Vitest-Coverage für `cloud-managed.hook.spec.ts` (Override-Whitelist), `cloud-sync-scheduler.worker.spec.ts` (Heartbeat-Schwelle + Reconcile), `record-emergency-override.hook.spec.ts` (Diff-Korrektheit).
