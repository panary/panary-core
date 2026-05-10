---
title: Tenant-Audit-Events (Edge)
date: 2026-05-06
category: Sicherheit
domains: [audit-events, sync, users]
status: implementiert
---

# Tenant-Audit-Events — Edge

Append-only Audit-Trail auf Tenant-Ebene. Wird auf dem Edge-Backend
(`api-edge`) erzeugt und via `sync-outbox` an die Cloud gepusht. Cloud ist
Source-of-Truth (10 Jahre); Edge hält die letzten Eintraege hot, wird in
einer Folgephase auf 90 Tage zurueckgeschnitten.

## Architektur (Sidecar-Pattern)

```
Edge-Mutation (z. B. POST /orders)
  ↓ canonicalLog (around.all)         — Wide Event (stdout)
  ↓ logError
  ↓ allowApiKey
  ↓ secureByDefault (auth + authorize)
  ↓ captureAuditBefore                — laedt Vor-Zustand fuer patch/remove
  ↓ Service exec (KnexService)
  ↓ ensureTenantIsolation
  ↓ recordSyncOutbox                  — Edge→Cloud-Outbox
  ↓ recordAuditEvent                  — Audit-Trail (parallel zu sync-outbox)
       ↓ INSERT in `audit-events`
       — append-only via Service + DB-Trigger
       — Eintrag selbst wird via sync-outbox in Cloud gespiegelt
```

Wide Events bleiben stdout; Audit ist persistente State-of-Record.
Cross-Reference via `correlationId == requestId`.

## Datenmodell

Schema in `@panary-core/audit-events/domain` (TypeBox).

| Feld | Typ | Zweck |
|---|---|---|
| `_id` | uuidv7 | Primary Key |
| `tenantId` | uuidv7 | Tenant-Isolation (Pflicht-Index) |
| `locationId` | uuidv7 \| null | null = tenant-globaler Eintrag (z. B. Login) |
| `occurredAt` | ISO 8601 | Server-Zeit der Mutation |
| `actor` | `{ userId, role, sessionId?, ipAddress?, userAgent?, deviceId?, requestId }` | Wer hat ausgeloest |
| `target` | `{ resource, entityType, entityId, entityRef? }` | Was wurde betroffen |
| `action` | `AuditAction` | Konkrete Geschaeftsaktion (CREATE, VOID, REFUND, PRICE_CHANGE, ...) |
| `category` | `AuditCategory` | TRANSACTION, CASH, PRICING, TIME, ACCESS, CONFIGURATION, DATA_MUTATION |
| `outcome` | SUCCESS \| FAILURE | |
| `severity` | INFO \| NOTICE \| WARNING \| ALERT | UI-Filter |
| `before` / `after` / `diff` | JSON | Optional, sensitive Felder maskiert |
| `metadata` | JSON | z. B. dailySequenceNumber, grossAmount, orderId |
| `correlationId` | requestId | Cross-Ref zu Wide Events |

Flache Index-Spalten zusaetzlich persistiert: `actor_userId`,
`target_resource`, `target_entityType`, `target_entityId` — alle
tenant-prefixed indiziert.

## Resource-Whitelist

Datei: `libs/domains/audit-events/domain/src/lib/audit-resource-map.ts`.
Nur whitelisted Mutationen erzeugen Events. Liste fuer MVP (Kern-Gastronomie):

| Service | Methode | Action | Category |
|---|---|---|---|
| orders | create | CREATE | TRANSACTION |
| orders | patch | UPDATE | TRANSACTION |
| orders | remove | DELETE | TRANSACTION |
| order-interactions | create | VOID/REFUND/DISCOUNT/UPDATE¹ | TRANSACTION |
| products | patch | UPDATE oder PRICE_CHANGE¹ | PRICING |
| users | patch | UPDATE oder PERMISSION_CHANGE¹ | CONFIGURATION |
| users | checkin/checkout/startBreak/endBreak | CLOCK_IN/OUT/BREAK_*¹ | TIME |
| apikeys | create/remove | API_KEY_CREATE/REVOKE | ACCESS |
| working-times | create/patch | CLOCK_IN/UPDATE | TIME |
| customers | patch/remove | UPDATE/DELETE | DATA_MUTATION |
| write-offs | create | WRITE_OFF | CASH |
| authentication | create | LOGIN/LOGIN_FAILED² | ACCESS |

¹ Sub-Action zur Laufzeit aus `data.interactionType` / Diff abgeleitet.
² Eigener Hook `record-auth-audit-event.hook.ts`, registriert auf
`authentication`-Service in `authentication.ts`.

## Immutability

Zwei Schichten:

1. **App-Layer** — `audit-events`-Service registriert nur `find`/`get`/`create`
   (`apps/api-edge/src/services/audit-events/audit-events.ts`). Externe `create`
   wirft `Forbidden`. Methoden update/patch/remove sind nicht im methods-Array
   und werden von Feathers automatisch mit `MethodNotAllowed` abgelehnt.
2. **DB-Layer** — SQLite-Trigger `audit_events_no_update` und
   `audit_events_no_delete` werfen `RAISE(FAIL, ...)` bei jedem
   `UPDATE`/`DELETE`. Faengt direkten Knex-Bypass ab.

   Migration: `apps/api-edge/migrations/20260506000001_audit_events.ts`.

   ```sql
   CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON "audit-events"
     BEGIN SELECT RAISE(FAIL, 'audit-events ist append-only — UPDATE nicht erlaubt'); END;
   CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON "audit-events"
     BEGIN SELECT RAISE(FAIL, 'audit-events ist append-only — DELETE nicht erlaubt'); END;
   ```

## Tenant-Isolation

- Service-Hook-Chain: `authenticate('jwt')` → `authorize()` → `multiTenancy({ isolateLocation: false, allowGlobalData: true })` → resolveExternal → resolveResult.
- Globaler `ensureTenantIsolation`-After-Hook prueft jeden zurueckgegebenen
  Datensatz gegen `user.tenantId` — Schutz auch bei fehlerhafter Query.
- TENANT_STAFF und Geraete-Rollen haben keinen READ — nur TENANT_OWNER,
  TENANT_MANAGER, TENANT_TECHNICIAN. PLATFORM_OWNER hat Bypass.

## Cloud-Sync

`audit-events` ist in `SyncableTransactionService` (in
`@panary-core/edge-pairing/domain`) und in `TRANSACTION_PATHS` von
`sync-outbox-recorder.hook.ts` enthalten. Jede Audit-Eintrag-Erzeugung
schreibt einen `sync-outbox`-Eintrag mit `service: 'audit-events'`. Der
Push-Service in `panary-cloud` empfaengt und persistiert in der
gleichnamigen MongoDB-Collection (`tenant-audit-events`-Service in
`panary-cloud/apps/api-cloud/src/services/audit-events/`).

Self-Skip in `record-audit-event.hook.ts` (Set
`AUDIT_NEVER_AUDIT_PATHS = ['audit-events', 'sync-outbox', 'sync-cursor', 'sync-conflicts']`)
verhindert Recursive-Loops.

## Sensitive-Felder-Maskierung

In `record-audit-event.hook.ts` werden vor dem Persist Felder aus
`SENSITIVE_FIELDS = ['password', 'posPin', 'apikey', 'secret', 'token']`
durch `'***REDACTED***'` ersetzt — sowohl in `before`/`after` als auch
im Diff.

`resolveExternal` in `audit-events.ts` blendet `before`/`after`/`diff`
fuer Rollen ohne `CAN_READ_SENSITIVE_USER_DATA`-Ability aus (PII-Schutz).

## Auth-Audit (Login)

Eigener Hook `record-auth-audit-event.hook.ts` mit zwei Funktionen:

- `recordAuthSuccess` — after.create auf `authentication` → LOGIN
- `recordAuthFailure` — error.create auf `authentication` → LOGIN_FAILED

LOGIN_FAILED wird verworfen, wenn die `tenantId` nicht aus der
attemptedEmail/Loginname aufloesbar ist (Brute-Force mit zufaelligen
Loginnames produziert keine tenant-losen Audits).

## Indizes

Alle tenantId-prefixed (siehe Migration):

- `idx_audit-events_tenant_time` — Standard-Filter (Listing nach Zeit)
- `idx_audit-events_tenant_resource_time` — pro Service-Pfad filtern
- `idx_audit-events_tenant_actor_time` — pro User filtern
- `idx_audit-events_tenant_entity` — Drill-Down auf Entity-Verlauf
- `idx_audit-events_tenant_category_time` — UI-Kategorie-Filter
- `idx_audit-events_tenant_action_time` — UI-Action-Filter
- `idx_audit-events_tenant_location_time` — Filiale-Filter
- `idx_audit-events_correlation` — Cross-Ref zu Wide Events

## Phase 2 — Edge-Cleanup-Worker

`apps/api-edge/src/workers/audit-cleanup.worker.ts` laeuft nightly (Default
02:00 lokale Zeit + bis zu 5 Minuten Jitter) und loescht Eintraege:

- aelter als `retentionDays` (Default 90)
- UND mit `sync-outbox.status = 'acked'` (Cloud hat den Eintrag persistiert)

Wenn die Cloud seit > `cloudReachableMaxAgeDays` (Default 7) nicht
erreichbar war, wird der Lauf uebersprungen — verhindert Datenverlust bei
laengerem Sync-Ausfall. Standalone-Edges (ohne Pairing) cleanen ohne
Cloud-Check.

**Trigger-Bypass**: Der Worker droppt `audit_events_no_delete` in einer
Knex-Transaction, fuehrt das DELETE aus und legt den Trigger im selben
Block wieder an. Bei Crash zwischen DROP und CREATE: SQLite rollt zurueck,
der Trigger bleibt aktiv. Dies ist die einzige Stelle, an der die
Append-only-Garantie temporaer ausgesetzt wird.

**Selbst-Audit**: Pro Cleanup-Lauf wird ein Audit-Event mit
`action: AUDIT_CLEANUP`, `category: CONFIGURATION`, `metadata: { deletedCount,
retentionDays, cutoff }` geschrieben (pro Tenant separat).

Konfiguration in `apps/api-edge/config/default.json`:
```json
"auditCleanup": {
  "enabled": true,
  "retentionDays": 90,
  "hour": 2,
  "minuteJitterMs": 300000,
  "cloudReachableMaxAgeDays": 7,
  "batchSize": 1000
}
```

## Phase 2 — Manuelle Redactions

Edge ist **read-only** fuer Redactions. Manuelle Loeschungen werden
ausschliesslich in der Cloud durchgefuehrt (siehe panary-cloud Doku).
Edge-Eintraege werden vom Cleanup-Worker basierend auf Alter und
Sync-Ack-Status physisch entfernt — die Redaction-Markierung in der Cloud
beeinflusst dies nicht.

## Out of Scope (Phase 3)

- Hash-Chain (`prevHash`/`hash`) fuer GoBD-Tamper-Evidence
- Tracking weiterer Resources (devices, locations, pre-orders, recipes,
  ingredients, opening-hour-exceptions, businessdays, product-groups)
- TSE/KassenSichV-Integration
- Async-Queue / Sampling
