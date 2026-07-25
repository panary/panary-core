---
type: Architecture
title: Sync-Pull-Apply — geteiltes Modul (gebatcht, entdoppelt, getestet)
description: Geteiltes Modul sync-apply.ts als Single Source für Cloud-zu-Edge-Pull-Applies mit gebatchtem Existenz-Check, Insert-Modus beim Bootstrap und Fokus-Tests.
tags: [sync, edge]
status: stable
generated: { by: claude-code/historic, at: 2026-07-05T00:00:00Z }
---

# Sync-Pull-Apply als geteiltes Modul (`sync-apply.ts`)

## Problem

Die Apply-Logik für Cloud→Edge-Pulls existierte **dupliziert** in
`cloud-sync-scheduler.worker.ts` (inkrementeller Pull) und
`cloud-bootstrap-runner.worker.ts` (Bootstrap-Pull), inklusive:

- zwei identischer `cloudFetch`-Implementierungen (nur Default-Timeout verschieden),
- mehrfach kopierter AJV-Fehler-Extraktion,
- pro gepulltem Record **bis zu 3 sequenzieller Feathers-Calls**:
  `get`-Existenz-Check mit `catch(() => null)`, dann einzelnes `patch` bzw.
  `create` — bei einer vollen 500er-Pull-Seite also ~1000+ Roundtrips inkl.
  kompletter Hook-Chains,
- zusätzlich lud der globale `capture-audit-before.hook` bei jedem Sync-Patch
  den Vorzustand (Audit-Doppel-`get`), obwohl für Sync-Applies nie ein
  Audit-Event geschrieben wird (`record-audit-event.hook` verlangt einen
  Akteur — `params.user` — den Sync-Applies nicht haben),
- die MAX_ATTEMPTS-Eskalationsgrenze im Push-Reject-Pfad war inline
  re-implementiert statt über den getesteten Domain-Helper
  `shouldEscalateAfterRetry` (`@panary/sync/domain`, backoff-schedule.ts).

## Entscheidung

Neues Modul `apps/api-edge/src/workers/sync-apply.ts` als Single Source für:

| Export | Zweck |
|---|---|
| `cloudFetch` | EIN authentifizierter Cloud-HTTP-Call (`X-Edge-Token`), Default-Timeout 10 s; Bootstrap-Call-Sites geben 60 s explizit mit |
| `extractAjvValidationErrors` | EINE AJV-Fehler-Extraktion (Feathers `BadRequest`: `.data`, alte Builds `.errors`) |
| `pullMasterDataPage` | eine Seite `/sync-pull` (cursor-basiert, `PULL_PAGE_SIZE` 500) |
| `applyPulledRecords` | gepullte Records via Service-API anwenden (`fromSync: true`), Rückgabe `{ applied, rejected, details }` |

Konsumenten: `cloud-sync-scheduler.worker.ts`,
`cloud-bootstrap-runner.worker.ts`, `cloud-pull-business-days.worker.ts`.

### Gebatchter Existenz-Check

`applyPulledRecords` prüft Existenz **pro Pull-Seite** mit EINEM
`find({ _id: { $in: pageIds }, $select: ['_id'] })` statt einem `get` pro
Record. Danach `patch` (existiert) bzw. `create` (neu); `deletedAt`-Records
werden via `remove` angewandt. Fehler pro Record blockieren nie die Seite
(REJECTED-Detail + Wide-Event-Log). Idempotent: dieselbe Seite doppelt
angewandt ergibt beim zweiten Lauf nur Patches.

### Bootstrap-Pfad: `mode: 'insert'`

`pull-cloud-to-edge` truncated die Master-Tabellen unmittelbar vor dem
Pull-Loop — jede `_id` ist garantiert neu. Der Bootstrap übergibt daher
`{ mode: 'insert' }`: direkter `create` ohne Existenz-Find (der wäre pro
Seite ein Leer-Roundtrip). Alle anderen Pfade nutzen den Upsert-Default.

### `captureAuditBefore` überspringt Sync-Applies

Der Hook returnt früh bei `params.fromSync` — der Vorzustands-Load war für
Sync-Applies toter Aufwand, weil `record-audit-event.hook` ohne
`params.user` (Schritt 3, Akteur-Pflicht) ohnehin kein Event schreibt.

### Eskalationsgrenze über Domain-Helper

Der Push-Reject-Pfad (transient-Klassifikation) nutzt jetzt
`shouldEscalateAfterRetry(entry.attempts)` statt der inline-Grenze
`nextAttempts >= MAX_RETRY_ATTEMPTS` — Semantik identisch, aber Single
Source in `backoff-schedule.ts` (dort hermetisch getestet).

## Konsequenzen

- Pull-Apply einer vollen Seite: 1 `find` + N Writes statt 2×N Reads + N
  Writes (Existenz-`get` + Audit-`get` entfallen).
- Verhaltensneutrale Nebenwirkung: `pullMasterDataPage`-Timeout im
  BusinessDays-Worker sinkt von 60 s (alter Bootstrap-Default) auf 30 s
  (`PULL_TIMEOUT_MS`) — für einen 5-s-Kadenz-Worker angemessen.
- Tests: `test/workers/sync-apply.test.ts` (Apply happy/gemischt,
  Batch-Existenz-Spy, Idempotenz doppelter Seite, insert-Modus,
  Reject-Isolation) und `test/workers/cloud-sync-push-reject.test.ts`
  (Retry/Backoff, Eskalation an der Grenze, conflict-/terminal-Klassifikation)
  — in-memory, ohne App-Boot, nach dem Muster von
  `cloud-sync-push-drain.test.ts`.
