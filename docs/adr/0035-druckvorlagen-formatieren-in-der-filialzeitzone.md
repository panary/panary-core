---
type: ADR
title: Druckvorlagen formatieren Datum und Uhrzeit in der Filialzeitzone
description: Warum Bon, Beleg, Storno-Zeile und Testdruck ihre Zeitangaben über settings.generalSettings.timezone formatieren statt über die Prozess-Zeitzone — und warum TZ im Edge-Container bewusst nicht gesetzt wird.
tags: [orders, receipts, print, edge, infra]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-12T15:40:00Z }
---

# Druckvorlagen formatieren Datum und Uhrzeit in der Filialzeitzone

## Problem

Ein Kunde meldete am 2026-09-12, dass auf dem gedruckten Kassenbon die Uhrzeit **zwei Stunden
zu früh** steht. Zwei Stunden ist genau der Abstand UTC → Europe/Berlin in der Sommerzeit: der
Bon druckte UTC.

Ursache waren vier Stellen im Edge-Druckpfad, die mit `toLocale*('de-DE')` **ohne `timeZone`**
formatierten — `order-receipt.renderer.ts` (Datum, Uhrzeit, Storno-Zeile),
`receipt-escpos.renderer.ts` (Beleg-Kopf, #228) und `print-job.builder.ts` (Testdruck). Ohne
`timeZone` formatiert `Intl` in der Zeitzone des **Node-Prozesses**. Der Edge läuft im
Container (`node:22-bookworm-slim`, `tools/docker/Dockerfile.edge`), und weder das Image noch
`tools/hosting/get.panary.cloud/install.sh` setzen `TZ` — der Prozess steht auf UTC.

Lokal in der Entwicklung (macOS, `TZ` = Europe/Berlin) stimmt die Ausgabe zufällig. Genau
deshalb hat der Fehler jeden Sichttest überlebt: geprüft wurde auf einem Host, dessen Uhr die
Filialzeit ohnehin zeigte.

Der Edge kannte die Zeitzone der Filiale zu diesem Zeitpunkt bereits und nutzte sie an drei
Stellen korrekt — Geschäftstag (`utils/business-day-date.ts`), Vorbestell-Slots
(`workers/scheduled-slot.ts`) und Vorbestellungen (`services/pre-orders/pre-orders.ts`). Der
Druckpfad war die Lücke.

## Entscheidung

**Server-seitige Druckvorlagen formatieren Zeitangaben nie ohne explizite Zeitzone.** Die
Zeitzone kommt aus `settings.generalSettings.timezone` der Filiale, mit
`DEFAULT_BUSINESS_TIMEZONE` aus `utils/business-day-date.ts` als Fallback — **dieselbe Quelle
und dieselbe Konstante wie der Geschäftstag**, keine zweite.

Umgesetzt als `apps/api-edge/src/print-server/print-date-format.ts` mit
`formatPrintDate` / `formatPrintTime` / `formatPrintDateTime` über `Intl.DateTimeFormat` und
`printTimeZoneForLocation(location)`. Die Ausgabeformate sind unverändert (`15.7.2026`,
`14:03`, `15.7.2026, 14:03:05`); geändert hat sich nur, wessen Uhr gilt.

Woher die Zone kommt, ist je Vorlage verschieden — nicht jeder Renderer hat eine Location:

| Vorlage | Quelle der Zone |
| --- | --- |
| Kassenbon, Storno-Zeile | `location`-Parameter von `renderOrderReceipt` (war schon da, wurde nur für Preise gelesen) |
| Beleg (`renderReceiptEscPos`) | `EscposOptions.timeZone` — der Renderer bekommt keine Location, der Aufrufer reicht die Zone durch |
| Testdruck | `PrintServerManager`, der die Zone beim Start aus der Filiale übernimmt (`testPrint` wird auch vom Cloud-Befehls-Worker aufgerufen, der keine Location zur Hand hat) |

Eine unbrauchbare Zone (Tippfehler in den Settings, `RangeError` aus `Intl`) fällt auf den
Default zurück und wird **einmal** je Zone geloggt (`event: print.invalid_timezone`). Ein Bon
darf an einem Settings-Feld nicht scheitern — der Kunde stünde ohne Beleg da, und niemand
brächte die Ursache mit dem Drucker in Verbindung.

### Verworfen: `TZ=Europe/Berlin` im Container

Der naheliegende Einzeiler kuriert den Bon und richtet drei Schäden an:

1. Er verschiebt **jede** andere zeitzonenfreie Formatierung unbemerkt mit — auch künftige,
   die noch niemand geschrieben hat.
2. Die Geschäftstag-Logik ist bewusst prozess-TZ-**unabhängig** gebaut (Begründung im Kopf von
   `business-day-date.ts`, panary-cloud ADR 0047). Ein globales `TZ` macht die Unabhängigkeit
   zur Illusion, ohne sie aufzuheben — der nächste Leser hält den Prozess für die Quelle.
3. Eine Filiale in einer anderen Zone wäre wieder falsch, und der Fehler sähe genauso aus:
   richtig beim Testen, falsch beim Kunden.

Die Zeitzone gehört an die Filiale, nicht an den Host.

## Konsequenzen

- Wer eine neue Druckvorlage oder einen serverseitigen Export mit Datum/Uhrzeit baut, nimmt
  `print-date-format.ts` — `toLocale*` ohne `timeZone` ist im Edge ein Fehler, auch wenn es
  lokal richtig aussieht. Die Gegenprobe kostet einen Lauf: `TZ=UTC pnpm nx test api-edge`.
- Specs zu Zeitformaten arbeiten mit festen Instants **und** einer Zone, deren Offset ≠ 0 ist.
  Sonst wäre ein stiller Fallback auf UTC (Node ohne volle ICU-Daten) grün — die Spec prüfte
  dann nichts.
- Der Testdruck trägt die Zone nur, wenn der Print-Server nach dem Deploy einmal gestartet
  wurde; `stop()` verwirft sie. Ohne Zone greift der Default — der Testdruck belegt die
  Hardware, nicht die Uhrzeit.
- Bereits gedruckte Bons bleiben falsch. In der Datenbank stand die Zeit immer korrekt als
  ISO-8601/UTC (`recordingDate`, `canceledAt`, `issuedAt`); Auswertungen, Belegnummern und
  Geschäftstag waren **nicht** betroffen. Es war reine Darstellung.
- Die drei `en-US`-Roundtrips in `pre-orders.ts` und `scheduled-slot.ts` bleiben unberührt —
  sie tragen eine `timeZone` und sind damit nicht Teil des Befunds.

Siehe [#274](https://github.com/panary/panary-core/issues/274).
