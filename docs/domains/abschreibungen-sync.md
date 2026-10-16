---
type: Domain Concept
title: 'Abschreibungen (write-offs) — Edge schreibt, Cloud bucht den Bestand einmal'
description: 'Wie eine am POS erfasste Abschreibung vom Edge per Edge→Cloud-Push in die Cloud gelangt und dort genau einmal als Warenbewegung gebucht wird; Stand und Reihenfolge der drei Umsetzungsschritte.'
tags: [write-offs, edge-pairing, sync, inventory]
status: draft
generated: { by: claude-code/opus-5.5, at: 2026-10-16T08:00:00Z }
---

# Abschreibungen (write-offs) — Edge schreibt, Cloud bucht einmal

Abschreibungen (Ausschuss, Personalessen, Diebstahl …) werden am POS im Abschreibungs-Dialog erfasst
(`libs/domains/write-offs/feature-pos-dialog`). Bis [#635](https://github.com/panary/panary-core/issues/635)
gingen sie still verloren: Der Dialog speichert über `app.service('write-offs')` am Edge, dort war kein
Service registriert.

## Modell (Entscheidung Michael, 2026-10-16)

| Rolle | Wer | Warum |
|---|---|---|
| Schreiber | **Edge** | offline-fähig wie `working-times` und `cash-sessions` |
| Transport | Edge→Cloud-Push (Outbox) | `write-offs` steht in `SyncableTransactionService` |
| Lagerbuchung | **Cloud, genau einmal beim Sync-Eingang** | `writeOffStockUpdate`-Hook am cloud-Service `write-offs` läuft als After-Create-Hook auch für den internen Sync-Aufruf |
| Bestand am Edge | wird **nicht** gebucht | sonst zwei Buchungen für einen Vorgang |

`write-offs` steht **nicht** in `SyncableMasterDataService`: Ein Pull zurück an den Edge würde beim
Bootstrap Abschreibungen überschreiben, die am Edge bereits stehen.

Die Pflichtfelder für den Sync (`_id` als uuid, `tenantId`, `locationId`, `createdAt`, `updatedAt`) trägt das
Schema `writeOffSchema` (`libs/domains/write-offs/domain/src/lib/write-offs.schema.ts`) über `baseSchema`
bereits.

## Umsetzungsschritte

1. [panary/panary-core#727](https://github.com/panary/panary-core/issues/727) — `WRITE_OFFS` in
   `SyncableTransactionService` (`libs/domains/edge-pairing/domain/src/lib/edge-pairing-request.schema.ts`),
   Paket-Release. Am Edge ändert sich dadurch nichts, solange kein Service unter dem Pfad läuft.
2. [panary/panary-cloud#1205](https://github.com/panary/panary-cloud/issues/1205) — Cloud nimmt den Push an
   (Allowlist, Idempotenz bei wiederholtem Push) und bucht einmal.
3. [panary/panary-core#635](https://github.com/panary/panary-core/issues/635) — Edge-Service, SQLite-Migration,
   Outbox-Push, `userId` aus dem Bediener-Token ([ADR 0053](../adr/0053-bediener-token-am-pos.md)), Fehleranzeige
   im POS-Dialog.

🚨 **Auslieferung: Cloud vor Edge.** Pusht ein Edge `write-offs`, bevor die Cloud den Pfad in ihrer
Allowlist führt, stuft `classifyAcceptError` die Ablehnung als TERMINAL ein — die Outbox markiert den
Eintrag `rejected`, ohne Retry.

Verwandt: [Cloud-verwaltete Stammdaten](cloud-verwaltete-stammdaten.md) (Gegenstück: Pull-only-Services).
