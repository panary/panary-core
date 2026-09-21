---
type: ADR
title: 'Druckerrollen statt Stations-Routing — zwei Bon-Varianten aus einer Vorlage'
description: 'ADR zur Trennung von Küchenbon und Quittung über eine Druckerrolle (kitchen/receipt/both) mit `both` als Bestands-Default, statt einer Zuordnung Warengruppe→Drucker.'
tags: [locations, print-server, orders, tse, esc-pos]
status: stable
decision: accepted
implementation: 'umgesetzt 2026-09-21 (#347); Pflege der Rolle im Cloud-Admin offen (panary-cloud#487)'
generated: { by: claude-code/opus-5, at: 2026-09-21T13:00:00Z }
---

# Druckerrollen statt Stations-Routing

Der Bestellbon bediente zwei Zwecke mit einer Vorlage. Dieses ADR hält fest, wie
sie getrennt werden — und welche naheliegendere Trennung dafür verworfen wurde.

Vorgeschichte und Messungen zum Kopfbereich:
[Print-Server-API §11–13](../integrations/print-server-api.md).
Belegpflicht und Renderer-Landschaft: [ADR 0007](0007-beleg-bon-system.md).
Hoheit über die Druckerkonfiguration: [ADR 0001](0001-emergency-override.md).

## Problem

`order-receipt.renderer.ts` druckt Filialkopf, Bestellnummer, Bestellart-Badge,
Abholzeit, Positionen, Nachlässe, Gesamtsumme **und** — sobald `order.tse` gesetzt
ist — einen TSE-Block mit QR-Code. Dasselbe Ergebnis ging an jeden aktiven
IP-Drucker.

Damit war der Bon gleichzeitig Küchenzettel und Kundenbeleg, und beide Rollen
zogen in entgegengesetzte Richtungen:

- **Die Küche** braucht Positionen und Abholzeit. Filialadresse und ein halber
  Bon TSE-QR-Code sind dort Papierverbrauch ohne Adressat.
- **Der Kundenbeleg** braucht nach §146a AO Name und Anschrift des leistenden
  Unternehmers — und die TSE-Signatur.

Weil eine Vorlage nicht beides sein kann, wurde in
[#342](https://github.com/panary/panary-core/issues/342) der Filialkopf
**ersatzlos gestrichen** — bewusst als Zwischenlösung, mit der in ADR 0007
festgehaltenen Konsequenz, dass der Bestellbon seither kein vollständiger Beleg
mehr ist. Die technische Sperre („ein Buffer für alle") fiel mit
[#346](https://github.com/panary/panary-core/issues/346); was fehlte, war ein
Merkmal am Drucker, an dem sich eine zweite Vorlage entscheiden lässt.

Vorhanden, aber unbrauchbar: `printSettings.printers[].primaryTopics`
(String-Array). Das Feld war an drei Stellen deklariert — Schema, Edge-
`PrinterConfig`, Admin-Formulartyp —, hatte **kein** Eingabefeld und **keine**
einzige Leseposition. Der Name passt zu `lineItem.topic` (Warengruppe); gedacht
war offensichtlich eine Zuordnung Warengruppe→Drucker, gebaut wurde sie nie.

## Entscheidung

**1. Zwei Rollen, keine Stationen.** Jeder Drucker trägt
`role: 'kitchen' | 'receipt' | 'both'`. `primaryTopics` wird **entfernt**, nicht
verdrahtet.

**2. Der Küchenbon behält Preise und Summen.** Der Unterschied zwischen den
Varianten sind **ausschließlich Filialkopf und TSE-Block**. Positionen,
Nachlässe und Gesamtsumme sind byte-gleich.

**3. Eine Vorlage mit zwei Varianten, kein zweiter Renderer.**
`renderOrderReceipt` nimmt `variant: 'kitchen' | 'full'` und schaltet damit zwei
Blöcke.

**4. `both` ist der Bestands-Default, und der Fallback sitzt an der
Leseposition.** `receiptVariantForRole(role)` liefert `kitchen` **nur** für
exakt `'kitchen'`; jeder andere Wert — `undefined`, `null`, `''`, ein Tippfehler,
eine künftige Rolle — ergibt den Vollbon.

**5. Der Filialkopf wird neu gebaut, nicht wiederhergestellt.** Er trägt jetzt
zusätzlich den Filialnamen (`location.name`, dieselbe Quelle wie
`ReceiptSeller.name`) und folgt der in ADR 0007 / §10 gemessenen Font-Sequenz.

### Warum keine Zuordnung Warengruppe→Drucker

Das Stations-Routing ist die Funktion, die POS-Systeme üblicherweise anbieten:
Getränke an die Theke, Speisen an den Grill. Verworfen, weil es das hier
vorliegende Problem **nicht löst**:

| | Stations-Routing | Rollenmodell |
|---|---|---|
| Trennt | *welche Positionen* ein Drucker sieht | *welche Blöcke* ein Bon trägt |
| Löst die Belegfrage | nein — jede Station bekäme weiter denselben Vorlagen-Typ | ja |
| Pflegeaufwand | je Warengruppe eine Zuordnung, bei jedem neuen Sortiment nachzuziehen | eine Auswahl je Drucker, einmalig |
| Bestands-Verhalten | leere Zuordnung = druckt nichts? druckt alles? | fehlendes Feld = `both`, unverändert |

Der Unterschied zwischen Küchenzettel und Quittung liegt nicht im Sortiment,
sondern im Belegcharakter. Ein Betrieb, der beides will, kann später ein
Stations-Routing **zusätzlich** bekommen — die Rolle steht dem nicht im Weg,
weil sie eine andere Frage beantwortet.

### Warum `both` und nicht `receipt` als Default

Beide Werte drucken heute denselben Vollbon, die Wahl ist also zur Laufzeit
folgenlos — aber nicht in der Aussage. `both` sagt „dieser Drucker ist nicht
zugeordnet", `receipt` sagt „dieser Drucker ist der Kassendrucker". Für einen
Bestandsdrucker, über den nie jemand entschieden hat, ist nur das Erste wahr.
Und sobald eine künftige Änderung `receipt` enger auslegt, verhält sich `both`
weiter wie heute.

### Warum der Fallback nicht im Schema steht

Der `default: 'both'` im TypeBox-Schema ist **dokumentierend, nicht wirksam**:
Der geteilte `dataValidator` läuft ohne `useDefaults`, AJV füllt nichts nach
(dieselbe Lage wie bei `port` und `encoding` daneben). Ein Verlass auf den
Schema-Default hätte bedeutet, dass die Rolle erst beim nächsten Schreibvorgang
auf der Location entsteht — gedruckt wird aber vorher.

## Konsequenzen

**Bestandsinstallationen drucken unverändert weiter** — mit einem gewollten
Unterschied: Der in #342 entfernte Filialkopf ist zurück, weil ein Drucker ohne
Rolle den Vollbon bekommt. Das ist der eigentliche Zweck der Kette
#346 → #347 → panary-cloud#487.

**🚨 Der Bestands-Default ist die einzige Stelle, an der stiller Schaden
entsteht.** Würde ein fehlendes `role` als `kitchen` gewertet, verlöre jede
Bestandsinstallation Filialkopf und TSE-Block vom Kundenbeleg — ohne Fehler,
ohne Log, sichtbar erst auf Papier. Deshalb ist der Fallback an *einer* Stelle
zentralisiert und mit jedem Eingabewert einzeln getestet; zwei Mutationsproben
belegen, dass die Tests den Fehler fangen.

**Das Feature ist erst mit dem Cloud-Teil nutzbar.** Drucker stehen unter
Cloud-Hoheit (ADR 0001); im Edge-Admin ist die Verwaltung außerhalb des
Notfall-Modus gesperrt. Die Rollenauswahl im Edge-Formular erbt diese Sperre
über `readOnly` und ist damit in gepairten Filialen sichtbar, aber nicht
editierbar. Ohne panary-cloud#487 kann ein Kunde die Rolle faktisch nicht
setzen. Reihenfolge zwingend: Core-Release → Pin-Bump in panary-cloud → Cloud-UI.

**Der Notfall-Override im Sync trägt das Feld ohne Änderung mit.** Der Zweig
`printSettings.printers/<pid>` in `panary-cloud/apps/api-cloud/src/services/sync/sync.ts`
ersetzt den Drucker-Datensatz als Ganzes und kennt außer `pid` kein Feld
namentlich — es gibt keine Allowlist, die nachzuziehen wäre. Geprüft 2026-09-21.

**Keine Migration.** `role` ist optional, und das Schema setzt kein
`additionalProperties: false` — Bestandsdaten dürfen den toten
`primaryTopics`-Schlüssel behalten, ohne die Validierung zu verletzen.

**Kein Buffer-Cache über gleiche Papierbreiten.** Seit #346 rendert der Edge je
Zieldrucker; ein Cache-Schlüssel aus der Breite allein wäre ab jetzt still
falsch und gäbe dem Küchendrucker den Bon des Kassendruckers. Gemessener Preis
des zweiten Renders: ~1,5 ms.

**Beide Print-Events tragen `variant`.** `/print-server/*` sind rohe Koa-Routen
und laufen nicht durch `canonicalLog`; ohne das Feld sähe ein falsch gerollter
Drucker im Log aus wie ein richtig gerollter.

## Was bewusst offen bleibt

- **Der MQTT-Druckpfad kennt die Rolle nicht.** `OrderPrintService.printViaMqtt`
  rendert im Client; das Backend sieht die Nutzlast nie. Die Trennung gilt
  ausschließlich für IP-Drucker — wer sie für MQTT erwartet, irrt.
- **Rechtlich ungeprüft:** ob ein Betrieb mindestens einen `receipt`- oder
  `both`-Drucker konfiguriert haben **muss**. Ein Betrieb, der alle Drucker auf
  `kitchen` stellt, hat danach keinen Beleg mehr; erzwungen wird das hier nicht.
  Frage an ADR 0007 bzw. die steuerliche Beratung.
- **`receipt-escpos.renderer.ts`** (der fiskalische Beleg) hat weiterhin keinen
  Aufrufer. Ob die Quittungsvariante mittelfristig dorthin wandert, entscheidet
  ADR 0007, nicht dieses ADR.
- **Kein Stations-Routing.** Siehe oben — verworfen, nicht vergessen.

## Status

Entschieden 2026-09-20, umgesetzt 2026-09-21
([#347](https://github.com/panary/panary-core/issues/347)). Der Cloud-Teil
([panary-cloud#487](https://github.com/panary/panary-cloud/issues/487)) steht aus.
