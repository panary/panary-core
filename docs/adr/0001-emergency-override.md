---
type: ADR
title: ADR — Emergency-Override für Drucker-Konfiguration im Edge
description: ADR zum eng begrenzten Notfall-Modus, der bei Cloud-Ausfall Drucker-Konfig-Patches am Edge zulässt und beim Reconnect mit der Cloud reconciled.
tags: [cloud-connection, locations, sync]
status: stable
decision: accepted
generated: { by: claude-code/historic, at: 2026-05-14T00:00:00Z }
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
6. **Manueller Kontroll-Switch** (Nachtrag 2026-07-28): Der Operator kann den Notfall-Modus über den Edge-Admin gezielt aktivieren und beenden — siehe „Koexistenz mit der Automatik".

## Begründete Konsequenzen

### Warum nur Drucker, nicht alle Settings?

Drucker-Konfigurationen sind das einzige Settings-Feld mit **akuter Hardware-Abhängigkeit**: Ein neu angeschlossener Drucker funktioniert ohne IP-Update nicht. Andere Bereiche (Öffnungszeiten, Steuern, Tische) ändern sich nicht akut — sie können auf den Cloud-Reconnect warten. Kleinste Angriffsfläche für Divergenzen.

### Warum nicht bidirektional + LWW?

LWW (Last-Write-Wins) zwischen zwei aktiven Mastern produziert "Lost-Update"-Bugs, die schwer zu mental modellieren sind. Edge-Patches sind im Normalbetrieb gesperrt — Override ist eine bewusste Ausnahme mit eigener Persistenz-Spur, eigenem Reconcile-Flow und eigenem UI-Indikator. Das hält das mentale Modell für 99 % der Operations klar (Cloud = Wahrheit).

### Warum Cloud-Werte gewinnen im Konflikt?

Konflikte können nur entstehen, wenn jemand parallel in der Cloud editiert hat, während der Edge im Override war. In der Praxis ist das selten (Cloud-Ausfall = niemand kann editieren) — und wenn doch, ist die Cloud-Edit meist die fundiertere (Admin im Backoffice sieht den ganzen Betrieb, Edge-Operator sieht nur sein Gerät vor sich). Edge-Eintrag bleibt sichtbar als `CONFLICT` für manuelle Auflösung (Folge-Phase).

### Koexistenz mit der Automatik (Nachtrag 2026-07-28)

Ein einzelnes `emergencyOverride`-Boolean überlebt die Automatik nicht — jede Operator-Entscheidung würde binnen eines Ticks überschrieben. Zwei Ursachen, zwei Gegenmaßnahmen:

| Problem | Ursache | Feld |
|---|---|---|
| Manuelle **Aktivierung** verschwindet | Der Reconcile-Fast-Path deaktiviert den Modus, sobald null Overrides offen sind — **ohne jeden Cloud-Call**. Ohne gepufferte Patches wäre eine manuelle Aktivierung nach einem Sync-Tick weg. | `emergencyOverrideSource: 'AUTO' \| 'MANUAL'` |
| Manuelle **Deaktivierung** hält nicht | `consecutiveHeartbeatFailures` wird nur bei einem *erfolgreichen* Heartbeat auf 0 gesetzt. Während des Ausfalls steht der Zähler weiter über der Schwelle — der nächste Fehlversuch re-aktiviert sofort. | `emergencyOverrideSuppressedUntil` |

Eine manuelle Aktivierung ist auf **2 h** befristet (gerechnet ab `emergencyOverrideSince`, kein drittes Feld nötig). Ohne Timebox bliebe die Drucker-Whitelist nach der Rückkehr der Cloud dauerhaft offen und der Edge würde still divergieren.

Die Entscheidungslogik liegt als pure Funktionen in `apps/api-edge/src/utils/emergency-override.ts` (`shouldActivateEmergencyOverride`, `shouldAutoDeactivateEmergencyOverride`) — ohne App-/DB-Zugriff, damit die Matrix ohne globalen Zustand testbar bleibt.

### Warum eine Custom-Method statt eines PATCH?

`setEmergencyOverride({ active, discardPendingOverrides? })` auf `cloud-connection`, nicht ein normaler PATCH:

1. **Mehrfeld-Transaktion:** Flag + Since + Source + SuppressedUntil + Failure-Zähler plus die Policy für die gepufferten Overrides. Client-seitig zusammengesetzt gäbe es mehrere Wege in einen halb aktualisierten Zustand.
2. **`emergencyOverrideSince: null`** war extern gar nicht validierbar — das Schema hatte keine `Null`-Union (der Worker kommt nur durch, weil er `_patch` auf Adapter-Ebene nutzt).
3. **RBAC:** Ein benannter Methodenname bekommt einen expliziten Eintrag in `METHOD_TO_ACTION` (`UPDATE`), statt implizit auf den `MANAGE`-Fallback zu fallen.

Im selben Zug wurden `emergencyOverride*`, `lastHeartbeatOk` und `consecutiveHeartbeatFailures` im `cloudConnectionPatchResolver` als `filterFromExternal` gesperrt. Vorher waren sie extern patchbar — ein Client mit `CLOUD_CONNECTION: MANAGE` hätte damit die Cloud-Hoheit über Standort-Stammdaten aushebeln können, ohne RBAC-Eintrag und ohne Audit-Spur. `offlineOverrideActiveUntil` bleibt bewusst ausgenommen (der `OfflineOverrideService` patcht es extern); Migration auf eine eigene Custom-Method ist ein Folge-Task.

### Warum werden gepufferte Overrides beim Beenden NICHT gelöscht?

Naheliegend wäre „alle lokalen Änderungen verwerfen" (so stand es im ursprünglichen offenen Punkt). Das ist aber trügerisch: Das Löschen der Audit-Zeilen rollt `settings.printSettings` **nicht** zurück. Der Edge behielte die lokal geänderten Drucker-IPs, nur die Reconcile-Spur wäre weg — und die Cloud überschriebe sie beim nächsten Pull zu einem unvorhersagbaren späteren Zeitpunkt.

Default ist deshalb `discardPendingOverrides: false`. „Beenden" heißt präzise: *keine neuen* lokalen Drucker-Patches mehr annehmen; die bereits erfassten werden beim nächsten erfolgreichen Heartbeat regulär reconciled. Ein echter Rollback (Zeilen löschen **und** `printSettings` aus `oldValueJson` wiederherstellen) ist eine eigene Folge-Phase mit definierter Merge-Reihenfolge.

### Warum 3 Failures ODER 5 min?

- **3 konsekutive Failures** (≈1,5 min bei 30 s Tick) fängt akute Ausfälle schnell.
- **5 min absolut** fängt Edge-Cases, bei denen der Scheduler länger pausiert hat (Restart, Worker-Crash, etc.) und der Failure-Counter nicht hochläuft.

Beide Trigger zusammen = robuste Erkennung ohne unnötige False-Positives (ein einzelner verlorener Heartbeat aktiviert keinen Override).

## Implementierung

### Edge (panary-core)

| Komponente | Datei |
|---|---|
| Heartbeat-Schwelle + Entscheidungslogik | `apps/api-edge/src/utils/emergency-override.ts` (pure), aufgerufen aus `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts` |
| Kontroll-Switch (Custom-Method) | `setEmergencyOverride` in `apps/api-edge/src/services/cloud-connection/cloud-connection.ts` |
| Externer Schreibschutz | `cloudConnectionPatchResolver` in `apps/api-edge/src/services/cloud-connection/cloud-connection.schema.ts` |
| Whitelist im `cloudManaged()` | `apps/api-edge/src/hooks/cloud-managed.hook.ts` |
| Override-Persistenz | `apps/api-edge/src/hooks/record-emergency-override.hook.ts` |
| SQLite-Migration | `apps/api-edge/migrations/20260514000001_cloud_connection_emergency_override.ts` + `20260514000002_pending_local_overrides.ts` + `20260728200000_cloud_connection_emergency_override_manual.ts` |
| Reconciliation-Push | `runReconcileOverrides()` in `cloud-sync-scheduler.worker.ts` |
| Schema-Felder | `libs/domains/cloud-connection/domain/src/lib/cloud-connection.schema.ts` (Edge-only Felder) |

Edge-only Felder im `CloudConnection`-Schema (werden NICHT zur Cloud synct):

- `emergencyOverride: boolean`
- `emergencyOverrideSince: string | null`
- `emergencyOverrideSource: 'AUTO' | 'MANUAL' | null` (seit 2026-07-28)
- `emergencyOverrideSuppressedUntil: string | null` (seit 2026-07-28)
- `lastHeartbeatOk: string`
- `consecutiveHeartbeatFailures: number`

Alle sechs sind extern nicht patchbar (`filterFromExternal`) — der einzige externe Weg ist `setEmergencyOverride`.

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
- ~~**Override-Kontroll-Switch im Edge-Admin**~~ — erledigt 2026-07-28: Custom-Method `setEmergencyOverride`, globaler Banner mit „Notfall-Modus beenden" und manuelles Aktivieren auf der Drucker-Seite. Abweichend vom ursprünglichen Wortlaut verwirft „Beenden" die lokalen Änderungen **nicht** (Begründung oben) — das Verwerfen ist ein separater, ausdrücklich anzufordernder Schalter.
- **Sync-Conflicts-Collection in Cloud:** persistente Audit-Spur der Konflikt-Resolutions (heute nur Wide-Event-Log).
- **Tests:** `cloud-managed.hook.spec.ts` (Override-Whitelist), `utils/emergency-override.spec.ts` (Aktivierungs-/Deaktivierungs-Matrix), `cloud-connection.schema.spec.ts` (externer Schreibschutz) und `test/services/cloud-connection/set-emergency-override.test.ts` sind seit 2026-07-28 vorhanden. **Offen:** `record-emergency-override.hook.spec.ts` (Diff-Korrektheit).
- **Echter Rollback beim Beenden:** `printSettings` aus `oldValueJson` wiederherstellen statt nur die Audit-Zeilen zu löschen — braucht eine definierte Merge-Reihenfolge bei mehreren Zeilen auf demselben `fieldPath`.
