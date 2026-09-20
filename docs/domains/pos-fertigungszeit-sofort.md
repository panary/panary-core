---
type: Domain Concept
title: Fertigungszeit am POS — „Sofort", die Abschlusskette und die Kodierung der Null
description: Wie der Bestelldialog die Fertigungszeit erfragt, warum Innen sie überspringt und Außen eine Sofort-Kachel im Funktionsblock bekommt, und was estimatedDuration = 0 bedeutet.
tags: [orders, pos-client, locations]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-20T00:00:00.000Z }
---

Die Fertigungszeit ist die Minutenzahl, die der Kassierer am Ende einer Bestellung
wählt. Aus ihr entsteht die Abholzeit auf dem Bon
([Print-Server-API §11](../integrations/print-server-api.md)). Seit
[core#343](https://github.com/panary/panary-core/issues/343) ist sie für `Innen`
nicht mehr zu erfragen und für `Außen` als `Sofort` wählbar.

## Die Abschlusskette

Alles in `libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.ts`:

```
Bestellen  → setTaxRateSubbuttons()      Bestellart-Overlay (Innen / Außen / Vorbestellen)
           → selectDineLocation()        setzt _dineLocation
           → [setPagerSubbuttons()]      nur wenn locationService.showPagers
           → [setTableSubbuttons()]      nur wenn locationService.showTables
           → setProductionTimeSubbuttons()
           → placeOrder()
```

🚨 **In `setProductionTimeSubbuttons` münden fünf Aufrufstellen**, nicht eine:
`selectDineLocation` (wenn keine Pager konfiguriert sind), beide Ausgänge der
Tischwahl (`KEIN TISCH` und eine gewählte Tischnummer) und beide der Pagerwahl.
Wer den Ablauf für eine Bestellart verzweigen will, tut das deshalb **am Kopf
dieser Methode** — eine Abzweigung weiter vorn (etwa in `selectDineLocation`)
kappt die Pager- und Tischabfrage mit.

⚠️ Der **Vorbestell**-Dialog (`pre-order-quick-dialog.component.ts`) ist ein
eigener 3-Schritt-Stepper und kennt weder `_productionTime` noch diese Kette. Er
befüllt `PreOrder.scheduledFor`.

## Innen: keine Abfrage

`Innen` setzt `_productionTime = 0` und schließt direkt ab. Was am Tisch bleibt,
geht sofort raus; die Minutenfrage war dort durchweg überflüssig.

Eine **fehlende** Bestartauswahl zählt mit: `placeOrder` bucht sie ohnehin als
`DINE_IN`. Ohne diesen Zweig zeigte der Dialog ein Minutenraster für eine
Bestellung, die als Innen in der Datenbank landet.

🚫 **Innen kann damit keine Fertigungszeit mehr tragen.** Das ist eine bewusste
Rücknahme. Sollte sich zeigen, dass Filialen sie für Tischbestellungen brauchen,
ist der Rückweg nicht „Abzweigung entfernen", sondern `Sofort` auch im
Innen-Pfad anzubieten — sonst kehrt der überflüssige Pflichtklick zurück.

## Außen: Sofort steht im Funktionsblock

Der Dialog hat **zwei** Kachelbereiche: `_functionButtons` (schmaler Streifen über
dem Raster, farbcodiert nach Wirkung) und `_productButtons` (das scrollbare
Raster). `Sofort` liegt im **Funktionsblock**, mit `variant: 'confirm'` und Icon
`bolt`.

🚨 **Der Ort ist die eigentliche Entscheidung, nicht die Optik.** Das Raster ist
Touch-Bedienung unter Zeitdruck. Eine vorangestellte Kachel *im* Raster würde
jeden Minutenwert um eine Position verschieben — der eingeübte Griff nach
„15 min" landete auf „10 min", und zwar still. Im Funktionsblock sitzt `Sofort`
gut erreichbar oben links, während die Minutenkacheln exakt dort bleiben, wo sie
vorher waren. Eine Spec hält das fest und fällt, wenn die Kachel ins Raster
wandert.

Dasselbe Muster tragen `KEIN PAGER` und `KEIN TISCH` (dort `variant: 'skip'`).

## Die Kodierung: `estimatedDuration = 0` heißt „sofort"

Abgestimmt 2026-09-20: **kein neues Feld**. Die Null ist der Träger.

| Feld | Bedeutung |
|---|---|
| `estimatedDuration` | Fertigungszeit in **Minuten**, `0` = sofort. Quelle der Abholzeit. |
| `targetCompletionAt` | 🚫 **totes Feld** — steht in Schema und Migration, wird nirgends im Produktivcode geschrieben oder gelesen. Wer die Abholzeit dort sucht, plant am Code vorbei. |
| `remainingTime` | aus `recordingDate + estimatedDuration` berechnet, in **keiner Ansicht** verdrahtet. |

`_productionTimes` bleibt eine **reine Minutenliste** (`order.service.ts`,
`[5, 10, … 60]`). Die Null entsteht im Dialog, nicht in der Quelle — so kann sie
nirgends versehentlich als Dauer durchgerechnet werden.

Die Bon-Seite liest dieselbe Kodierung: `estimatedDuration <= 0` druckt `SOFORT`,
sonst `Abholung <hh:mm>`
([core#342](https://github.com/panary/panary-core/issues/342)).

## Was diese Kodierung nicht leisten kann

- **Auf Bestandsdaten ist `0` mehrdeutig.** „Sofort" und „nie gefragt" sind
  nachträglich nicht mehr zu trennen. Auf alten Bestellungen kann `SOFORT` auf dem
  Bon erscheinen, wo nie eine Zeit gewählt wurde.
- **`isOverdue` (`active-orders.component.ts`) und `remainingTime` behandeln `0`
  als „sofort fällig".** Beide sind derzeit in keiner Ansicht verdrahtet — es gibt
  keinen Template-Treffer. Heute folgenlos; sobald eine Restzeit- oder KDS-Ansicht
  daran hängt, erscheint **jede** Innen-Bestellung sofort als überfällig. Kein Test
  fängt das, weil nichts davon gerendert wird.
- **Konvertierte Vorbestellungen tragen bereits `estimatedDuration: 0`**
  (`apps/api-edge/src/services/pre-orders/pre-orders.ts`) und drucken deshalb
  `SOFORT`, obwohl eine Abholzeit vereinbart war. Das ist der Gegenstand von
  [core#344](https://github.com/panary/panary-core/issues/344), nicht dieser Seite.

## Wirkung

Die Änderung liegt im POS-Client und wirkt **nur über einen POS-Build** — ein
Edge-Release ändert am Dialog nichts. Die Bon-Seite umgekehrt nur über ein
Edge-Release.
