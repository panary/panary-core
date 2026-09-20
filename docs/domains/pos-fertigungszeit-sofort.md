---
type: Domain Concept
title: Fertigungszeit am POS — „Sofort", die Abschlusskette und die Kodierung der Null
description: Wie der Bestelldialog die Fertigungszeit erfragt, warum Innen sie überspringt und Außen eine Sofort-Kachel im Funktionsblock bekommt, was estimatedDuration = 0 bedeutet und wie die Abholzeit einer Vorbestellung die Konvertierung überlebt.
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
- ✅ **Konvertierte Vorbestellungen sind versorgt** — siehe den eigenen Abschnitt
  unten. Bis [core#344](https://github.com/panary/panary-core/issues/344) trugen sie
  fest `estimatedDuration: 0` und druckten `SOFORT`, obwohl eine Abholzeit
  vereinbart war.

## Konvertierte Vorbestellungen: die Abholzeit wird zur Vorlaufzeit

Eine Vorbestellung traegt ihre vereinbarte Abholzeit in `scheduledFor`
(Pflichtfeld). Beim Konvertieren entsteht daraus eine Order, deren `recordingDate`
der **Konvertierungszeitpunkt** ist — konvertiert wird ausschliesslich manuell aus
der POS-Liste, die Vorlaufzeit kann also Minuten oder Stunden betragen.

Seit [core#344](https://github.com/panary/panary-core/issues/344) rechnet
`apps/api-edge/src/services/pre-orders/scheduled-lead-time.ts` daraus die
Vorlaufzeit:

```
estimatedDuration = Minuten(scheduledFor − recordingDate), geklemmt auf >= 0
```

Damit trifft `recordingDate + estimatedDuration` wieder `scheduledFor`, und der Bon
druckt die vereinbarte Zeit statt `SOFORT` — **ohne** dass die Leseseite eine
zweite Quelle braucht (das war die Entscheidung gegen das Wiederbeleben von
`targetCompletionAt`, Variante B des Issues).

🚨 **Gerechnet wird auf Minutenanfaengen, nicht auf der rohen Differenz.** Eine
Konvertierung um 17:45:40 fuer 18:00:00 ergibt roh 14,33 Minuten — gerundet 14, und
der Bon druckte `17:59`. Ueber die Minutenanfaenge sind es 15 und damit `18:00`.
Die Sekunden von `recordingDate` tragen sich mit und heben sich in der Darstellung
weg. Wer die Rechnung „vereinfacht", verschiebt jeden Bon um bis zu eine Minute.

| Fall | Ergebnis |
|---|---|
| Abholzeit in der Zukunft | Vorlaufzeit in Minuten |
| Abholzeit bereits verstrichen | `0` → Bon druckt `SOFORT` (faellig, nicht „in −20 Minuten") |
| `scheduledFor` fehlt oder unbrauchbar | `0` — ein Bon darf an einem Bestandsdatensatz nicht scheitern |

🚫 **Der Preis der Entscheidung:** `estimatedDuration` heisst „geschaetzte Dauer"
und traegt hier eine Vorlaufzeit. Eine um 10:00 konvertierte Bestellung fuer 18:00
steht mit 480 Minuten in der Datenbank. Das ist keine Produktionszeit, und jede
kuenftige Auswertung ueber Kuechenzeiten oder Durchsatz laese es falsch. Heute
liest es nichts als Dauer aus (gemessen in beiden Repos) — der Tag, an dem das
nicht mehr stimmt, ist der Tag, an dem Variante B faellig wird.

⚠️ **Der Cloud hat eine zweite, unabhaengige `convert()`-Implementierung**
(`apps/api-cloud/src/services/pre-orders/pre-orders.class.ts`, laut Kommentar dort
„identisch zum Edge") fuer Storefront-Vorbestellungen. Sie ist von #344 **nicht**
mitgefixt und verliert die Abholzeit weiterhin.

## Wirkung

Die Änderung liegt im POS-Client und wirkt **nur über einen POS-Build** — ein
Edge-Release ändert am Dialog nichts. Die Bon-Seite umgekehrt nur über ein
Edge-Release.
