---
type: ADR
title: „Verwerfen“ eines Sync-Konflikts richtet sich nach seinem Ursprung
description: Warum Verwerfen bei Konflikten aus abgelehnten Lösch-Ops nichts löscht, sonst nur lokal ohne Lösch-Auftrag löscht, und woran der Edge den Ursprung ohne neue Spalte erkennt.
tags: [sync, edge, admin-client]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-10-11T00:45:00Z }
---

# „Verwerfen“ eines Sync-Konflikts richtet sich nach seinem Ursprung

## Problem

Am Kunden-Edge (Staging) erzeugte der Bootstrap-Truncate je Bestands-Benutzer eine `REMOVE`-Op
in der Outbox (panary/panary-core#660). Die Cloud lehnte sie ab, am 2026-10-09 eskalierten sie zu
elf Datenkonflikten `users` / `push-rejected`. Der Betreiber klickte am 2026-10-10 bei allen auf
„Verwerfen“, um sie loszuwerden.

`applyConflictResolution` rief im Zweig `DISCARD` `service.remove(edgeRecordId)` ohne Marker auf
([ADR 0037](0037-konflikt-aufloesung-wendet-an-bevor-sie-als-geloest-gilt.md), Punkt 5: „Verwerfen
läuft weiterhin ohne `fromSync`“). Der Bootstrap hatte die Benutzer mit denselben IDs neu geholt.
Folgen:

* Zehn Benutzer wurden lokal gelöscht.
* Zehn neue `REMOVE`-Ops landeten in der Outbox. Für den Betreiber kamen die verworfenen
  Lösch-Aufträge „wieder“.

Der Knopf hatte keine Rückfrage und nannte das Löschen nicht. Bei einem Konflikt aus einer
`remove`-Op ist „Verwerfen = lokal löschen“ zudem sinnlos, gemeint ist „Lösch-Auftrag fallen
lassen“.

## Entscheidung

**1. Der Ursprung wird abgeleitet, nicht gespeichert.** `syncConflictOrigin()` in
`@panary/sync/domain` unterscheidet `bootstrap`, `push-write` und `push-remove`. Push-Konflikte
erkennt es an `reason` (`push-*`), die Lösch-Op am fehlenden `edgePayload`. Der Outbox-Recorder
schreibt für `remove` als einzige Op `payload: null`, `create`/`patch` tragen immer den vollen
Record, und `escalateToConflict` übernimmt den Payload unverändert.

Eine Spalte `originOp` am Konflikt hätte eine Migration gebraucht und genau die Bestands-Konflikte
nicht erfasst, um die es ging. Ein Nachschlagen über `sync-outbox.linkedConflictId` reicht allein
nicht: Der Betreiber kann den abgelehnten Outbox-Eintrag unter „Nicht hochgeladen“ getrennt
verwerfen, dann ist die Verknüpfung weg.

**2. `DISCARD` nach Ursprung:**

| Ursprung | Wirkung |
|---|---|
| `push-remove` | kein `service.remove`. Der Datensatz bleibt. |
| `push-write`, `bootstrap` | lokal löschen mit `params.skipSyncOutbox`, kein Lösch-Auftrag an die Cloud |

In beiden Fällen wird die verknüpfte abgelehnte Outbox-Op (`linkedConflictId`) entfernt. Sie stand
sonst weiter unter „Nicht hochgeladen“, obwohl ihr Konflikt erledigt ist.

**Warum kein Lösch-Auftrag beim lokalen Löschen:** Ein gepushtes `REMOVE` wäre eine Löschung in der
Cloud, die niemand gewählt hat. Bei einer abgelehnten `create`-Op gibt es dort nichts zu löschen,
das `REMOVE` käme als nächster Konflikt zurück. `skipSyncOutbox` statt `fromSync`, weil `fromSync`
zusätzlich den Audit-Eintrag unterdrückt (`capture-audit-before.hook.ts`); die Löschung ist eine
Operator-Aktion und bleibt im Audit.

**3. Das Admin-Panel sagt die Wirkung vorher.** Der Edge liefert `origin` als virtuelles Feld
(Result-Resolver, keine Spalte). Bei `push-remove` heißt der Knopf „Lösch-Auftrag verwerfen“ und
fragt nicht, es wird nichts gelöscht. Sonst heißt er „Verwerfen und hier löschen“ und verlangt eine
Bestätigung, die das Löschen an diesem Standort und die unveränderte Online-Datenbank nennt. Fehlt
`origin` (älterer Edge), fragt das Panel ebenfalls.

## Konsequenzen

* **ADR 0037 Punkt 5 gilt für „Verwerfen“ nicht mehr.** Der USE_CLOUD-Teil (`fromSync: true`) bleibt
  unverändert.
* **Lokal gelöscht heißt nicht für immer weg.** Die Online-Datenbank behält ihren Stand. Er kommt erst
  mit der nächsten Änderung dort wieder an den Edge, weil der Pull inkrementell über `updatedAt`
  läuft. Die Rückfrage sagt das.
* **Die Ableitung hängt an einer Recorder-Eigenschaft.** Schreibt der Recorder eines Tages auch für
  `remove` einen Payload, kippt `push-remove` zu `push-write`, und Verwerfen löscht wieder, dann aber
  mit Rückfrage. Die Kopplung steht in beiden Kommentaren. Die Integrationstests seeden die Outbox-Op
  wie der Recorder (`payload: null`).
* **Bereits so gelöschte Datensätze holt das nicht zurück.** Dafür fehlt am Edge ein Reparaturweg
  „Benutzer neu aus der Cloud laden“ (Ergänzung am Issue #663, eigenes Issue).

## Verwandt

* [ADR 0037 — Konflikt-Auflösung wendet an, bevor sie als gelöst gilt](0037-konflikt-aufloesung-wendet-an-bevor-sie-als-geloest-gilt.md)
* [ADR 0010 — Sync-Outbox: Echo und Coalescing](0010-sync-outbox-echo-coalescing.md)
