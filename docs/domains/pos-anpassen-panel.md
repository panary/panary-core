---
type: Domain Concept
title: POS-Anpassen-Panel — Zutaten abwählen, Extras hinzufügen
description: 'Beim Antippen eines Produkts mit ui.showOptionsAuto (oder über „Anpassen“ an jeder Warenkorb-Position) zeigt der Bestelldialog ein Sheet über Raster und Ziffernleiste mit abwählbaren Zutaten, Extras je Optionsgruppe und „Alle Modifier“; ohne beides mit Leerzustand. Das alte Extras-Raster ist seit core#1085 entfallen.'
tags: [orders, pos, products]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-25T22:20:00Z }
---

# POS-Anpassen-Panel

Seit [#639](https://github.com/panary/panary-core/issues/639). Szenario: Ein Gast bestellt einen
Burger ohne Ketchup und mit extra Käse. Die Bedienung tippt den Burger an, über Raster und Ziffernleiste
gleitet das Sheet **„Anpassen"** von unten herein. Dort ist Ketchup abzuwählen und Käse per Plus
hinzuzufügen. „Fertig" führt zurück ins Raster der Produktgruppe.

## Sheet statt Ersatz (core#830)

Bis core#830 ersetzte das Panel Funktionstasten und Raster. Jetzt liegt es als Sheet über Raster- und
Ziffernzone des Kassenbildschirms (`.kasse__sheet` über `.kasse__scrim` im `.kasse__sheet-host`,
`order-dialog.component.scss`). Der Host spannt die Grid-Linien `grid-start` … `keys-end` und spiegelt deshalb
mit der Händigkeit; das Sheet reicht bis an den unteren Rand und ist nur oben gerundet
([core#909](https://github.com/panary/panary-core/issues/909) — vorher endete es über der Ziffernleiste mit eckiger
Unterkante, darüber stand ein 0,75rem-Streifen Scrim). Oben lässt es seit
[core#1066](https://github.com/panary/panary-core/issues/1066) 1,25rem frei (`inset: 1.25rem 0 0`): Dort steht ein
Streifen gedimmtes Raster, dazu kommen eine Griffleiste (`::before`, 2,5 × 0,25rem) und ein Schatten nach oben. Bis
dahin füllte es den Host bis an die Oberkante, und an den gerundeten Ecken schien der Scrim als zwei graue Zwickel
durch. So sah es nach einem Bildschirmwechsel aus statt nach einem Menü darüber (Kassentest 2026-10-25, Designstudie
[core#1062](https://github.com/panary/panary-core/issues/1062)). Das gilt für beide Sheets im Host, auch für die
Bezahlansicht. Die Extras stehen je Gruppe in einem Raster gleich breiter
Spalten (`auto-fill`, 16rem), die Überschrift über die volle Breite; gescrollt wird senkrecht:

- **Sichtbar bleiben** Gruppenleiste und Warenkorb, beide ungedimmt. Die angepasste Zeile trägt im
  Warenkorb den Hinweis „wird angepasst" und pulsiert zweimal je 600 ms.
- **Gesperrt** sind, solange das Sheet offen ist: Primärtaste, Ziffernleiste samt Feld und Popup, die
  Gruppenleiste samt Burger-Menü (`sheetOpen()`). Der Warenkorb bleibt bedienbar: Ein Tipp auf eine
  Zeile beendet die Anpassung (siehe unten, core#1086).
- **Schließen** nur über „Fertig" oder „Abbrechen". Ein Tipp auf den Scrim tut nichts, damit eine
  Anpassung nicht versehentlich verworfen wird. Auch jeder Ansichtswechsel schließt das Sheet
  (`clearButtons`).
- **Bewegung:** Sheet 240 ms (`cubic-bezier(.2,.8,.2,1)`), Scrim 160 ms, als CSS-Animation beim Einfügen
  des Elements. Ein Ausblenden gibt es nicht (das Sheet verschwindet sofort): `animate.leave` ginge nicht,
  weil die Komponente noch `@Component.animations` für die Infobox führt (NG2027). Bei `prefers-reduced-motion: reduce` nur Einblenden in 120 ms, ohne Gleiten
  und ohne Impuls; die Zeile behält einen statischen Rahmen. Kam auf der Sunmi kein Hereinfahren an, ist vermutlich unter
  Bedienungshilfen „Animationen entfernen" aktiv: Der WebView meldet dann `prefers-reduced-motion: reduce` (am
  2026-10-25 nicht am Gerät geprüft).
- Das Raster darunter ist leer, solange das Sheet offen ist: Jede Anpassen-Sitzung beginnt mit
  `clearButtons()`, das Raster baut erst „Fertig"/„Abbrechen" wieder auf.

## Wann es sich öffnet

| Auslöser | Bedingung |
| --- | --- |
| Antippen des Produkts (Kachel oder Numpad-Nummer) | `product.ui.showOptionsAuto === true` **und** anpassbarer Inhalt |
| „Anpassen" in der Steuerleiste der markierten Position (seit [core#829](https://github.com/panary/panary-core/issues/829); vorher öffnete schon der Tipp auf die Position) | **immer** — jedes Produkt, auch ein Menü, seit [core#1085](https://github.com/panary/panary-core/issues/1085) |

**Anpassbarer Inhalt** heißt: mindestens eine `ingredientReferences`-Zutat mit `isRemovable: true`
oder eine `optionGroups`-Gruppe mit Optionen (`hasCustomizableContent` in
`libs/domains/orders/feature-pos-order-dialog/src/lib/product-customize.ts`). Er entscheidet nur noch,
ob sich das Sheet beim Antippen von selbst öffnet.

### Eine Ansicht für jedes Produkt (core#1085)

Bis core#1085 nahm „Anpassen" an einem Produkt **ohne** anpassbaren Inhalt einen zweiten Weg: das alte
Extras-Raster „Extras auswählen" mit den Funktionstasten ABBRUCH und „Alle Modifier anzeigen" statt des
Sheets. Am Gerät fiel das beim Kassentest mit `pos-v26.10.31` auf: Das Schnitzel zeigte das Raster, die
Pizza das Sheet. Ursache war `setExtraSubButtons`, das nur für `#canCustomize(line)` das Sheet öffnete.
Ein Ladefehler lag nicht vor: Das Demo-Profil legt das Schnitzel mit sechs Zutaten an, keine davon
`isRemovable`, und ohne Optionsgruppe (gemessen in der Sandbox-Mongo, beide Filialen). Erst
`sandbox.sh testdaten` macht „Eier" abwählbar und hängt eine Gruppe „Extras" an. Hätte das Produkt
Optionsgruppen, deren Modifier im POS-Katalog fehlen, wäre der Weg das Sheet gewesen (die Prüfung zählt
die rohen `optionGroups`), nicht das Raster.

Seitdem gilt:

- „Anpassen" öffnet für jede markierte Zeile oder Position das Sheet. Ohne Zutaten und Extras zeigt es
  einen **Leerzustand** („Keine Extras hinterlegt", `model.empty`, `data-testid="customize-empty"`).
  Anzahl, Rabatt und Notiz bleiben in der Steuerleiste.
- **Menüs** öffnen das Sheet ebenfalls, aber ihre Optionsgruppen erscheinen dort **nicht**: Sie sind
  Menüschritte, die der Bundle-Flow mit seinen Pflichtschritten abarbeitet. Bis core#1085 öffnete ein
  Menü gar kein Panel, sondern ebenfalls das Raster.
- Nur die ganz markierte Kombination öffnet nichts. Dort heißt die Taste „Kombi lösen".
- Das Raster-Gerüst (`setExtraSubButtons`, `#fillAllModifierButtons`, `#increaseExtraFromRaster`, die
  Funktionstaste „Herauslösen") und die Legacy-Abfragen von `showExtrasAfterSelect` (Soßen-Schritt,
  Ziffernblock) sind entfernt. Das Feld kennt das Produktschema
  nicht mehr (`additionalProperties: false`), der Zweig war unerreichbar.

`ui.showOptionsAuto` pflegt die Cloud-Produktdetailseite.

### Zeilen aufspalten und zusammenführen (#699)

Eine Warenkorbzeile trägt **gleiche Stücke**: „2× Burger + Käse" heißt zwei Burger, jeder mit Käse.
Ein Modifier gilt deshalb je Stück, jede neue Zeile trägt `modifierScope: 'unit'`
([ADR 0056](../adr/0056-modifier-je-stueck-per-zeilenmerkmal.md)). Die Zeilenidentität rechnet
`lineConfigKey` (`@panary/orders/domain`, `line-identity.ts`): Produkt, Stückpreis, Kombination,
Modifier sortiert und je Id/Preis/`topic`/`pricingMode`/Abwahl summiert, dazu der Positionsrabatt.

| Lage | Verhalten |
| --- | --- |
| Panel aus dem Warenkorb an einer Zeile mit n > 1 | Kopf zeigt den Umschalter **„1 Stück \| alle n"**, Standard „1 Stück". Der erste Griff spaltet **ein** Stück ab (direkt hinter der Zeile, markiert); weitere Griffe ändern nur dieses. Nach dem ersten Griff ist der Umschalter fest. |
| Panel im Hinzufügen-Ablauf (Multiplikator, Auto-Panel) | Standard „alle" — „3 ×" Burger ohne Ketchup bleibt eine Zeile mit 3 Stück. |
| „Fertig", Wechsel zu einer anderen Zeile, Bestellen | Gleiche Konfigurationen werden **eine** Zeile. Die vordere bleibt und übernimmt die Menge; die Markierung folgt ihr. |
| „Abbrechen" | Nimmt genau die Wirkung des Panels zurück: abgespaltene Stücke gehen an ihre Herkunft zurück (samt kopiertem Rabatt), Modifier der Zeilen vom Öffnen werden wiederhergestellt. Was währenddessen von außen geschah (Produkt per Numpad, Menge aus der Steuerleiste), bleibt. |
| Produkt antippen | Landet nur auf einer Zeile **gleicher** Konfiguration, also ohne Anpassung. „1× Burger + Käse" bekommt keinen zweiten Burger, es entsteht „1× Burger". Der Multiplikator addiert die ganze Menge (bis #699 nur +1). |

- **Auto-Panel:** Die frühere Regel „je Tipp eine eigene Zeile" ist entfallen. Zwei unveränderte
  Tipps werden eine Zeile mit 2 Stück; das Panel bietet dann „1 Stück" an, und eine Anpassung trifft
  das zuletzt hinzugefügte Stück nicht anders als jedes andere — es gibt nur noch gleiche Stücke.
- **Positionsrabatt (D5):** Ein Prozent-Rabatt geht beim Abspalten mit, ein Festbetrag bleibt an der
  Restzeile (die Infobox sagt es). Zusammengeführt wird nur ohne Rabatt oder bei gleichem
  Prozent-Rabatt, nie bei Festbetrag.
- **Menüs (D6):** werden für ein Extra mit „1 Stück" aufgespalten (Bestandteile tief kopiert), aber
  **nie zusammengeführt**. Ebenso nie zusammengeführt: Zeilen ohne `externalId`, Zeilen über eine
  Kombinationsgrenze, bereits abgeschickte Bestellungen und eine Bestandszeile mit Modifiern ohne
  `modifierScope: 'unit'` mit einer neuen (die Zählweise gehört zum Schlüssel). Eine solche
  Bestandszeile wird auch nicht aufgespalten — das Stück änderte die Summe.
- **„Rückgängig"** einer Mengenänderung verfällt, sobald ein Stück abgespalten oder zusammengeführt
  wird; es bezöge sich auf einen Warenkorb, den es so nicht mehr gibt.
- Zusammenführen ist **kein** Löschen: Es entsteht kein `item-delete`-Ereignis.

## Aufbau

| Bereich | Inhalt | Bedienung |
| --- | --- | --- |
| Kopf | Produktname, Umschalter „1 Stück \| alle n" (seit #795 neben dem Titel) bzw. „gilt für n×", Zusammenfassung einzeilig („ohne Ketchup · 2× Käse") | Umschalter nur vor der ersten Änderung |
| Zutaten | jede `isRemovable`-Zutat als Chip, Name aus `displayName` vor `ingredientName` | Tipp schaltet „drin" ↔ „ohne" (rot, durchgestrichen, Preis-Effekt) |
| Extras | je Optionsgruppe Karten mit Name, Aufpreis, `−` Menge `+`, seit #795 spaltenweise (erst untereinander, dann rechts weiter) | Plus gesperrt bei `maxSelections`, Minus bei Menge 0 |
| Leerzustand | nur ohne Zutaten und Extras: „Keine Extras hinterlegt" mit Hinweis auf „Alle Modifier" (core#1085) | — |
| Fuß | Abbrechen · Alle Modifier (Umschalter) · (an einer Kombinations-Position) n herauslösen · Fertig; unter 42rem Panelbreite kompakt | Fertig gesperrt („Noch n wählen"), solange `minSelections` fehlt |

- **`maxSelections: 0`** gilt als unbegrenzt.
- Eine Option, deren Produkt kein Modifier ist, steht mit Warnhinweis da und lässt sich nicht
  buchen (#273).
- **Abbrechen** verwirft die Anpassung seit dem Öffnen des Panels, seit #699 inklusive Aufspaltung.
  Die Zeile selbst bleibt: Abbrechen verwirft die Anpassung, nicht das Produkt.
- Jeder andere Ansichtswechsel (Produktgruppe, Auswahl aufheben) schließt das Panel und **behält**
  die Änderungen.
- **Tipp auf eine Warenkorb-Zeile** bei offenem Sheet (freie Zeile, Position oder Kopf einer Kombination)
  beendet die Anpassung wie „Fertig": Die Änderungen bleiben, gleiche Zeilen werden zusammengeführt, das
  Sheet schließt, und die getippte Zeile ist markiert, auch wenn das Zusammenführen ihren Index verschoben
  hat (`#selectFromCart`, [core#1086](https://github.com/panary/panary-core/issues/1086)). Der Tipp auf die
  angepasste Zeile selbst schließt das Sheet und hebt die Markierung auf. Bis core#1086 zog das Sheet zur
  neuen Zeile mit; auf der Sunmi war dann nicht zu erkennen, welches Produkt man gerade bearbeitete.
  Eine offene Pflichtgruppe hält den Tipp nicht auf, wie bei jedem anderen Ansichtswechsel.
- **Pfeiltasten** ziehen das Sheet weiter zur neuen Zeile mit (`#followSelectionInPanel`), seit core#1085
  auch auf eine ohne Extras (Leerzustand). Plus und
  Minus buchen ohnehin auf die Zeile des Panels, nie auf die gerade markierte.
- **Änderungen von außen** kommen im Panel an: Menge per Steuerleiste oder Undo zieht „gilt für n×"
  nach, und das Löschen der Zeile schließt das Panel.
- **Alle Modifier** blendet seit core#1085 eine Gruppe „Alle Modifier" im Sheet ein und wieder aus
  (`aria-pressed`): alle Katalog-Modifier ohne die für diese Zeile ausgeschlossenen
  (`excludedButtons`/`excludedSubButtons`) und ohne die, die schon in einer Optionsgruppe des Produkts
  stehen (sonst zählte ihre Menge in beiden Gruppen). Unbegrenzt, gebucht unter dem allgemeinen
  Extra-Thema wie früher im Raster. Abspalten regelt der Umschalter „1 Stück | alle n" wie bei jedem
  anderen Extra. Vorher wechselte die Taste ins Raster aller Modifier.
  Ein so gebuchtes Extra bleibt in der Gruppe stehen, auch ausgeblendet und nach dem Wiederöffnen.
  Sonst zeigte ein Produkt ohne eigene Extras danach „Keine Extras hinterlegt", und das Extra ließe sich
  nicht zurücknehmen. Als solches Extra zählt nur ein Modifier mit dem Extra-Thema, kein Menüschritt.

Gebucht wird über dieselben Methoden wie bisher. Zutaten nutzen `toggleIngredientRemoval`, also den
Modifier „Ohne X" (siehe [„OHNE"-Modifier](modifier-ohne-marker.md)). Extras laufen über
`increaseExtra`/`decreaseExtra` mit dem **Gruppennamen als `topic`**, sodass `pricingMode: 'HIGHEST'`
und die Gruppenzählung des Bundle-Flows greifen.

## Aufteilung im Code

| Datei | Rolle |
| --- | --- |
| `product-customize.ts` | reine Funktionen: Modell bauen, Zutat umschalten, Auslöser prüfen |
| `@panary/orders/domain` `line-identity.ts` | Zeilenschlüssel, Abspalten, Zusammenführen (#699) — rein, für die Cloud teilbar |
| `product-customize-panel.component.ts` | Anzeige, Standalone + OnPush, nur `input()`/`output()`, kein eigener Zustand |
| `order-dialog.component.ts` | hält die angepasste Zeile, mutiert sie und reicht nach jeder Änderung ein neues Modell herein |

Das Panel bekommt das Modell als neues Objekt je Änderung. Die Zeile selbst wird in place mutiert,
und ein OnPush-Kind sähe ein `push` ins Modifier-Array nicht.

## Die OHNE-Funktionstaste ist entfallen

Bis #639 gab es im Extras-Raster die Funktionstaste OHNE. War sie gedrückt und tippte man ein noch
nicht gebuchtes Extra an, legte `decreaseExtra` den Marker `amount: −1` an („OHNE <Extra>"). Der
Dialog erzeugt ihn nicht mehr: Zutaten werden abgewählt, Extras nur hinzugefügt, und Minus nimmt
nur Gebuchtes zurück.

Schema (`modifierLineItemSchema.amount` minimum −1), Preisregel und Bon-Renderer bleiben
unverändert, denn Bestandsbestellungen tragen den Marker weiter, und Edge, Cloud-Sync und
Outbox-Replay müssen sie annehmen.

## Folgearbeiten

- Bedienung rund ums Panel (Schließen, Kombinationen mit Stückzahl, Herauslösen, Layout auf breiten
  und schmalen Kassen): [POS-Bestelldialog — Bedienung](pos-bestelldialog-bedienung.md), seit
  [#795](https://github.com/panary/panary-core/issues/795).

- Verbrauch: Seit [#640](https://github.com/panary/panary-core/issues/640) verbucht der
  Wareneinsatz eine abgewählte Zutat nicht mehr (Feld `removesIngredientExternalId`, siehe
  [Verbrauchs-Explosion](verbrauchs-explosion.md)). In der Cloud wirkt das erst nach dem Pin-Bump
  ([panary/panary-cloud#1103](https://github.com/panary/panary-cloud/issues/1103)).
- Storefront: Zutaten-Abwahl bei der Online-Bestellung, hinter Feature-Flag
  ([panary/panary-cloud#1104](https://github.com/panary/panary-cloud/issues/1104)).
