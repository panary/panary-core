---
type: Domain Concept
title: Geschäftstag — Automatische Rotation (Standalone) + Zeit-Guard
description: Nightly Rotations-Worker rotiert den Geschäftstag zeitgesteuert und ein Zeit-Guard verweigert neue Bestellungen, wenn der Tag länger als die Schwelle offen ist — gemessen ab openedAt, pro Standort konfigurierbar.
tags: [businessdays, orders]
status: stable
generated: { by: claude-code/historic, at: 2026-05-22T00:00:00Z }
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

- Schwelle `maxBusinessDayOpenHours` (Default **26 h** seit ADR 0047 — vorher 24;
  siehe Abschnitt C zur Auflösung inkl. Standort-Override).
- Überschreitung → `400 BadRequest` mit Code `BUSINESS_DAY_OPEN_TOO_LONG`
  (`BD_6003`), Daten `{ openHours, maxAllowedOpenHours }`. Bewusst ein **anderer**
  Code als beim reinen Altersüberschreiten (`BUSINESS_DAY_TOO_OLD`, Abschnitt C):
  Hier muss der Operator erst die offenen Bestellungen abschließen, dann rotiert
  der Tag von selbst — eine andere Handlung, also eine andere Meldung.
- Helper `getHoursSince(iso)` in `business-day.utils.ts` — bewusst **rollend**
  (echte Zeitspanne), nicht kalendertag-basiert, robust gegen UTC-Off-by-one
  nahe Mitternacht. Deckt sich mit „bei spätabendlicher Öffnung gilt die
  Bestellung bis ~24h später".

### C — Stundenschwelle statt Kalendertag, pro Standort konfigurierbar

`maxBusinessDayOpenHours` ist ein deployment-weiter Config-Wert — in einem
Multi-Tenant-Betrieb das falsche Granulat. Seit 2026-08-10 trägt das
Location-Schema deshalb eine optionale Gruppe:

```ts
settings.businessDaySettings?.maxOpenHours   // Integer, 1…168
```

Nicht gesetzt = Server-Default (`maxBusinessDayOpenHours`), also unverändertes
Verhalten für jeden Bestands-Standort.

Auflösung: Standort-Wert → `maxBusinessDayOpenHours` aus der Config → Hauskonstante
26. Identisch zur Cloud (`restrict-order-to-business-day.hook.ts`); der Config-Default
wurde von 24 auf 26 gezogen, damit beide Gates nicht unterschiedlich früh sperren.

**Was der gepairte Betrieb vorher tat.** Der CONNECTED-Zweig warf `BUSINESS_DAY_NOT_SET`,
sobald `currentBusinessDay.date !== today` — ohne jede Toleranz, und `today` kam aus
`toISOString().slice(0,10)`, also **UTC**, während die Cloud den Geschäftstag in
Filial-Lokalzeit stempelt. In CEST sprang die Sperre damit um **02:00 Ortszeit**: Ein
gepairter Edge konnte keinen Geschäftstag über Mitternacht betreiben. Dieser Zweig ist
ersatzlos entfallen; ein veraltetes **Datum** ist kein Grund mehr, ein zu langer
**Betrieb** schon.

`validateBusinessDayAge` (kalendertagsbasiert, strukturell nie erreichbar) und sein
Helper `getDifferenceInDays` sind mit entfernt — unter der neuen Regel gäbe es nichts
mehr, was sie messen könnten. `maxOrderDifferenceDays` existiert damit nirgends mehr.

- Überschreitung → `400 BadRequest` mit `BUSINESS_DAY_TOO_OLD` (`BD_6002`), Meldung
  auf Deutsch mit Datum, Laufzeit und Grenze; Vokabular je `operationMode` nach
  panary-cloud ADR 0037 („Betriebstag beenden" statt „Tagesabschluss" im Bestellbetrieb).
- Fehlt ein brauchbarer `openedAt`, wird die Altersprüfung **übersprungen** und
  geloggt (`business_day.age_check_skipped`) statt zu sperren — eine Sperre soll aus
  dem Betrieb kommen, nicht aus einem Datenfehler.
- Der Hook liest die Location bewusst **ohne `$select`**: `settings` steht nicht in
  `locationQueryProperties`, ein `$select` darauf scheitert am Query-Validator.

Die gemeinsame Entscheidung (Stundenschwelle statt Kalendertags-Vergleich, für
**beide** Repos) steht in `panary-cloud/docs/adr/0047-order-gate-stundenschwelle.md`.
Sie bestätigt die Begründung aus Abschnitt B: `getHoursSince` wurde dort bereits
bewusst rollend statt kalendertag-basiert gebaut, „robust gegen UTC-Off-by-one
nahe Mitternacht" — genau der Defekt, an dem der Cloud-Gate scheiterte. Der Edge
hatte die richtige Form also längst; sie hing nur an einem Zweig, den der gepairte
Betrieb nie erreicht.

> ⚠️ **Die Auto-Rotation bleibt kalendertagsbasiert** (`shouldAutoRotate`, UTC-Datum) —
> das ist Absicht: „ein neuer Tag bekommt einen neuen Geschäftstag" ist ein
> Kalenderbegriff. Nur die **Sperre** hängt nicht mehr daran. Der UTC-Anker der
> Rotation behält damit den Caveat aus Abschnitt A.

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
| `libs/domains/locations/domain/src/lib/location.schema.ts` | `settings.businessDaySettings.maxOpenHours` (Abschnitt C) |
| `apps/api-edge/src/utils/business-day.utils.ts` | `getDifferenceInDays` entfernt (Abschnitt C) |

## Manuelle Verifikation

1. Geschäftstag-`date` auf gestern setzen, Server starten, Worker mit
   `configOverride { hour: <jetzt+1min> }` triggern → neuer Tag mit heutigem
   `date`, alter Tag `status: closed`, Log `[AutoBusinessDay] Neuer Geschaeftstag …`.
2. Offene Order (`status: 'active'`) im gestrigen Tag lassen, `openedAt` > 24h
   zurückdatieren → Order-Create liefert `400 BUSINESS_DAY_OPEN_TOO_LONG`.
   Innerhalb 24h: Order weiterhin akzeptiert.
