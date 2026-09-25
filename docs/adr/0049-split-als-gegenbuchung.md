---
type: ADR
title: 'Der Split bucht um, statt zu ändern — und warum die Ableitung in die Preis-Engine muss'
description: 'ADR zur Umsetzung des Bon-Splits als append-only Gegenbuchung (order.splitOff) mit abgeleiteten Positionen, zur eigenen Custom Method statt eines aufgeweichten Patches, und zur bewusst abgelehnten Teilung von Zeilen mit Modifiern.'
tags: [orders, fiskalisierung, dsfinv-k, pricing, sync]
status: stable
decision: accepted
implementation: 'Umgesetzt 2026-09-24 (#349, Edge). POS-Oberfläche folgt mit #350, Bestandsbuchung mit panary/panary-cloud#488.'
generated: { by: claude-code/opus-5, at: 2026-09-24T14:45:00Z }
---

# Der Split bucht um, statt zu ändern

## Problem

Für den POS ist „getrennt zahlen" beauftragt: einzelne Positionen einer
Bestellung in separate Bestellungen überführen. Das Rechtsgutachten zu
[#345](https://github.com/panary/panary-core/issues/345) stellt den Vorgang auf
eine klare Basis — vor Abschluss zulässig, **kein Storno nötig**, weil der Umsatz
erst mit dem jeweiligen Kassenbeleg entsteht (DSFinV-K Tz. 2.7.1: Bestellungen
können auf mehrere Rechnungen verteilt sein). Vier seiner Anforderungen bestimmen
aber die Umsetzung, und zwei davon widersprechen einander auf den ersten Blick:

- **A5** — Der Split erzeugt neue Positionszeilen im Zielvorgang; **die Quellzeile
  bleibt bestehen**. Kein `UPDATE` auf Menge, Preis, Steuersatz oder Zuordnung.
- **A13** — Über denselben Umsatz stehen keine zwei nicht-stornierten Belege
  (§ 14c UStG). Die Quelle darf nach dem Split **nicht mehr den vollen Betrag
  tragen**.
- **A12** — Rabatte werden positions- und steuersatzgenau aufgeteilt. Seit dem
  01.01.2026 ist praktisch jeder Gastro-Tisch gemischt (Speisen 7 %, Getränke
  19 %, § 12 Abs. 2 Nr. 15 UStG), und DSFinV-K Tz. 4.2.4 schließt die
  erleichterte Trennung der Entgelte für Kassensysteme ausdrücklich aus.
- **A14** — Rundungsdifferenzen zwischen der Summe der Teilbelege und dem
  Ursprungsbetrag bleiben stehen.

Der Code stand dem strukturell entgegen. `lineItems` ist im `orderPatchResolver`
**still** gesperrt (`lineItems: async () => undefined`), auf derselben Liste wie
`_id`, `tenantId` und `createdAt` — eine bewusste Unveränderlichkeits-Garantie,
die sich mit A5 deckt und nicht aufgeweicht werden darf.

## Entscheidung

### 1. Gegenbuchung statt Änderung — das ist die Auflösung von A5 gegen A13

`order.lineItems` bleibt **vollständig unangetastet**: nicht geändert, nicht
ergänzt. Es ist die Ist-Aufnahme dessen, was bestellt wurde. Was gegangen ist,
steht append-only in einem neuen Feld `order.splitOff[]` (Zielvorgang, Zeilen-ID,
Menge, Brutto-Anteil, Zeitpunkt).

Was der Vorgang **noch trägt**, ist damit eine Ableitung, keine gespeicherte
Zahl: `effectiveLineItems(order)` = `lineItems` minus `splitOff`.

🚨 **Und genau deshalb muss die Ableitung in die Preis-Engine.** `computeOrderTax`
liest `effectiveLineItems(order)` statt `order.lineItems`. Ohne diese eine Zeile
wiese die Quelle nach dem Split weiter die **volle** Steuer aus — ohne Fehler,
ohne Log, auf einem steuerrelevanten Dokument. Dieselbe Ableitung brauchen drei
weitere Stellen, und jede von ihnen wäre sonst still falsch:

| Stelle | Was ohne die Ableitung passiert |
|---|---|
| `calculate-tax-details.ts` (`onPatch`) | Der nächste Rabatt-Patch auf der Quelle schreibt die volle Steuer zurück. `splitOff` musste dafür in die Liste der preisrelevanten Felder — der Hook mergt sonst den Stand **vor** dem Split. |
| `issue-receipt.hook.ts` | Der Beleg der Quelle listet die abgegebenen Mengen mit. Das sind zwei nicht-stornierte Belege über denselben Umsatz — genau A13. |
| `order-receipt.renderer.ts` | Der Bon druckt 5 Stück, die Summe darunter rechnet 2. Positionen und Summe widersprechen sich auf demselben Papier. |

⚠️ **Die verbleibende Lücke aus [ADR 0047](0047-abrechnungskreis-als-pflichtfeld.md)
ist damit NICHT geschlossen.** `renderOrderReceipt` rechnet `computeOrderTax`
weiterhin **live zum Druckzeitpunkt** statt aus `taxSnapshot`. Nach diesem
Umbau stimmen beide überein, weil es dieselbe Funktion auf denselben Eingaben
ist — bei einem Steuersatzwechsel druckt der Bon aber weiterhin rückwirkend
andere Zahlen als der Snapshot trägt (GoBD Rz. 111). Der Grund, es hier **nicht**
mitzuerledigen: `computeOrderTax` füllt `computedAmountCents` je `appliedDiscount`
als **Seiteneffekt**, und der Renderer hängt daran (`calcTotalWithDiscount` muss
vor den Nachlasszeilen laufen, sonst druckt er 0 ct und unterdrückt die Zeile
ganz). Wer die Quelle umstellt, ohne diesen Seiteneffekt zu ersetzen, bricht die
Nachlasszeile — still. Das gehört in einen eigenen Schritt mit eigenem Sichttest.

### 2. Eine eigene Custom Method, kein aufgeweichter Patch

`orders.split` ist eine Feathers-Custom-Method. Die Alternative — `lineItems` per
Patch freigeben — schied aus: Die Sperre ist die technische Fassung von A5, und
`calculate-tax-details.ts` hält ausdrücklich fest, dass `lineItems` deshalb
**kein** Trigger für die `taxSnapshot`-Neuberechnung ist. Wer die Sperre öffnet,
ändert Positionen ohne neue Steuer.

🚨 **Eine Custom Method ist standardmäßig ungeschützt** (ADR 0046,
[feedback-custom-methods](https://github.com/panary/panary-core/issues/357)):
`multiTenancy()` schaltet nur auf CRUD-Methodennamen und ist hier ein No-Op, der
innere `get` läuft mit `{ provider: undefined }` und ist ungescoped, und
`ensureTenantIsolation` prüft erst das Ergebnis — also nach dem Write, den
Feathers nicht zurückrollt. Deshalb `assertCallerOwnsRecord` **unmittelbar nach
dem `get`** und **vor jeder Zustandsmeldung**: Sonst verrät die Ablehnung
„bereits abgeschlossen" den Zustand fremder Datensätze.

`split` ist in `METHOD_TO_ACTION` auf **`CREATE`** gemappt, nicht auf `UPDATE`,
obwohl beide Seiten geschrieben werden. Der fachliche Kern ist die neue
Teilbestellung — und nur die CREATE-Menge enthält `TENANT_STAFF`, die Rolle, die
am Tisch splittet. Mit `UPDATE` bekäme ausgerechnet der Kellner 403
(`orders: CREATE+READ`). Der Preis der Wahl steht im Code: `DEVICE_KIOSK` trägt
`orders: CREATE` und darf damit ebenfalls splitten.

### 3. `splitOff` ist im Patch-Resolver genauso gesperrt wie `lineItems`

Das Feld senkt über die Ableitung das ausgewiesene Brutto **und** die Steuer. Ein
Client, der es selbst patchen könnte, rabattierte seine eigene Bestellung an der
Rabattlogik vorbei. Der Resolver gibt es nur frei, wenn **beide** Bedingungen
gelten: `params.provider === undefined` **und** `params.orderSplit === true`.

Die zweite Bedingung ist nicht redundant. ADR 0048 Nr. 4 hat am lebenden Objekt
gemessen, dass die Feathers-Methodenliste **nur den externen Weg** absichert —
intern läuft alles hindurch. Ohne die Markierung schriebe also jeder Hook, Worker
oder Seed die Gegenbuchung mit. `params` baut der Server; Feathers übergibt einem
externen Aufrufer Query und Route, nie `params` selbst.

### 4. Teilmengen nur für Zeilen ohne Modifier und Komponenten

Eine Zeile lässt sich mengenweise teilen („3 von 5"), **außer** sie trägt
Modifier, Bundle-Komponenten oder die Legacy-Menü-Slots. Dann geht sie nur ganz.

Der Grund ist gemessen und nicht Vorsicht: Ein Modifier zählt mit **seinem
eigenen** `amount` und skaliert **nicht** mit der Menge der Hauptzeile
(`modifiersGrossCents` wird ohne `scale`-Argument gerufen). „2 × Brötchen à 4,00 €
+ 1 × Extra Käse à 0,50 €" sind 8,50 €, nicht 9,00 €. Gäbe man „3 von 5" ab,
trüge die Quelle den Aufpreis weiter voll **und** das Ziel bekäme ihn noch
einmal — der Split erfände Umsatz. Bundle-Komponenten haben die spiegelbildliche
Falle (`FIXED_PROPORTIONAL` verteilt einen Festpreis).

🚫 **Keine erfundene Aufteilungsregel.** Es gibt keine Norm, die sagt, wie ein
Aufpreis auf Teilmengen fällt; eine Hausregel wäre eine Behauptung an einer
prüfungsrelevanten Stelle. Die Ablehnung trägt einen eigenen Fehlercode
(`order-split/partial-split-unsupported`) und ist damit am Client unterscheidbar.

### 5. Rabatte: Prozent teilt sich selbst, Festbeträge über largest-remainder

- **Prozent** (Order wie Position) wird auf beide Seiten kopiert und wirkt dort
  auf der jeweiligen Basis. Es gibt nichts zu verteilen.
- **Festbeträge** werden mit `distributeByLargestRemainder` über die Brutto-Anteile
  beider Seiten geteilt — summen-exakt, ohne erfundene oder verlorene Cents.
- Ein **Positionsrabatt auf einer ganz gewanderten Zeile** wandert mit und
  verschwindet aus der Quelle. Er bliebe sonst als Rabatt ohne Position stehen.

Die Klemm- und Rundungsregel kommt aus der Engine selbst: `discountAmountCents`
ist dafür exportiert worden. Eine zweite Formel daneben wäre genau die Abweichung,
die später als „Bon stimmt nicht mit der API überein" auftaucht.

🚨 **Ein vorhandener `taxSnapshot` bleibt autoritativ, auch mit leerer
`taxes`-Liste.** Bei 100 % Nachlass (Personalessen) verwirft `computeOrderTax`
alle Eimer ≤ 0, die Liste ist leer, und wer daraus „kein Snapshot" schließt,
weist die **volle** Steuer aus. Der Fall ist per Test festgehalten — auf beiden
Seiten des Splits.

### 6. Was A12 hier heißt und was nicht

A12 verlangt, dass Gesamtrabatte **im Moment der Rabattierung** aufgeteilt und
persistiert werden und beim Split **nicht neu gerechnet** werden. Die Umsetzung
hält das in der Sache ein, nicht im Buchstaben: Die Aufteilung entsteht beim
Split, aber ausschließlich aus dem **persistierten Snapshot** heraus —
`computeOrderTax` ist eine reine Funktion über `lineItems` und
`appliedDiscounts`, ohne Katalog-Lookup und ohne Neubepreisung. Dieselben
Eingaben ergeben dieselbe Zahl.

⚠️ **Ehrlich dazu: Das ist nicht dasselbe.** Ändert sich die Engine zwischen
Rabattierung und Split, ändert sich die Aufteilung. Eine Aufteilung, die schon
beim Rabattieren je Position und Steuersatz persistiert wird, wäre die härtere
Erfüllung — sie bräuchte ein Allokations-Feld an `appliedDiscount` und eine
Migration des Bestands. Das steht hier als bewusst offener Punkt, damit später
niemand aus dem grünen Test schließt, A12 sei im Buchstaben erfüllt.

### 7. Ein Ziel je Aufruf

`orders.split` erzeugt genau **eine** Zielbestellung. Drei Belege entstehen durch
zwei Aufrufe; `splitOff` ist append-only und `effectiveLineItems` summiert. Der
Grund ist A14: Bei mehreren Zielen in einem Aufruf wäre der Rundungsrest keinem
Vorgang mehr zuzuordnen. Er wird an der Quelle **aufsummiert**, nicht
überschrieben.

Ein Split, der die Quelle **leer** zurückließe, wird abgelehnt
(`order-split/nothing-remains`). Das wäre eine Umbuchung, kein Split — und ein
Vorgang mit 0 € Bon, der im Kassenbetrieb eine TSE-Transaktion eröffnet hätte.

## Konsequenzen

**Die Release-Reihenfolge ist wieder nicht optional.** `orders.splitOff` und
`splitRoundingRemainderCents` sind neue Felder am Order-Record. Der Outbox-Push
schickt den **ganzen** Record, und die Cloud validiert ihn gegen `orderDataSchema`
aus dem **gepinnten** `@panary/orders/domain` mit `additionalProperties: false`.
Ein Edge, der sie sendet, bevor der Cloud-Pin gebumpt und `api-cloud` deployt
ist, bekommt `BadRequest` → **TERMINAL**: Outbox `rejected`, kein Retry, kein
`sync-conflicts`-Eintrag, kein Alarm. Zwingend:
**Core-Release → `@panary/*`-Pin in panary-cloud bumpen → `api-cloud` deployen →
erst dann Edges.** Betroffen ist zusätzlich `@panary/shared-backend` (der
`split`-Eintrag in `METHOD_TO_ACTION`).

**Die Cloud bucht noch nicht richtig.** Die Bestandsbuchung läuft ausschließlich
in `panary-cloud` (`order-stock-update.hook.ts`), und ihre Idempotenz über
`stockBookedAt` schützt **je Order**, nicht über eine Split-Gruppe hinweg. Bis
[panary/panary-cloud#488](https://github.com/panary/panary-cloud/issues/488) steht,
ist eine Doppelbuchung des Bestands möglich — und sie ist still: Der Bestand
sinkt zu stark, kein Fehler, kein Log.

**Bestandsdaten mit Zeilen ohne eigene `_id` sind nicht splittbar.** ADR 0033 hat
`lineItem._id` eingeführt, der Bestand wurde **nicht** migriert. Für solche
Zeilen ist „welche Zeile wandert" mehrdeutig; `planOrderSplit` findet sie nicht
und lehnt mit `order-split/unknown-line` ab. Das ist die richtige Antwort, aber
es heißt: Alt-Bestellungen lassen sich nicht splitten.

**Die Belegnummer bleibt das, was sie war.** Jede Zielbestellung bekommt ihre
eigene `dailySequenceNumber` über `assignDailySequenceNumber()` — und die ist
laut ADR 0047 Entscheidung 7 **keine** lückenerkennbare Belegnummer im Sinne von
§ 2 Satz 4 KassenSichV. Der Split erbt diesen offenen Punkt, er verschärft ihn
nicht. Umbau: [#351](https://github.com/panary/panary-core/issues/351).

**Offen für den Steuerberater** (aus Gutachten § 9.2): die verbindliche
Rabatt-Aufteilungsmethode; ob die Summe der Teilbelege dem Ursprungsbetrag exakt
entsprechen **muss** (keine Norm regelt das, Confidence mittel); ob eine
Zwischenrechnung Belegcharakter hat.

## Nachtrag (2026-09-25, [#391](https://github.com/panary/panary-core/issues/391)): der Aggregator ist die fünfte Stelle

Die Tabelle unter Entscheidung 1 nennt vier Leser der Ableitung. Es gibt eine fünfte
Familie, die nur in der Cloud läuft und deshalb in keinem Edge-Test auftaucht:
`@panary/businessdays/aggregator`. Drei Funktionen iterierten `order.lineItems`:

| Stelle | Wofür | Was nach einem Split passierte |
|---|---|---|
| `explodeOrderConsumption` | Bestandsbuchung der Cloud, Wareneinsatz (`computeCogs`) | gewanderte Menge bei Quelle **und** Ziel verbraucht |
| `computeStats` | Top-Produkte, Warengruppen | gewanderte Menge doppelt gezählt |
| `getOrderGrossCents` (Positions-Fallback) | Brutto ohne Payment und Snapshot | Quelle mit vollem Ursprungsbetrag |

Seither lesen alle drei `effectiveLineItems(order)`. Die Invariante „Quelle + Ziel =
Ursprung" steht als Spec mit echtem `planOrderSplit` (`split-consistency.spec.ts`).

⚠️ **Die Doppelbuchung des Bestands ist damit nicht vollständig geschlossen.** Ein Split
ist bis `COMPLETED` erlaubt, also auch in `PRODUCED` — und dort hat die Cloud die Quelle
bereits über die volle Menge gebucht. Die Gegenbuchung für diesen Fall ist Cloud-Sache
([panary/panary-cloud#488](https://github.com/panary/panary-cloud/issues/488)): Die Quelle
storniert genau den gewanderten Anteil (Nutzerentscheidung 2026-09-25 — Teil-Storno statt
kompletter Neubuchung). Die Menge dafür liefert `splitOffLineItems(order, entryIds?)` neben
`effectiveLineItems` in derselben Datei — das Gegenstück „was ist gewandert", damit die
Cloud keine zweite Ableitung aus `splitOff` baut. Je Zeile gilt
`effektiv + abgegeben = lineItems`, als Spec über zwei echte Splits hintereinander.
