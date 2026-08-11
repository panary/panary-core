---
type: ADR
title: Geschäftstags-Rotation in Filialzeit — Kalendertag der Filiale plus Mindest-Laufzeit
description: Die Auto-Rotation am Edge bestimmt „heute" in der Zeitzone der Filiale statt in UTC und rotiert zusätzlich erst nach 10 Stunden Laufzeit, weil die Zeitzonen-Korrektur allein das Schnitt-Fenster im Nachtbetrieb vergrößert hätte.
tags: [businessdays, orders, sync]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-11T09:20:00.000Z }
---

## Problem

Die Auto-Rotation des Geschäftstags im Standalone-Betrieb entschied an drei Stellen
(`restrict-order-to-business-day.ts`, `bootstrap-business-day.ts`, `business-day-rotation.worker.ts`)
nach demselben Muster:

```ts
const today = new Date().toISOString().slice(0, 10) // UTC
shouldAutoRotate(currentBusinessDay, today) // date !== today
```

Das hat zwei Fehler übereinander gelegt.

**Erstens: der falsche Kalender.** `toISOString()` liefert den UTC-Tag. Die Cloud stempelt
`businessDay.date` seit dem Duplikat-Bug vom 2026-07-30 in **Filial-Lokalzeit**
(`businessDateForTimezone`). Beide Seiten schreiben dasselbe Feld, und das Feld reist über den
Sync — sie liefen zwischen 00:00 und 02:00 CEST also auf verschiedene Tage. Derselbe
Zeitzonen-Bruch, den [panary-cloud ADR 0047](https://github.com/panary/panary-cloud/blob/main/docs/adr/0047-order-gate-stundenschwelle.md)
für die **Sperre** beseitigt hat, nur an der **Rotation** statt am Gate.

**Zweitens: die falsche Größe.** Ein Kalendertagswechsel ist kein Grund, einen laufenden
Betrieb zu zerschneiden. Ein Nachtbetrieb 18:00 → 04:00 wurde in CEST um 02:00 Ortszeit auf zwei
Geschäftstage aufgeteilt — sporadisch, weil es nur passiert, wenn in genau dem Moment keine
Bestellung offen ist (sonst greift der `hasActiveOrders`-Block). Genau die Sorte Fehler, die im
Feld schwer zu reproduzieren ist.

Beim Umsetzen fiel auf, dass die naheliegende Reihenfolge — „erst die Zeitzone, den Rest später" —
den zweiten Fehler **verschlimmert** hätte. In CEST liegt die lokale Mitternacht **vor** dem
UTC-Tageswechsel:

| Ortszeit (CEST) | UTC-`today` | Filial-`today` | rotiert vorher | nur Zeitzone |
| --- | --- | --- | --- | --- |
| 29.07. 23:59 | 2026-07-29 | 2026-07-29 | nein | nein |
| 30.07. 00:00 | 2026-07-29 | **2026-07-30** | nein | **ja** |
| 30.07. 01:59 | 2026-07-29 | 2026-07-30 | nein | ja |
| 30.07. 02:00 | **2026-07-30** | 2026-07-30 | **ja** | ja |

Das Fenster, in dem eine Bestell-Flaute die Nacht aufschneidet, wäre von zwei auf vier Stunden
gewachsen. Die im Issue als „offene Frage" geführte Mindest-Laufzeit ist damit keine Kür,
sondern Voraussetzung dafür, dass die Zeitzonen-Korrektur überhaupt eine Verbesserung ist.

## Entscheidung

### 1. „Heute" ist der Kalendertag der Filiale

`apps/api-edge/src/utils/business-day-date.ts` liefert `businessDateForTimezone(now, tz)` und
`businessDateForLocation(location, now?)`. Die Zone kommt aus
`settings.generalSettings.timezone`, Fallback `Europe/Berlin` — auch bei ungültiger Angabe, die
sonst als `RangeError` die Rotation anhielte. Alle drei Einstiegspunkte ziehen darauf; es gibt
genau **einen** Begriff von „heute" im Rotationspfad.

Semantisch identisch zum Cloud-Helfer, technisch nicht: Hier steht
`Intl.DateTimeFormat.formatToParts` statt des `new Date(now.toLocaleString('en-US', …))`-Roundtrips.
Der Roundtrip hängt an der Zeitzone des **Servers** und daran, dass `new Date(string)` ein
en-US-Format parst. `workers/scheduled-slot.ts` hat dieselbe Entscheidung bereits getroffen — der
Edge kannte also nicht erst seit hier eine Zeitzone, sie fehlte nur im Rotationspfad. Deshalb ist
das hier **kein** ADR über „der Edge lernt Zeitzonen", sondern über die Rotationsregel.

### 2. Die Rotation bleibt kalendertagsbasiert — mit Mindest-Laufzeit

`shouldAutoRotate` verlangt jetzt **beides**:

1. Der Kalendertag der Filiale hat gewechselt.
2. Der Geschäftstag läuft mindestens `MIN_OPEN_HOURS_BEFORE_ROTATION` = **10 Stunden**.

Die Rotation wird ausdrücklich **nicht** auf eine reine Stundenschwelle umgestellt — „ein neuer
Tag bekommt einen neuen Geschäftstag" ist ein Kalenderbegriff, und ADR 0047 hat das für die
Rotation so stehen lassen. Die 10 Stunden sind kein zweiter Tagesbegriff, sondern eine
Karenz gegen den Schnitt mitten im Betrieb.

**Warum 10:** Es ist exakt die Länge des Bezugsfalls 18:00 → 04:00. Kürzer schneidet ihn, länger
schiebt den regulären Tageswechsel unnötig in den Vormittag. Der Wert liegt weit unter der
Sperrschwelle von 26 Stunden (ADR 0047) — Guard und Order-Gate können sich also nie gegenseitig
blockieren: Der Tag rotiert lange bevor das Gate Bestellungen ablehnen würde.

Nebeneffekt, der die offene Frage des Issues miterledigt: Ein um 23:55 eröffneter Tag rotiert
nicht mehr fünf Minuten später.

### 3. Fail-open ohne `openedAt`

Fehlt ein brauchbarer Zeitstempel (`openHours === null`), entscheidet wieder allein der
Kalendertag. Die Richtung ist Absicht und spiegelt die Altersgrenze, die denselben Datenfehler
überspringt (`business_day.age_check_skipped`): Würde der Guard hier blockieren, bliebe der Tag
für immer offen, sammelte weiter Umsatz an — und weil das Gate denselben fehlenden Zeitstempel
ignoriert, hielte ihn auch dort niemand auf.

### 4. Ein Read für beide Regeln

`loadBusinessDayRuntime` ersetzt das hook-lokale `loadOpenHours` und liefert Guard und
Altersgrenze dieselbe Zahl. Zwei getrennte Reads in derselben Anfrage könnten verschiedene Werte
liefern, und zwischen den beiden Regeln liegen nur 16 Stunden. Der Boot-Pfad fängt einen
verwaisten Zeiger ab (`business_day.runtime_unreadable`), damit eine kaputte Filiale nicht den
Lauf über alle übrigen abbricht.

## Konsequenzen

- **Edge und Cloud stempeln denselben Kalendertag.** Vorher bekam ein zwischen 00:00 und 02:00
  CEST lokal rotierter Tag das Vortagesdatum, während die Cloud den neuen Tag gestempelt hätte.
  Im CONNECTED-Betrieb rotiert der Edge ohnehin nicht (die Cloud führt den Lifecycle, der Edge
  pullt); die Divergenz betraf Standalone und den Offline-Override — und genau dort kommt sie
  beim nächsten Pull wieder mit der Cloud zusammen.
- **Der Nachtbetrieb bleibt ein Geschäftstag.** Ein 18:00 → 04:00-Betrieb rotiert erst zum
  Betriebsende, nicht mehr sporadisch mittendrin.
- **Der UTC-Anker-Caveat des Nightly-Workers entfällt.** `hour: 4` ist keine Absicherung gegen
  UTC-Mitternacht mehr, sondern schlicht die Stunde nach Betriebsende. Was bleibt: Der Worker
  feuert zur Stunde der **Server**-Zeitzone, entschieden wird in der der Filiale. Bei
  abweichenden Zonen kann der Lauf leer ausgehen — dann rotiert die Lazy-Rotation im Order-Hook
  nach. Regelfall ist die Box in der Filiale, also beide Zonen gleich.
- **Bewusst in Kauf genommen:** Ein spät eröffneter Tag (z. B. 22:00) rotiert erst am nächsten
  Vormittag (08:00) statt um Mitternacht. Beginnt dort früher Service, landen die ersten
  Bestellungen noch auf dem Vortag. Der Fall braucht eine manuelle Abend-Eröffnung mit
  anschließendem Früh-Service, ist selbstheilend und bleibt weit von der 26-h-Sperre entfernt.
  Tritt er auf, wäre die Erweiterung „**oder** lokale Uhrzeit ≥ Rotationsstunde" der Ausweg.
- **Rollout-Risiko:** panary-core hat keinen Staging-Kanal — ein `v*`-Tag erreicht alle
  Kunden-Edges binnen ~1 h. Diese Änderung verschiebt, **wann** ein Geschäftstag wechselt, und
  ein falsch geschnittener Tag ist nach dem Abschluss nicht mehr korrigierbar (kein `reopen`).
  Vor dem Tag lokal verifizieren.
- Der Cloud-Helfer `businessDateForTimezone` bleibt vorerst eine eigene Implementierung. Eine
  Zusammenführung in `@panary/locations/domain` (wo `formatDateISO` und der Zonen-Default schon
  liegen) wäre der nächste Schritt, kostet aber einen Lib-Publish plus Cloud-Pin-Bump und war
  hier bewusst nicht im Schnitt.

Details und Verifikationsschritte: [Geschäftstag — Automatische Rotation](../domains/geschaeftstag-auto-rotation.md).
