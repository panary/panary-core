---
title: Sync-Run-Details — Per-Record-Nachvollziehbarkeit in der Sync-Historie
date: 2026-05-21
category: architecture
domains: [sync]
status: draft
---

# Sync-Run-Details

## Problem

Die Sync-Historie (Admin-Panel → *Cloud-Kopplung*) zeigte pro Sync-Vorgang nur
aggregierte Zähler an (z.B. „Push → Cloud, 4 Records"). Der Operator konnte
**nicht** nachvollziehen, *welche* Records synchronisiert wurden, und in der
Spalte **Service** stand bei Push-Zeilen immer ein „—". Damit ließen sich
Synchronisierungsprobleme nicht gegen die Datenbank abgleichen.

### Warum „—" beim Service?

Ein Push bündelt **alle** dirty Records (Orders, Order-Interaktionen, Personal …)
aus der `sync-outbox` in **einen** `/sync-push`-Call. Der Scheduler schrieb dafür
**einen aggregierten** `sync-run` mit `service: null` — die UI rendert `null` als
„—". Pull-Zeilen zeigten den Service, weil Pull pro Service in einer Schleife
läuft.

## Entscheidung

Pro Sync-Vorgang werden die betroffenen Records jetzt **im selben `sync-run`-Event**
als JSON-Liste persistiert (Feld `details`). Kein neuer Service, keine separate
Tabelle.

### Datenmodell

`libs/domains/sync/domain/src/lib/sync-run.schema.ts`:

- Neues `syncRunRecordDetailSchema`: `{ service, entityId, op, status?, reason? }`
  - `op`: `create | patch | remove` (wiederverwendetes `SyncOp`-Enum)
  - `status`: `accepted | rejected | conflict | retry` (`SyncRunRecordStatus`)
- Neues optionales Feld `details: SyncRunRecordDetail[]` am `syncRunSchema`.

Migration `20260521000001_sync_runs_add_details.ts`: `details` als nullable
**TEXT**-Spalte. Knex serialisiert das beim Insert übergebene Array automatisch
als JSON-String; der `resolveResult`-Resolver des `sync-runs`-Service parsed es
beim Lesen zurück in ein Array (identisches Muster wie `sync-conflicts`-Payloads).

> **Wichtig:** `validateData` läuft vor dem Insert und erwartet ein **Array** —
> der `recordSyncRun`-Helper übergibt deshalb das Array unverändert (kein
> Stringify im Helper).

### Erfassung (nur Scheduler-Pfad)

`apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts`:

- `runPush` liefert `{ accepted, rejected, details }`. Details aus den Outbox-
  `entries`: akzeptierte Ops → `status: accepted`; Rejects je nach Klassifikation
  → `rejected | conflict | retry` (+ `reason`).
- `runPullForService` liefert `{ count, details }`. Pro angewandtem Record
  `{ service, entityId, op }`; fehlgeschlagene Applies → `status: rejected`.
- **Deckel:** `MAX_SYNC_RUN_DETAILS = 500`. Push ist ohnehin auf
  `PUSH_BATCH_SIZE = 100` begrenzt; große Pulls (Bootstrap) werden gekappt — die
  UI signalisiert das über `recordCount > details.length`.
- Push-Vorgänge mit Rejects werden jetzt als `outcome: partial` protokolliert
  und tragen den `rejected`-Zähler (das „(N rej.)"-Badge funktioniert dadurch
  auch für Push).

Der **Bootstrap-Pfad** bleibt unverändert (eigener Worker + `bootstrap-reports`).

### UI

`apps/admin-client/src/app/features/cloud-connection/sync-history.ts`:

- Spalte **Service**: `serviceSummary(row)` zeigt bei Push (service=null) die aus
  `details` abgeleiteten distinkten Services — 1 → dessen Label, >1 →
  „Mehrere (N)" — statt „—".
- Klick auf die **Records**-Zahl öffnet ein Popup (gruppiert nach Service), je
  Record: Operation-Badge (Neu/Änd./Gelöscht), `entityId` (monospace, kopierbar),
  Status-Badge + Reason bei rejected/conflict. Hinweis „… und N weitere", wenn
  gekappt. Die Details kommen bereits mit dem Listen-`find` — kein Extra-Request.

## Konsequenzen

- `sync-runs` ist weiterhin **Append-Telemetrie** mit 30-Tage-Cleanup; die
  `details` verschwinden also mit dem jeweiligen Eintrag.
- Bei sehr großen Pulls sind nur die ersten 500 Record-IDs gespeichert.
- `details` wird in jeder `find`-Antwort mitgeliefert (gekappt) — für den lokalen
  Edge-Betrieb unkritisch.
