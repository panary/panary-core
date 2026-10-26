---
type: Domain Concept
title: Ruhetag-Regel — Verkauf an geschlossenen Tagen nur mit Freigabe
description: Wie Edge und POS einen laut Öffnungszeiten geschlossenen Tag erkennen, was die Standort-Regel closedDayPolicy erlaubt und wie die PIN-Freigabe den Geschäftstag öffnet bzw. stempelt.
tags: [businessdays, locations, orders, pos-client, opening-hours]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-27T00:45:00Z }
sources:
  - { id: adr-0062, resource: ../adr/0062-ruhetag-regel-je-standort.md, title: 'ADR 0062' }
  - { id: issue-1133, resource: 'https://github.com/panary/panary-core/issues/1133', title: 'core#1133' }
---

# Ruhetag-Regel — Verkauf an geschlossenen Tagen nur mit Freigabe

Entscheidung und Begründung: [ADR 0062](../adr/0062-ruhetag-regel-je-standort.md). Diese Seite
beschreibt, wie es läuft.

## Wann ist Ruhetag?

`closedDayStatus(location, exceptions, now)` aus `@panary/locations/domain`:

| Lage | Urteil | `reason` |
| --- | --- | --- |
| `openingHoursSettings.enabled !== true` | `unknown` | `opening-hours-disabled` |
| Ausnahme der Filiale für das Datum | `closed`/`open` nach `closed` der Ausnahme | `exception` |
| Wochentag in `regular` | `closed`/`open` | `regular` |
| Wochentag fehlt in `regular` | `unknown` | `weekday-missing` |

Das Datum ist der Kalendertag in `generalSettings.timezone` (Fallback `Europe/Berlin`). Ausnahmen
fremder Filialen und anderer Tage werden verworfen. Nur `closed` löst etwas aus.

## Die Regel des Standorts

`openingHoursSettings.closedDayPolicy`, gepflegt in der Cloud:

| Wert | Wer darf freigeben |
| --- | --- |
| fehlt / `manager-approval` | `tenant:manager`, `tenant:owner` |
| `block` | nur `tenant:owner` (Ausweg; regulär öffnet eine Ausnahme „heute geöffnet“) |

`resolveClosedDayPolicy`, `canApproveClosedDay`, `CLOSED_DAY_APPROVER_ROLES` liegen in derselben Lib.

## Ablauf an der Edge

1. **Auto-Rotation** (Boot, 4-Uhr-Worker, Lazy-Rotation im Order-Hook) eröffnet am Ruhetag keinen
   Tag: `business_day.rotation_skipped_closed_day` mit `trigger: scheduled | order`.
2. **Gate** (`utils/closed-day-gate.ts`) an Order-Anlage (`restrictOrderToBusinessDay`), Kassieren
   (`restrictOrderCompletionToClosedDay`, Patch auf `completed`) und `openDay` von außen: ohne heute
   gültigen Stempel am laufenden Tag 400 `BD_6010` mit `data.date` und `data.policy`.
3. **Freigabe** `businessdays.approveClosedDay({ authorizedByUserId, pin })`:
   PIN (`users.verifyPin`, mandantengebunden) → Rolle nach Regel → ggf. Tag eröffnen
   (Standalone/Override, Tageswechsel fällig, keine offenen Bestellungen am Vortag) → Stempel
   `openedOnClosedDayBy|Role|At|Date` → Audit-Event `closed-day-approved` →
   Log `business_day.closed_day_approved`. Ist heute kein Ruhetag: `approved: false`, nichts geprüft.
4. **Vorabfrage** `businessdays.getClosedDayStatus()` → `{ approvalRequired, state, date, policy }`.

Fehlercodes: `BD_6010` Ruhetag ohne Freigabe, `BD_6011` PIN falsch, `BD_6012` Rolle reicht nicht.

## POS

- **Kasse:** `ensureClosedDayApproval` vor `#placeOrder` — der Warenkorb bleibt bei Abbruch stehen.
  Scheitert die Vorabfrage (Edge offline, ältere Edge), geht es weiter; erzwungen wird an der Edge.
- **Bar-Kassieren:** `OrderCheckoutService.payCash` fragt bei `BD_6010` einmal nach
  (`requestClosedDayApproval`), danach ggf. die Kasse (`BD_6004`).
- **Tag eröffnen:** `OpeningDialogComponent` zeigt bei `BD_6010` den Dialog; die Freigabe eröffnet
  den Tag selbst.
- Dialog: `ClosedDayApprovalDialogComponent` (`@panary/businessdays/feature-pos-closing-dialog`),
  Texte unter `CLOSED_DAY.*`.

## Was der Stempel nicht tut

Er reist nicht in die Cloud — Geschäftstage synchronisieren nur Cloud→Edge. Nachvollziehbar wird die
Freigabe dort über das Audit-Event. Setzt die Cloud den Stempel (cloud#1471), kommt er per Pull an.

## Betroffene Dateien

- `libs/domains/locations/domain/src/lib/closed-day.ts`, `location.schema.ts`
- `libs/domains/businessdays/domain/src/lib/business-day.schema.ts`,
  `apps/api-edge/migrations/20261027120000_businessdays_add_closed_day_approval.ts`
- `apps/api-edge/src/utils/closed-day-gate.ts`, `hooks/restrict-order-to-business-day.ts`,
  `hooks/restrict-order-completion-to-closed-day.ts`, `bootstrap-business-day.ts`,
  `services/business-days/business-days.ts`
- `libs/domains/businessdays/feature-pos-closing-dialog/src/lib/closed-day-*.ts`,
  `libs/domains/orders/data-access/src/lib/services/order-checkout.service.ts`
