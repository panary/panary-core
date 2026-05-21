---
title: Geschäftstag — Automatische Rotation (Standalone) + Zeit-Guard
date: 2026-05-22
category: Architektur
domains: [businessdays, orders]
status: implemented
---

# Geschäftstag — Automatische Rotation (Standalone) + Zeit-Guard

Ergänzt die [Tagesabschluss-Architektur](tagesabschluss-architektur.md) um zwei
Mechanismen, die verhindern, dass im Standalone-Modus Bestellungen still auf
einem veralteten Geschäftstag landen.

## Problem

Im Standalone-Modus rotierte der Geschäftstag bislang nur an **zwei** Stellen:

1. **Boot-Pfad** — `autoEnsureBusinessDay()` läuft genau **einmal** beim
   Server-Start (`main.ts`).
2. **Lazy beim Order-Create** — der Hook `restrict-order-to-business-day`
   rotiert beim ersten Order des neuen Tages.

Beide Pfade werden durch noch **aktive Bestellungen** im alten Tag bewusst
blockiert (`hasActiveOrders` → keine Tab-Aufspaltung über zwei Geschäftstage).

Es existierte **kein** zeitgesteuerter Trigger (Cron/Worker). Lief der Edge über
Mitternacht durch, blieb der Geschäftstag bis zur nächsten Bestellung auf dem
Vortag. Lagen zusätzlich offene Bestellungen vor, akkumulierte neuer Umsatz
**ohne jede Ablehnung oder Warnung** auf dem veralteten Tag. Die vorhandene
`maxOrderDifferenceDays`-Regel (kalendertag-basiert, Default 1) greift im
Standalone-Pfad gar nicht — sie wird nur im Enterprise-ohne-Cloud-Pfad erreicht.

## Entscheidung

### A — Standalone-Rotations-Worker

Neuer Worker `apps/api-edge/src/workers/business-day-rotation.worker.ts`,
modelliert nach `audit-cleanup.worker.ts` (self-rescheduling `setTimeout` via
`computeDelayUntilHour`). Er ruft zeitgesteuert die **bestehende**
`autoEnsureBusinessDay(app)`-Logik auf — keine Duplizierung von Gate-,
Aktive-Orders- oder Rotations-Logik.

- Registrierung in `main.ts` bei den übrigen nightly-Workern.
- Config `businessDayRotation: { enabled, hour, minuteJitterMs }` in
  `config/default.json` + `configuration.ts`-Schema. Default `hour: 4`.
- **UTC-Anker-Caveat:** `autoEnsureBusinessDay` ankert `today` auf das
  **UTC**-Datum. Der Worker feuert zur **lokalen** Stunde. In CET/CEST
  (UTC+1/+2) ist `hour: 4` lokal sicher nach UTC-Mitternacht → Rotation greift.
  Eine niedrigere Stunde (0–2) läge in CEST noch im UTC-Vortag. Die
  UTC-vs-Lokal-Datumssemantik bleibt systemweit unverändert (Sync-Konsistenz).

### B — Zeit-Guard „seit Öffnung"

Im Aktive-Orders-Block-Branch von `restrict-order-to-business-day.ts`: bevor eine
neue Order dem veralteten Tag zugeordnet wird, prüft `ensureBusinessDayNotOpenTooLong`
das Alter seit `openedAt`.

- Schwelle `maxBusinessDayOpenHours` (Default **24h**), `app.get(...) || 24`.
- Überschreitung → `400 BadRequest` mit Code `BUSINESS_DAY_OPEN_TOO_LONG`
  (`BD_6003`), Daten `{ openHours, maxAllowedOpenHours }`.
- Helper `getHoursSince(iso)` in `business-day.utils.ts` — bewusst **rollend**
  (echte Zeitspanne), nicht kalendertag-basiert, robust gegen UTC-Off-by-one
  nahe Mitternacht. Deckt sich mit „bei spätabendlicher Öffnung gilt die
  Bestellung bis ~24h später".

## Konsequenzen

- Normalfall (keine offenen Alt-Orders): Tag rotiert automatisch zur konfigurierten
  Stunde — kein Server-Neustart, kein „erster Order" mehr nötig.
- Blockierter Fall (offene Alt-Orders + Tag > 24h offen): POS **verweigert** neue
  Bestellungen mit klarer Operator-Aufforderung, offene Bestellungen abzuschließen.
- Cloud-Connected-Modus unverändert: `autoEnsureBusinessDay` überspringt selbst
  (`isLocalRotationAllowed`), Lifecycle bleibt Cloud-gesteuert.

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `apps/api-edge/src/workers/business-day-rotation.worker.ts` | NEU — Rotations-Worker |
| `apps/api-edge/src/main.ts` | Worker-Registrierung |
| `apps/api-edge/src/configuration.ts` | Schema `businessDayRotation`, `maxBusinessDayOpenHours` |
| `apps/api-edge/config/default.json` | Config-Defaults |
| `apps/api-edge/src/hooks/restrict-order-to-business-day.ts` | Zeit-Guard `ensureBusinessDayNotOpenTooLong` |
| `apps/api-edge/src/utils/business-day.utils.ts` | `getHoursSince` |
| `libs/shared/common/src/lib/errors/app-errors.ts` | Code `BUSINESS_DAY_OPEN_TOO_LONG` |

## Manuelle Verifikation

1. Geschäftstag-`date` auf gestern setzen, Server starten, Worker mit
   `configOverride { hour: <jetzt+1min> }` triggern → neuer Tag mit heutigem
   `date`, alter Tag `status: closed`, Log `[AutoBusinessDay] Neuer Geschaeftstag …`.
2. Offene Order (`status: 'active'`) im gestrigen Tag lassen, `openedAt` > 24h
   zurückdatieren → Order-Create liefert `400 BUSINESS_DAY_OPEN_TOO_LONG`.
   Innerhalb 24h: Order weiterhin akzeptiert.
