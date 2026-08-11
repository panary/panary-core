---
type: Domain Concept
title: Geschäftstag — Automatische Rotation (Standalone) + Zeit-Guard
description: Der Geschäftstag rotiert am Kalendertagswechsel der Filiale und erst nach 10 Stunden Laufzeit, ein Zeit-Guard verweigert neue Bestellungen jenseits der Schwelle — beides gemessen ab openedAt, pro Standort konfigurierbar.
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
- **Zeitzonen-Hinweis:** Der frühere UTC-Anker-Caveat ist mit Abschnitt D entfallen —
  `autoEnsureBusinessDay` ankert `today` nicht mehr auf UTC, `hour: 4` ist damit keine
  Absicherung gegen UTC-Mitternacht mehr, sondern schlicht die Stunde nach Betriebsende.
  Was bleibt: Der Worker feuert zur Stunde der **Server**-Zeitzone, entschieden wird in der
  der **Filiale**. Laufen die beiden auseinander, kann der Lauf leer ausgehen — dann rotiert
  die Lazy-Rotation im Order-Hook nach. Regelfall ist die Box in der Filiale.

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

Seit 2026-08-11 trägt dieselbe Gruppe ein zweites, **rein cloud-seitig wirksames** Feld:

```ts
settings.businessDaySettings?.autoRotate   // Boolean, Default false
```

Es ist das Opt-in des Betreibers, einen überlangen Betriebstag **cloud-seitig** beenden und
den nächsten eröffnen zu lassen (panary-cloud ADR 0048 Stufe 2, panary/panary-cloud#177).
Der Edge liest es nicht und wird es nicht lesen: Seine Rotation hängt an
`isLocalRotationAllowed()` und ist im gepairten Betrieb ohnehin aus (ADR 0005) — genau die
Lücke, aus der die Überlängen-Eskalation entstanden ist. Das Feld steht hier, weil das
Location-Schema hier steht, nicht weil der Edge es auswertet.

Bewusst **kein** Feature-Flag: „meine Filiale darf automatisch rotieren" ist eine
Betreiber-Entscheidung, kein Rollout-Schalter. Ohne Opt-in ändert sich für einen Standort
nichts. Das Gate auf `orders-only` sitzt cloud-seitig und liest den bei Eröffnung
eingefrorenen `businessDay.operationMode`, nicht den der Location — bei `pos-cashier`
verbietet ADR 0048 den Auto-Abschluss (ein Z-Bon ohne Ist-Zählung ist fiskalisch schlechter
als der lange Tag, § 146 Abs. 1 S. 2 AO).

Die gemeinsame Entscheidung (Stundenschwelle statt Kalendertags-Vergleich, für
**beide** Repos) steht in `panary-cloud/docs/adr/0047-order-gate-stundenschwelle.md`.
Sie bestätigt die Begründung aus Abschnitt B: `getHoursSince` wurde dort bereits
bewusst rollend statt kalendertag-basiert gebaut, „robust gegen UTC-Off-by-one
nahe Mitternacht" — genau der Defekt, an dem der Cloud-Gate scheiterte. Der Edge
hatte die richtige Form also längst; sie hing nur an einem Zweig, den der gepairte
Betrieb nie erreicht.

> ⚠️ **Die Auto-Rotation bleibt kalendertagsbasiert** (`shouldAutoRotate`) — das ist
> Absicht: „ein neuer Tag bekommt einen neuen Geschäftstag" ist ein Kalenderbegriff.
> Nur die **Sperre** hängt nicht mehr daran. Welcher Kalender gilt und wann die
> Rotation trotz Tageswechsel wartet, steht in Abschnitt D.

### D — Kalendertag der Filiale + Mindest-Laufzeit

Entscheidung und Herleitung: [ADR 0024](../adr/0024-geschaeftstags-rotation-in-filialzeit.md).
Kurzfassung:

**Der Kalendertag ist der der Filiale, nicht der von UTC.**
`apps/api-edge/src/utils/business-day-date.ts` liefert `businessDateForTimezone(now, tz)` und
`businessDateForLocation(location, now?)`; die Zone kommt aus
`settings.generalSettings.timezone` (Fallback `Europe/Berlin`, auch bei ungültiger Angabe).
Alle drei Einstiegspunkte aus dem Problem-Abschnitt ziehen darauf — ein einziger Begriff von
„heute", und derselbe, den die Cloud beim Stempeln von `businessDay.date` benutzt. Das Feld
reist über den Sync; vorher bekam ein zwischen 00:00 und 02:00 CEST lokal rotierter Tag das
**Vortagesdatum**.

**Rotiert wird erst nach 10 Stunden Laufzeit** (`MIN_OPEN_HOURS_BEFORE_ROTATION`). Ohne diese
Karenz hätte die Zeitzonen-Korrektur das Gegenteil ihres Zwecks bewirkt: In CEST liegt die
lokale Mitternacht **vor** dem UTC-Tageswechsel, das Schnitt-Fenster im Nachtbetrieb wäre von
02:00–04:00 auf 00:00–04:00 gewachsen.

| Ortszeit (CEST) | UTC-`today` | Filial-`today` | rotiert vorher | nur Zeitzone | mit Karenz |
|---|---|---|---|---|---|
| 29.07. 23:59 | 2026-07-29 | 2026-07-29 | nein | nein | nein |
| 30.07. 00:00 | 2026-07-29 | **2026-07-30** | nein | **ja** | nein (6 h) |
| 30.07. 02:00 | **2026-07-30** | 2026-07-30 | **ja** | ja | nein (8 h) |
| 30.07. 04:00 | 2026-07-30 | 2026-07-30 | ja | ja | **ja** (10 h) |

10 ist die Länge des Bezugsfalls 18:00 → 04:00 und liegt weit unter der Sperrschwelle von
26 Stunden (Abschnitt C) — Guard und Order-Gate können sich nie gegenseitig blockieren.
Nebeneffekt: Ein um 23:55 eröffneter Tag rotiert nicht mehr fünf Minuten später.

**Fail-open ohne `openedAt`:** Fehlt ein brauchbarer Zeitstempel, entscheidet wieder allein
der Kalendertag — spiegelbildlich zur Altersgrenze, die denselben Datenfehler überspringt.
Ein blockierender Guard ließe den Tag sonst für immer offen, und das Gate hielte ihn aus
demselben Grund auch nicht auf.

**Ein Read für beide Regeln:** `loadBusinessDayRuntime` liefert Rotations-Guard und
Altersgrenze dieselbe Zahl. Der Boot-Pfad fängt einen verwaisten Zeiger ab
(`business_day.runtime_unreadable`), damit eine kaputte Filiale nicht den Lauf über alle
übrigen abbricht.

> ⚠️ **Bewusst in Kauf genommen:** Ein spät eröffneter Tag (z. B. 22:00) rotiert erst am
> nächsten Vormittag statt um Mitternacht. Beginnt dort früher Service, landen die ersten
> Bestellungen noch auf dem Vortag. Der Fall braucht eine manuelle Abend-Eröffnung mit
> anschließendem Früh-Service und ist selbstheilend.

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
| `libs/domains/locations/domain/src/lib/location.schema.ts` | `settings.businessDaySettings.autoRotate` — cloud-seitiges Opt-in (Abschnitt C) |
| `apps/api-edge/src/utils/business-day.utils.ts` | `getDifferenceInDays` entfernt (Abschnitt C) |
| `apps/api-edge/src/utils/business-day-date.ts` | NEU — Kalendertag in Filialzeit (Abschnitt D) |
| `apps/api-edge/src/utils/business-day.utils.ts` | `MIN_OPEN_HOURS_BEFORE_ROTATION`, `loadBusinessDayRuntime`, `shouldAutoRotate` (Abschnitt D) |
| `apps/api-edge/src/bootstrap-business-day.ts` | liest die `settings`-Spalte mit, Laufzeit pro Location (Abschnitt D) |

## Manuelle Verifikation

1. Geschäftstag-`date` auf gestern setzen **und `openedAt` > 10 h zurückdatieren**, Server
   starten, Worker mit `configOverride { hour: <jetzt+1min> }` triggern → neuer Tag mit
   heutigem `date`, alter Tag `status: closed`, Log `[AutoBusinessDay] Neuer Geschaeftstag …`.
2. Offene Order (`status: 'active'`) im gestrigen Tag lassen, `openedAt` > 24h
   zurückdatieren → Order-Create liefert `400 BUSINESS_DAY_OPEN_TOO_LONG`.
   Innerhalb 24h: Order weiterhin akzeptiert.
3. **Nachtbetrieb (Abschnitt D):** `openedAt` auf „vor 6 Stunden" setzen, `date` auf gestern
   → Order-Create rotiert **nicht**, die Bestellung landet auf dem laufenden Tag. Dasselbe
   mit `openedAt` „vor 11 Stunden" → rotiert.
4. **Zeitzone (Abschnitt D):** `settings.generalSettings.timezone` auf `Pacific/Auckland`
   setzen → der Tageswechsel folgt der neuen Zone, nicht mehr UTC. Ungültige Zone
   (`Nicht/EineZone`) → Fallback `Europe/Berlin`, keine Ausnahme.
