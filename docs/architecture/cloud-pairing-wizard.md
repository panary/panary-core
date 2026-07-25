---
type: Architecture
title: Cloud-Pairing-Wizard — Edge-Seite (M7.2)
description: Vierstufiger Cloud-Pairing-Wizard auf Edge-Seite mit Preflight, Bootstrap-Runner, drei Initial-Sync-Richtungen, Konflikt-Review und Sync-Scheduler-Modi.
tags: [cloud-connection, sync]
status: draft
generated: { by: claude-code/historic, at: 2026-05-02T00:00:00Z }
---

# Cloud-Pairing-Wizard (Edge-Seite)

Setzt M7.2 aus dem [Cloud-Edge-Sync-ADR](../../../panary-cloud/docs/adr/0001-sync-protocol.md) um. Erweitert den bestehenden `cloud-connection`-Service und die Admin-UI um einen vierstufigen Pairing-Wizard mit drei Initial-Sync-Direction-Modi.

## Custom-Methods auf `cloud-connection`

| Methode | Zweck | Auth |
|---|---|---|
| `preflight({ cloudUrl, pairingCode, edgeName })` | Sammelt lokale Inventur, ruft Cloud `POST /edge-pairing/preflight`, persistiert `preflightSnapshot`. Idempotent — kann beliebig oft aufgerufen werden, solange der Code gültig ist. | JWT |
| `startBootstrap({ cloudConnectionId, initialDirection, confirmDataLoss })` | Konsumiert den Pairing-Code, mintet Token, persistiert `cloudToken`/`cloudEdgeId`/`bootstrapStatus=in-progress`, triggert `cloud-bootstrap-runner.worker`. | JWT |
| `syncNow({ cloudConnectionId })` | Triggert einen einzelnen Push-Pull-Zyklus über den Sync-Scheduler. Antwort: `{ pushed, pulled, durationMs, lastError? }`. | JWT |

Der alte `create`-Pfad (cloudUrl + pairingCode) bleibt fuer Rueckwaertskompatibilitaet erhalten und mappt auf `pull-cloud-to-edge` als Default-Direction (nicht empfohlen — der Wizard sollte verwendet werden).

## Schema-Erweiterung

`cloud-connection.schema.ts` enthaelt jetzt Wizard-/Sync-Mode-Felder:

- `initialDirection?: 'bootstrap-edge-to-cloud' | 'pull-cloud-to-edge' | 'merge-by-external-id'`
- `bootstrapStatus?: 'idle' | 'in-progress' | 'done' | 'failed'`
- `bootstrapStartedAt`, `bootstrapCompletedAt`, `bootstrapResumeToken`, `bootstrapError`
- `preflightSnapshot?: { cloudInventory, edgeInventory, suggestedDirection, requiresTenantIdRestamp, ... }`
- `tenantIdRestampedAt`, `preTenantIdRestampBackupPath`
- ADR §7 Sync-Modi: `syncMode`, `syncIntervalSec`, `syncSchedule`, `lastManualSyncAt`, `lastScheduledSyncAt`, `lastClockSkewMs`, `outboxBacklog`

Migration: [`20260502000001_cloud_connection_v2.ts`](../../apps/api-edge/migrations/20260502000001_cloud_connection_v2.ts).

## Bootstrap-Runner-Logik

[`cloud-bootstrap-runner.worker.ts`](../../apps/api-edge/src/workers/cloud-bootstrap-runner.worker.ts) wird via dynamischem Import aus `cloud-connection.startBootstrap` getriggert (kein blocking call). Ablauf:

1. `requiresTenantIdRestamp = true` → SQLite-File-Backup (`<filename>.pre-pairing-<ts>.bak`) + `applyCloudTenantId`-Util in einer Transaktion. Backup-Pfad in `cloud-connection.preTenantIdRestampBackupPath`.
2. `cloud-connection`-Datensatz wird selbst restampt (separat, weil multiTenancy ihn sonst nicht mehr findet).
3. Direction-spezifischer Lauf (siehe ADR §10).
4. Status auf `done` oder `failed` setzen, `bootstrapCompletedAt` schreiben.

Bei Fehlern bleibt `bootstrapStatus = failed` mit `bootstrapError`-Text. Wiederholung: aktuell nur durch erneuten `startBootstrap`-Aufruf moeglich (`bootstrapResumeToken` ist vorbereitet, aber Resume-Logik fuer Edge-Initiative noch offen).

## Konflikt-Review

[`sync-conflicts`](../../apps/api-edge/src/services/sync-conflicts/sync-conflicts.ts) speichert Records aus `merge-by-external-id`-Bootstrap. Patch mit `resolution`-Feld triggert Anwendung:

- `use-cloud`: Cloud-Variante wird auf den Edge-Service angewandt
- `use-edge`: lokal nichts (Outbox-Push uebernimmt Edge-Variante)
- `discard`: lokaler Edge-Record wird geloescht

UI-Counter zeigt offene Konflikte im Connected-State an. Eine dedizierte Konflikt-Tabellen-Komponente mit Diff-Anzeige fehlt noch (TODO).

## Sync-Scheduler

[`cloud-sync-scheduler.worker.ts`](../../apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts) ersetzt den alten heartbeat-only-Worker. Vier Modi:

- `auto`: alle `syncIntervalSec` (60..3600 s) Push + Pull-Pro-Service + Heartbeat
- `scheduled`: festgelegte Uhrzeiten in `syncSchedule.times` mit `syncSchedule.timezone`. Verpasste Slots (>24 h) werden einmalig nachgeholt.
- `manual`: nur Heartbeat alle 30 min; Push/Pull nur via `cloud-connection.syncNow`
- `disabled`: nichts

Token-Rotation: Heartbeat-Response kann `nextToken` enthalten. Wird sofort als neues `cloudToken` persistiert.

Clock-Skew >5 min → Push wird pausiert, UI zeigt blockierende Meldung.

## Wizard-UI

[`cloud-connection.ts` (Component)](../../apps/admin-client/src/app/features/cloud-connection/cloud-connection.ts) wurde um drei Sub-Steps im disconnected-State erweitert:

1. **input** — Code + URL + Edge-Name → Aufruf `cloud-connection.preflight`
2. **preflight-result** — Inventur-Diff, Direction-Auswahl, Bestaetigung
3. **progress** — Polling auf `bootstrapStatus`, zeigt Live-Status

Der connected-State bietet:

- Cloud-URL, Edge-Name, Connected-Seit, Last-Sync, Clock-Skew
- Sync-Mode-Dropdown (4 Modi) + Intervall-Input (nur bei `auto`)
- "Jetzt synchronisieren"-Button (zeigt `pushed/pulled/durationMs`)
- Counter fuer offene Sync-Konflikte (Link auf separate Route fehlt noch)

## Migrationen (Reihenfolge)

1. `20260502000001_cloud_connection_v2.ts` — neue Spalten an `cloud-connection`
2. `20260502000002_sync_conflicts.ts` — neue Tabelle
3. `20260502000003_sync_outbox.ts` — neue Tabelle
4. `20260502000004_sync_cursor.ts` — neue Tabelle

## Folge-Schritte

- Konflikt-Review-Komponente im admin-client (separate Route)
- Bootstrap-Resume nach Edge-Restart waehrend laufendem Bootstrap
- Volle Integration-Tests: Pairing-End-to-End mit Mock-Cloud
- Token-Verschluesselung in SQLite (`cloud-connection.cloudToken` ist aktuell Klartext)
