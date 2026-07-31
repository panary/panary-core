---
type: Domain Concept
title: Verwaiste Geschäftstage — Ursache, Prävention, Bereinigung
description: Warum pro Filiale mehrere Geschäftstage gleichzeitig offen bleiben konnten, wie die Rotation das jetzt verhindert und wie ein bereits entstandener Verwaister verworfen wird.
tags: [businessdays, sync]
status: stable
generated: { by: claude-code/opus-5, at: 2026-07-31T20:20:00Z }
---

# Verwaiste Geschäftstage

Ergänzt die [Automatische Rotation](geschaeftstag-auto-rotation.md) und die
[Tagesabschluss-Architektur](tagesabschluss-architektur.md) um den Fehlerfall,
in dem eine Filiale **mehrere gleichzeitig offene** Geschäftstage hat.

## Problem

Beobachtet am 31.07.2026 auf einer Produktiv-Edge: die Geschäftstags-Liste im
Admin zeigte den 27.07. als `offen`, den 28.07. und 29.07. als `geschlossen` und
den 30.07. wieder als `offen`. Der 27.07. ließ sich über keine Oberfläche
abschließen und existierte in der Cloud nicht.

Pro Filiale darf genau **ein** Tag offen sein. Die Prüfung dafür lebte
ausschließlich in `openDay()`
(`apps/api-edge/src/services/business-days/business-days.ts`). Zwei Mechanismen
umgingen sie:

1. **`rotateBusinessDay` schloss nur das Zeiger-Ziel.**
   `apps/api-edge/src/utils/business-day.utils.ts` patchte ausschließlich den
   Tag, auf den `location.currentBusinessDay.businessDayId` zeigte, und rief
   danach `businessdays.create` **direkt** auf — am `openDay()`-Guard vorbei.
   Driftete der Zeiger einmal, blieb der alte Tag für immer offen: die nächste
   Rotation schloss wieder nur das neue Zeiger-Ziel.

2. **`reconcileLocationBusinessDay` erzeugte genau diesen Drift.**
   `apps/api-edge/src/workers/cloud-bootstrap-runner.worker.ts` iterierte über
   *alle* offenen Tage und patchte den Location-Zeiger in jedem Durchlauf — bei
   zwei offenen Tagen gewann eine beliebige Zeile („last row wins",
   Reihenfolge undefiniert).

Es gab keinen DB-Constraint gegen den Zustand: `idx_businessdays_date` ist
nicht-unique, und `before.create` hatte keinen Guard.

### Warum der Tag nicht abschließbar war

Drei Sperren gleichzeitig:

| Weg | Warum er nicht greift |
|---|---|
| `closeDay` | `guardCloudManagedLifecycle` wirft `Forbidden`, sobald der Edge gepairt ist. Ohne Pairing liefe er durch, bliebe aber mangels Cloud-Report in `closing-requested` hängen. |
| `patch` / `remove` | `cloudManagedHook` blockt externe Writes bei aktivem Pairing. |
| Cloud-Sync | `businessdays` ist reines Pull-Master-Data. Ein Tag, den die Cloud nie kannte, bekommt dort auch nie einen Tombstone. |

## Entscheidung

**Prävention** (behebt die Ursache):

- `rotateBusinessDay` schließt die Vereinigungsmenge aus „alle offenen Tage der
  Location" und dem Zeiger-Ziel. Das Zeiger-Ziel bleibt als Netz drin, falls die
  Query es nicht liefert.
- `reconcileLocationBusinessDay` setzt den Zeiger deterministisch auf den
  jüngsten offenen Tag je Location.
- Neuer Hook `ensure-single-open-business-day.hook.ts` in `before.create`.
  Ausnahmen: `params.fromSync` (die Cloud ist Source-of-Truth und darf pushen,
  was der Edge für überlappend hält — ein 400 im Sync-Apply wäre **terminal**),
  Records ohne `locationId`, explizit nicht-offene Records. Fail-open bei
  Lookup-Fehlern: ein transienter DB-Fehler darf die Boot-Rotation nicht
  blockieren, sonst gibt es keinen Geschäftstag und damit keine Bestellungen.

Beide Pfade protokollieren den Zustand als Wide Event
`business_day.multiple_open_days`.

**Bereinigung** (für bereits entstandene Duplikate): Custom-Method
`discardOrphanDay({ businessDayId })` auf `businessdays`, gemappt auf
`AppAction.DELETE`.

## Was als „verwaist" gilt

Die Erkennung im Admin (`business-days-list.ts`) ist eine reine Anzeige-Heuristik:
pro `locationId` gilt der jüngste offene Tag als der echte, alle älteren als
verwaist. **Die Gruppierung nach Filiale ist nicht optional** — ein Tenant mit
mehreren Filialen hat legitim mehrere offene Tage gleichzeitig, und
`TENANT_OWNER`/`TENANT_MANAGER` sehen über `multiTenancy` alle Filialen.

Die verbindliche Prüfung macht ausschließlich das Backend, mit sieben Guards vor
jeder Mutation:

| # | Guard | Warum |
|---|---|---|
| 1 | authentifizierter externer Aufruf | der Vorgang muss einem Akteur zurechenbar sein |
| 2 | Tag existiert, gehört dem Tenant | Tenant-Isolation |
| 3 | `status === 'open'` | geschlossene und freigegebene Tage sind unantastbar |
| 4 | nicht der aktuelle Tag der Filiale | der laufende Tag ist per Definition kein Verwaister |
| 5 | `openedBy == null` | `rotateBusinessDay` sendet kein `openedBy`, `openDay()` setzt `user._id`. Fehlt es, stammt der Tag aus der lokalen Auto-Rotation — genau der Fall, den die Cloud nie gesehen hat. |
| 6 | 0 Bestellungen | |
| 7 | 0 Kassensitzungen | |

**Belege werden bewusst nicht separat geprüft:** `receipts` hat kein
`businessDayId`, sie hängen über `orderId` an der Bestellung. Bei 0 Bestellungen
kann es keinen Beleg zu diesem Tag geben — Guard 6 deckt sie transitiv ab.

Zähl-Fehler brechen ab statt fail-open zu löschen. Liefert ein Service ein Array
statt eines paginierten Ergebnisses (Pagination abgeschaltet), wird `.length`
ausgewertet — `.total` wäre `undefined` und der Guard liefe ins Löschen.

## Fiskalische Einordnung

Gelöscht wird ausschließlich ein Tag **ohne jeden Geschäftsvorfall**. Ein Tag mit
Umsatz ist kein Verwaister, sondern ein Datenproblem — der darf über diesen Pfad
nie verschwinden; die Meldung verweist dort auf den Support.

Der Vorgang schreibt **vor** dem Löschen ein Audit-Event (nach dem `remove`
wären die `before`-Daten weg) mit
`metadata.reason = 'orphan-business-day-discarded'` und Severity `ALERT`.
`audit-events` steht in `SyncableTransactionService`, der Löschvorgang ist damit
auch dann in der Cloud nachweisbar, wenn der gelöschte Tag dort nie existierte.

Bewusst `AuditAction.DELETE` statt eines neuen Enum-Werts: `audit-events` wird in
die Cloud gepusht und dort gegen dasselbe Enum validiert — ein unbekannter Wert
würde den Sync terminal rejecten (siehe
[Sync-Härtung](sync-outbox-re-enqueue.md)).

## Offen

Ein **partieller Unique-Index**
(`… ON businessdays (tenantId, locationId) WHERE status = 'open'`) wäre der
sauberste Endzustand. Er ist bewusst **nicht** Teil dieser Änderung: die
Migration würde auf jeder Installation scheitern, die bereits Duplikate hat. Erst
nach der Bereinigung, und dann defensiv — Duplikate erkennen, **nicht**
automatisch schließen (fiskalisch), bei Duplikaten den Index-Aufbau überspringen
und laut warnen.

## Beteiligte Dateien

- `apps/api-edge/src/utils/business-day.utils.ts` — `rotateBusinessDay`
- `apps/api-edge/src/workers/cloud-bootstrap-runner.worker.ts` — `reconcileLocationBusinessDay`
- `apps/api-edge/src/hooks/ensure-single-open-business-day.hook.ts`
- `apps/api-edge/src/services/business-days/business-days.ts` — `discardOrphanDay`
- `libs/shared/backend/src/hooks/authorize.hook.ts` — `METHOD_TO_ACTION`
- `apps/admin-client/src/app/features/business-days/business-days-list.ts`
