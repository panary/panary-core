---
type: Domain Concept
title: 'Sync-Outbox — reEnqueue: rejected Eintrag mit frischem Edge-Stand neu einreihen'
description: 'Custom-Method sync-outbox.reEnqueue erzeugt aus einem abgelehnten Outbox-Eintrag einen frischen pending-Eintrag mit dem aktuellen Stand des Edge-Records — Operator-Aktion für Schema-Mismatch-Fixes, ohne die alte Stale-Payload nochmal zu pushen.'
tags: [sync, edge, outbox, operator, admin]
status: stable
generated: { by: claude-code/opus-4-7, at: 2026-07-28T15:47:00Z }
---

# Sync-Outbox — reEnqueue

Der Sync-Status-Screen des Admin-Panels (`sync-conflicts.ts`) hatte in seiner
ersten Fassung nur zwei Aktionen auf abgelehnte Outbox-Einträge: **„Erneut
versuchen"** (schickt die ursprünglich gespeicherte Payload nochmal an die
Cloud) und **„Verwerfen"** (entfernt den Outbox-Eintrag, der Edge-Record
bleibt aber unverändert liegen).

Das ließ eine Lücke offen: Wenn die Cloud einen Push wegen **Schema-Mismatch**
terminal abgelehnt hat und der Operator den lokalen Datensatz danach
korrigiert, hilft weder Retry noch Verwerfen:

- „Erneut versuchen" schickt die alte fehlerhafte Payload — Cloud lehnt
  erneut ab.
- „Verwerfen" löscht nur den Outbox-Eintrag; der Edge-Record ist danach für
  die Cloud unsichtbar, ohne dass ein neuer Push angestoßen wird
  (Operator-Beispiel: cash-session am POS angelegt, Sync scheitert an
  Schema-Bug, Operator verwirft → Kasse existiert lokal, aber die Cloud sieht
  sie nie).

Die Custom-Method `sync-outbox.reEnqueue({ id })` schließt genau diese Lücke.

## Vertrag

| Aspekt | Regel |
|---|---|
| **Nur `rejected`** | Andere Status (`pending`, `in-flight`, `acked`) → `BadRequest`. Verhindert Races mit dem Worker und Doppel-Pushes bereits synchronisierter Records. |
| **Original-Op bleibt erhalten** | `create` bleibt `create`, `patch` bleibt `patch`, `remove` bleibt `remove`. Ein „immer patch"-Verhalten würde bei fehlgeschlagenem `create` in der Cloud 404 werfen — der Record kam dort nie an. |
| **Payload-Refresh bei `create`/`patch`** | `app.service(entry.service).get(entry.entityId, { provider: undefined })` lädt den aktuellen Edge-Record. Wenn er nicht mehr existiert (Operator hat ihn lokal gelöscht), → `BadRequest` mit `„Lokaler Datensatz existiert nicht mehr — kann nicht erneut eingereiht werden"`. Der alte rejected-Eintrag bleibt in diesem Fall erhalten, damit kein Datenverlust droht. |
| **`remove` ohne Refetch** | Bei `remove` reicht die entityId — der Edge-Record darf (und soll) fehlen. Payload bleibt `null`/`undefined`. |
| **Alter Eintrag wird entfernt** | Nach erfolgreicher Neueinreihung wird die alte rejected-Row via `outboxService.remove(entry._id)` gelöscht — konsistent zum bestehenden „Verwerfen"-Pattern, keine doppelten Zeilen im UI. |
| **Neuer Eintrag = `pending`** | Der Create-Resolver forciert `status=pending`, `attempts=0`, `nextAttemptAt=occurredAt` — der Worker zieht den frischen Eintrag sofort im nächsten Zyklus. |
| **`syncSource: LIVE`** | Operator-getriggerter Re-Enqueue ist eine frische Aktion, keine Backfill-Wiederholung. |

## Bausteine

| Baustein | Pfad |
|---|---|
| Custom-Method-Implementierung | `apps/api-edge/src/services/sync-outbox/sync-outbox.ts` (`reEnqueueOutboxEntry`) |
| Args-Schema | `libs/domains/sync/domain/src/lib/sync-outbox-entry.schema.ts` (`reEnqueueOutboxArgsSchema`) |
| RBAC-Mapping | `libs/shared/backend/src/hooks/authorize.hook.ts` (`reEnqueue: AppAction.UPDATE`) — greift automatisch, weil `SYNC_OUTBOX: MANAGE` an `TENANT_OWNER`, `TENANT_TECHNICIAN` und `PLATFORM_SUPPORT` vergeben ist (`PLATFORM_OWNER` hat den globalen Bypass) |
| Operator-Button „Erneut einreihen" | `apps/admin-client/src/app/features/cloud-connection/sync-conflicts.ts` (`reEnqueueRejected`) |
| Integrationstest | `apps/api-edge/test/services/sync-outbox/sync-outbox.test.ts` — Guard, Op-Preservation, Payload-Refresh, Cleanup, Edge-Record-Missing |

## UI-Platzierung — nur `rejected`, nicht „In Wiederholung"

Der grüne Button „Erneut einreihen" erscheint ausschließlich auf rejected-Karten,
nicht auf „In Wiederholung". Begründung: retrying-Einträge zieht der Worker
ohnehin im nächsten Backoff-Zyklus automatisch nochmal; wer den Force-Retry mit
der bestehenden Payload möchte, klickt dort „Jetzt erneut versuchen".
Re-Enqueue ist dagegen die Rettungsleine für Einträge, bei denen der Worker
aufgegeben hat und der Operator den lokalen Record inzwischen angefasst hat.

Für **policy-blockierte** Rejects (z. B. `tenant:owner`-User-Push, den die
Cloud grundsätzlich nicht akzeptiert) ist der Button ebenfalls disabled — ein
frischer Push würde am gleichen Guard scheitern.

## Abgrenzung zu bestehenden Aktionen

| Aktion | Wann sinnvoll | Payload-Quelle |
|---|---|---|
| **Erneut versuchen** | Transient-Fehler (Cloud-Outage, Netzwerk), der terminal eskaliert wurde und die Payload nach wie vor gültig ist | Alte Outbox-Payload |
| **Erneut einreihen** *(neu)* | Schema-Mismatch / fachlicher Fehler, den der Operator im Edge-Record korrigiert hat | Frisch geladener Edge-Record |
| **Verwerfen** | Operator akzeptiert, dass der Record NUR lokal bleibt (z. B. policy-blockiert, oder Testdaten die nicht in die Cloud gehören) | — (Outbox-Eintrag gelöscht, Edge-Record unangetastet) |

## Referenzen

- Sync-Status-UI: `apps/admin-client/src/app/features/cloud-connection/sync-conflicts.ts`
- Push-Worker (klassifiziert Rejects als transient/terminal/conflict):
  `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts`
- Reject-Klassifikation im Domain-Modell: `libs/domains/sync/domain/src/lib/sync-op.schema.ts` (`SyncRejectionClassification`)
- RBAC-Grundlage: [Edge-authorize — Hybrid-RBAC](../security/edge-authorize-hybrid-rbac.md)
