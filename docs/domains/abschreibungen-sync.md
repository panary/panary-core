---
type: Domain Concept
title: 'Abschreibungen (write-offs) — Edge schreibt, Cloud bucht den Bestand einmal'
description: 'Wie eine am POS erfasste Abschreibung vom Edge per Edge→Cloud-Push in die Cloud gelangt und dort genau einmal als Warenbewegung gebucht wird; Stand und Reihenfolge der drei Umsetzungsschritte.'
tags: [write-offs, edge-pairing, sync, inventory]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-16T08:30:00Z }
---

# Abschreibungen (write-offs) — Edge schreibt, Cloud bucht einmal

Abschreibungen (Ausschuss, Personalessen, Diebstahl …) werden am POS im Abschreibungs-Dialog erfasst
(`libs/domains/write-offs/feature-pos-dialog`). Bis [#635](https://github.com/panary/panary-core/issues/635)
gingen sie still verloren: Der Dialog speichert über `app.service('write-offs')` am Edge, dort war kein
Service registriert, und `device:pos-client` hatte in der Rollen-Matrix kein Recht auf die Ressource.

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

## Edge-Service `write-offs`

[`apps/api-edge/src/services/write-offs/write-offs.ts`](../../apps/api-edge/src/services/write-offs/write-offs.ts),
Tabelle `write-offs` (Migration `20261016100000_write_offs.ts`).

| Punkt | Umsetzung |
|---|---|
| Methoden | `find`, `get`, `create` — **append-only**. Eine Korrektur ist eine neue Abschreibung; SQLite-Trigger lehnen `UPDATE`/`DELETE` zusätzlich ab. |
| Hook-Kette | `authenticate('jwt')` → `authorize()` → `multiTenancy({ isolateLocation: true })` (stempelt `tenantId`) → `locationId` der Session erzwungen (`multiTenancy` stempelt sie nur, wenn sie fehlt) → markiertes `validateData` → `resolveData` (`createdAt`, `updatedAt` serverseitig; `_id` darf der POS mitgeben). |
| Bediener | Ein Before-Hook vor `validateData` setzt `userId` per `attributedOperatorId` aus dem Bediener-Token ([ADR 0053](../adr/0053-bediener-token-am-pos.md)). Der Body-Wert aus `pos_current_user` zählt bei Geräten nicht. |
| Recht | `device:pos-client` hat `write-offs: CREATE` (nur das — der Dialog liest nichts). Tabelle: [Rollen-Matrix](../security/rollen-matrix.md). |
| Push | Der app-weite Outbox-Recorder schreibt je `create` einen Eintrag mit dem vollen Datensatz, weil `write-offs` in `SyncableTransactionService` steht. Kein eigener Code am Service. |
| Bestand | Der Edge bucht **keinen** Bestand. |
| Stempelfeld-Gate | `write-offs` steht in `REQUIRED_STAMP_EXCEPTIONS`: Beide Spalten sind `notNullable`, das Pflichtfeld liegt im Domain-Schema, das auch die Cloud validiert. |

**POS-Dialog** (`libs/domains/write-offs/feature-pos-dialog`): Ohne Geschäftstag meldet er das sofort, statt
eine sichere Ablehnung abzuschicken. Speicherfehler zeigt er mit Ursache (`writeOffErrorMessage`: 403 → fehlendes
Recht, 400 → ungültig mit Server-Detail, „Service nicht gefunden“ → nicht verfügbar, sonst Server-Meldung); bei
Mandantensperre und Kontext-403 schweigt er, weil `ServiceHelper.handleError` die selbst anzeigt. Der Dialog bleibt
nach einem Fehler offen. Gegen Doppeltipps sperrt er den Button während des Speicherns und schickt eine `_id` je
Dialog mit, sodass ein erneuter Versuch denselben Datensatz trifft. Bleibt die Antwort des Edge 15 s aus (der
Socket-Client puffert Aufrufe bei getrennter Verbindung ohne eigenes Timeout), gibt der Dialog mit „Keine Antwort vom
Server“ auf und gibt den Button frei.

## Umsetzungsschritte

1. [panary/panary-core#727](https://github.com/panary/panary-core/issues/727) — `WRITE_OFFS` in
   `SyncableTransactionService` (`libs/domains/edge-pairing/domain/src/lib/edge-pairing-request.schema.ts`),
   Paket-Release `v26.10.14`. Am Edge änderte sich dadurch nichts, solange kein Service unter dem Pfad lief.
2. [panary/panary-cloud#1205](https://github.com/panary/panary-cloud/issues/1205) — Cloud nimmt den Push an
   (Idempotenz bei wiederholtem Push, `null`-Strip, Erfassungszeitpunkt des Edge, Bediener-Tenant-Prüfung) und
   bucht einmal.
3. [panary/panary-core#635](https://github.com/panary/panary-core/issues/635) — Edge-Service, SQLite-Migration,
   Outbox-Push, `userId` aus dem Bediener-Token ([ADR 0053](../adr/0053-bediener-token-am-pos.md)), Fehleranzeige
   im POS-Dialog.

🚨 **Auslieferung: Cloud vor Edge.** Pusht ein Edge `write-offs`, bevor die Cloud den Pfad in ihrer
Allowlist führt, stuft `classifyAcceptError` die Ablehnung als TERMINAL ein — die Outbox markiert den
Eintrag `rejected`, ohne Retry.

Verwandt: [Cloud-verwaltete Stammdaten](cloud-verwaltete-stammdaten.md) (Gegenstück: Pull-only-Services).
