---
type: ADR
title: 'ADR — Sync-Outbox: fromSync-Guard gegen Echos + Coalescing pro Entity'
description: fromSync-Guard verhindert den Rück-Push gepullter Records (Sync-Echo); Coalescing pusht pro Entity nur den jüngsten Outbox-Eintrag mit neuem terminalem Status superseded.
tags: [sync, users, edge-pairing]
status: stable
decision: accepted
generated: { by: claude-code/historic, at: 2026-07-06T00:00:00Z }
---

# ADR — Sync-Outbox: fromSync-Guard gegen Echos + Coalescing pro Entity

Qualitaets-Review Stufe 4, Befund #47.

## Problem

Der globale After-Hook `recordSyncOutbox` (`apps/api-edge/src/hooks/sync-outbox-recorder.hook.ts`)
schrieb fuer **jede** Mutation eines Edge→Cloud-pflichtigen Pfads (`SyncableTransactionService`)
einen Voll-Payload-Eintrag in die `sync-outbox`. Zwei Fehlerbilder:

1. **Sync-Echo:** `users` ist sowohl Master-Data-**Pull**-Service als auch transactional
   **Push**-Service. Der Cloud→Edge-Pull (`applyPulledRecords` mit
   `{ provider: undefined, fromSync: true }`) und die User-Reconciliation
   (`reconcileStaleUsers`, Archivierung nicht mehr sichtbarer User) patchen lokale User —
   der Recorder nahm diese Cloud-originierten Mutationen wieder in die Outbox auf und
   pushte sie zur Cloud zurueck. Da der Cloud-Receiver create/patch als bedingungslosen
   Upsert anwendet, konnte das Echo dort einen parallel entstandenen juengeren Stand
   ueberschreiben.
2. **Stale-Overwrite durch Duplikate:** Pro Mutation entstand ein eigener Outbox-Eintrag
   ohne Deduplizierung. Mehrere pending-Eintraege derselben Entity konnten
   (a) im selben Push-Batch landen — die Cloud parallelisiert die Upserts eines Batches
   in Fenstern ohne Reihenfolgegarantie und **setzt Edge-seitige Deduplizierung explizit
   voraus** (Kommentar in `acceptOps`, api-cloud `sync.ts`) — oder
   (b) zeitversetzt gepusht werden: ein Backoff-Eintrag (transienter Fehler, `nextAttemptAt`
   in der Zukunft) wurde erst faellig, nachdem ein juengerer Eintrag laengst geackt war —
   sein alter Voll-Payload ueberschrieb dann den juengeren Cloud-Stand.

Zusaetzlich testete die Hook-Spec den `USER_EDGE_LOCAL_FIELDS`-Strip nur gegen eine
Identitaets-Attrappe (`stripUserEdgeLocalFields` als `record => record` gemockt).

## Entscheidung

1. **fromSync-Guard im Recorder:** `recordSyncOutbox` returnt frueh bei
   `context.params.fromSync === true`. Alle Cloud→Edge-Applies (Pull-Apply, Bootstrap-Pull,
   Business-Days-Pull) setzen das Flag bereits; `reconcileStaleUsers` setzt es jetzt
   ebenfalls (die Archivierung ist Cloud-getrieben — Visibility-Snapshot = Source of Truth —
   und laeuft damit konsistent auch ohne Edge-Audit-Diff, wie jeder andere Pull-Apply).
2. **Coalescing beim Fetch (`fetchPendingOutbox` → `coalescePendingEntries`):**
   Pro `(service, entityId)` wird nur der **juengste** Eintrag gepusht. Ein Kandidat ist
   `superseded`, sobald irgendein Eintrag derselben Entity mit groesserer `_id`
   (uuidv7 = chronologisch) existiert — **unabhaengig von dessen Status**:
   - `pending`/`in-flight`: der juengere Voll-Payload subsumiert den aelteren Stand;
   - `acked`: der juengere Stand ist bereits in der Cloud — den aelteren zu pushen waere
     exakt der Stale-Overwrite;
   - `rejected`: der juengere Stand wartet auf Operator-Aufloesung (sync-conflicts /
     `reEnqueue`) und darf nicht von einem aelteren Stand unterlaufen werden.

   **Warum Fetch-Zeitpunkt statt Schreib-Zeitpunkt:** Ein Write-Time-Replace laesst die
   Luecke offen, dass ein `in-flight`-Eintrag nach transientem Fehler auf `pending`
   zurueckfaellt und dann NEBEN einem juengeren pending-Eintrag liegt; ausserdem hielte er
   den heissen POS-Schreibpfad mit einer Zusatz-Query auf. Der Fetch-Check ist die
   konservativste vollstaendige Variante: genau EIN zusaetzlicher `find` pro Push-Batch,
   und die Entscheidung faellt zum letztmoeglichen Zeitpunkt vor dem Cloud-Call.

   **Retry-/Backoff-Semantik:** Der juengste Eintrag einer Entity wird nie superseded und
   behaelt `attempts`/`nextAttemptAt` unveraendert — Coalescing verwirft nie Zustand, nur
   veraltete Zwischenstaende. Der Drain-Loop zaehlt weiterhin die **Roh**-Batch-Groesse
   (`fetched`), damit ein Batch voller superseded-Duplikate den Drain nicht abbricht.
   Degradation: schlaegt die Sibling-Query fehl, wird ungefiltert gepusht (Cloud-Upsert ist
   idempotent; ein redundanter Push ist billiger als ein faelschlich uebersprungener).
3. **Neuer Status `superseded`** in `SyncOutboxStatus` (`@panary/sync/domain`), terminal.
   `terminalAt` = Supersede-Zeitpunkt (Retention-Referenz), `lastError` verweist auf den
   juengeren Eintrag. Die Outbox-Retention (`runOutboxRetention`, Audit-Cleanup-Worker)
   loescht superseded-Eintraege nach `OUTBOX_ACKED_RETENTION_DAYS` ueber `terminalAt`;
   `audit-events` sind ausgenommen (append-only, Duplikate koennen dort nicht entstehen —
   im Zweifel bleibt die Row konservativ stehen, weil die acked-Row der
   Loeschbarkeits-Beweis des Audit-Cleanups ist).

## Konsequenzen

- Cloud-Pull/Reconciliation erzeugen keine Rueck-Pushes mehr; die Outbox enthaelt nur noch
  echte Edge-Mutationen.
- Pro Entity erreicht die Cloud nur noch der juengste Stand — die Voraussetzung des
  parallelen Cloud-Upserts („Edge-Outbox dedupliziert") ist jetzt tatsaechlich erfuellt.
- `superseded`-Eintraege tauchen in den Operator-Ansichten nicht auf (Admin-Client filtert
  auf `rejected` bzw. `pending`+Backoff) und blockieren den Tagesabschluss nicht
  (Guard prueft `pending`). Kein UI-Handlungsbedarf.
- SQLite: `status` ist eine ungebundene TEXT-Spalte — keine Migration noetig.
- Hook-Spec testet `stripUserEdgeLocalFields`/`isSyncPushBlockedRole` jetzt gegen die
  echten Domain-Funktionen; Worker-Tests decken Coalescing (2 Mutationen → 1 Kandidat mit
  juengster Payload), den Backoff-acked-Stale-Fall und die Drain-Fortsetzung nach reinen
  superseded-Batches ab.

## Code-Pfade

- `apps/api-edge/src/hooks/sync-outbox-recorder.hook.ts` — fromSync-Guard
- `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts` — `coalescePendingEntries`,
  `markOutboxSuperseded`, `reconcileStaleUsers` mit `fromSync`
- `apps/api-edge/src/workers/audit-cleanup.worker.ts` — Retention fuer `superseded`
- `libs/domains/sync/domain/src/lib/sync-outbox-entry.schema.ts` — Status-Enum
