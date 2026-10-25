---
type: Domain Concept
title: POS-Kasse — Schließen, Kombinationen mit Stückzahl, Steuerleiste
description: 'Wie die Kasse das Schließen absichert, Kombinationen stückweise bildet und auflöst, Modifier-Mengen anzeigt, die markierte Zeile über die Steuerleiste bearbeitet und ihre Zonen auf breiten wie schmalen Kassen anordnet.'
tags: [orders, pos, ui]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-25T14:40:00Z }
---

# POS-Bestelldialog — Bedienung

Seit [#795](https://github.com/panary/panary-core/issues/795). Anlass: Rückmeldungen von einem Kunden
mit breiten Bildschirmen. Ein Fehltipp auf das X verwarf die Bestellung. Positionen in einer
Kombination ließen sich nicht anpassen. Aus „3× Schnitzel" ging immer alles oder nichts in eine
Kombination. Zwei rote Mülleimer ließen offen, welcher was löscht. Der Code liegt in
`libs/domains/orders/feature-pos-order-dialog/src/lib/` (`order-dialog.component.*`,
`product-customize-panel.component.ts`).

## Schließen und Leeren

| Aktion | Verhalten |
| --- | --- |
| „Übersicht" (bis core#828 das X), nichts gebucht | zurück zum Dashboard |
| „Übersicht", je ein Artikel gebucht (auch wenn alles wieder gelöscht ist) | Rückfrage „Bestellung verwerfen?" |
| Browser-Zurück oder anderer Menüpunkt | wie „Übersicht" ([Kasse als Route](pos-kasse-route.md#verlassen-der-kasse)) |
| Mehr → „Bestellung leeren" mit Positionen | Rückfrage „Bestellung leeren?" (kein Rückgängig) |

Beide Rückfragen öffnen mit `disableClose: true`. Ein Tipp daneben oder ESC schließt sie nicht, nur
die zwei Tasten. Gemerkt wird das gebuchte Artikel in `#hadInput`. Der Merker fällt nie zurück, denn
wer getippt hat, war mitten in einer Bestellung. Der Dialog selbst ist `ConfirmDialogComponent` aus
`@panary/shared/ui-common`, aus der Vorbestellungsliste dorthin gehoben (optional `cancelText`).

## Kombinationen

| Tipp auf | Wirkung |
| --- | --- |
| Kopf der Kombination | markiert die ganze Kombination (auch von einer markierten Position aus). Darunter die Steuerleiste mit −, +, „Kombi lösen" und Löschen (mit Rückgängig). Zweiter Tipp hebt die Markierung auf. |
| Position in der Kombination | markiert sie wie eine freie Zeile; „Anpassen" in der Steuerleiste öffnet das Panel, Löschen trifft nur sie |

Seit [core#829](https://github.com/panary/panary-core/issues/829) sitzen Lösen und Löschen in der
Steuerleiste unter der Kombination. Die Funktionstasten über dem Raster sind entfallen, das Raster bleibt
stehen, und ein Kacheltap legt in die markierte Kombination ([#271](https://github.com/panary/panary-core/issues/271)).

### Stückzahl beim Kombinieren

Im Kombi-Menü zählt jeder Tipp auf eine Kachel ein Stück hoch: 1/3 → 2/3 → 3/3 → aus. Die Zahl steht
als Abzeichen an der Kachel (`PosButtonUiState.countLabel`), nicht im Namen, denn lange Namen füllen
die Kachel schon. „Kombinieren" spaltet die gezählten Stück per `splitOffPieces` ab
(`@panary/orders/domain`, `line-identity.ts`) und gibt nur ihnen die `bundleNumber`. Der Rest bleibt
freie Zeile. „Alle Artikel kombinieren" nimmt weiter ganze Zeilen.

### Herauslösen

An einer markierten Position einer Kombination erscheint „n herauslösen", im Panel-Fuß oder (ohne
Panel) als Funktionstaste. `n` ist der Multiplikator, ohne Eingabe 1, höchstens die Stückzahl der
Position. Die Beschriftung zieht mit jedem Ziffernblock-Tipp mit. Das gelöste Stück wird freie
Zeile und geht über `mergeIdenticalLines` in einer gleichen freien Zeile auf, weil die
`bundleNumber` Teil des Zeilenschlüssels ist. Bleibt nur eine Position übrig, löst sich die
Kombination auf.

**Grenze:** Eine Zeile mit Modifiern „je Zeile" (`modifierScope` nicht `unit`) ist nicht teilbar
(`isSplittableLine`). Beim Kombinieren geht sie dann als Ganzes, beim Herauslösen kommt die Meldung
„nur als Ganzes herauslösen".

## Warenkorb-Anzeige

- **Menge 1** zeigt kein „1×". Die Spalte bleibt reserviert, damit die Namen bündig stehen. Der Bon
  zeigt „1×" weiterhin.
- **Modifier-Menge** wie abgerechnet: Bei „alle 3" steht „3x Ketchup +€2,10", nicht „1x". Die
  Entscheidung kommt aus `modifiersCountPerUnit` (`compute-order-tax.ts`), derselben Quelle wie das
  „je 1x" auf dem Bon. Die Summe rechnet weiter allein `compute-order-tax`.

## Steuerleiste und Optionen (seit core#829)

Spalte 2 ist entfallen ([ADR 0059](../adr/0059-pos-layout-b-zonen-steuerleiste-spiegelung.md)).

| Was | Wo |
| --- | --- |
| Auswählen, Abwählen | Tipp auf die Zeile, zweiter Tipp hebt auf |
| −, Menge, +, Anpassen bzw. Kombi lösen, Löschen | Steuerleiste direkt unter der markierten Zeile, Position oder Kombination, je 3,5rem; − bei Menge 1 aus, Menge und Löschen mit Rückgängig. Nach dem Markieren scrollt der Warenkorb die Leiste samt Außenabstand in den Sichtbereich (`block: 'nearest'`, nur so weit wie nötig; `cart-scroll.ts`, [core#1021](https://github.com/panary/panary-core/issues/1021)) |
| Rabatt, Kombination, Optionen | Leiste unter der Summe; Kombination öffnet die Kombinationsansicht (core#965) |
| Pos.-Rab. (nur mit Auswahl), Personalessen, Firmenkunde, Rabattcode, Preise ein/aus, Weitere Aktionen | „Optionen" unter der Summe; „Weitere Aktionen" öffnet „Bestellung leeren" und „Kunde entfernen"; ein geprüfter Code steht am Eintrag ([core#908](https://github.com/panary/panary-core/issues/908)) |
| Funktionstasten über dem Raster | keine im Hauptbereich; nur laufende Abläufe setzen welche (`boardFunctionButtons`, core#965) |
| Meldungen | Hinweis über dem unteren Rasterrand, 4 s, Fehler 6 s, nimmt keine Tipps an; ohne Leerlauf-Text und ohne Echo von Gruppe oder Funktionsblock (`notice`, core#908) |
| Kanal Kasse/Telefon | Schalter im Warenkorbkopf, Zustand ohne Antippen ablesbar |

## Layout

| Bereich | Regel |
| --- | --- |
| Zonen | Grid aus Gruppenleiste, Warenkorb, Raster, Primärtaste, Ziffernleiste; `data-hand` aus `posHandedness` spiegelt Warenkorb ↔ Raster und Primärtaste ↔ Ziffernleiste, ohne Wahl links ([ADR 0059](../adr/0059-pos-layout-b-zonen-steuerleiste-spiegelung.md)) |
| Warenkorb | fest 25rem |
| Gruppenleiste | eine Zeile, Gruppen gleich breit (`--pnry-group-chip` an `.kasse`, 5,25rem), lange Namen brechen in zwei Zeilen um, mit Silbentrennung (`lang="de"`, nur hier — Kacheln trennen nicht); Farbpunkt vor dem Namen im Textfluss; der Rest hinter dem Burger am Zeilenende ([core#1019](https://github.com/panary/panary-core/issues/1019), vorher Inhaltsbreite 4,5–13rem einzeilig gekürzt). `group-bar.ts` teilt nach den Breiten einer unsichtbaren Messzeile auf; Abstand (`gap-2`) und Burger-Breite (`w-12`) stehen dort mit, beide zusammen ändern ([core#908](https://github.com/panary/panary-core/issues/908)) |
| Produkt-/Funktionskacheln | Mindestbreite 9,5rem (`--pnry-tile-min` an `.kasse`), 5,25rem hoch (`--pnry-tile-h`), Namen bis drei Zeilen, ohne Silbentrennung; der Treffer der Ziffernleiste trägt ein Mint-Abzeichen. Funktionstasten der Abläufe (Abbrechen, „Weiter ohne …", Sofort, Pager) im selben Maß. Bis [core#1020](https://github.com/panary/panary-core/issues/1020) 12,5 × 6,5rem |
| Panel-Kopf | Umschalter „1 Stück · alle n" neben dem Titel, Zusammenfassung einzeilig |
| Extras im Panel | je Gruppe ein Raster gleich breiter Spalten (`repeat(auto-fill, minmax(16rem, 1fr))`), Überschrift über die volle Breite, senkrecht scrollbar ([core#909](https://github.com/panary/panary-core/issues/909); vorher Spalten-Liste mit `column-fill: auto`) |
| Panel-Fuß | Container-Query: unter 42rem Panelbreite werden Abbrechen, Modifier und „n lösen" zu 64-px-Tasten, „Fertig" füllt den Rest |
| Ziffernleiste | unter dem Raster, am Rand gegenüber dem Warenkorb (`.kasse__keys-row`, spiegelt mit `data-hand`, die Folge nie); Container-Query auf der Leiste selbst: Multiplier-Feld, 0–9 und `C` inline ab 53,25rem Inhaltsbreite (Summe der festen Breiten 53,125rem), darunter `C` und das Ziffern-Popup. Die Schwelle wächst über rem mit der Dichte. Das `fixed` Popup steht außerhalb der Leiste ([#798](https://github.com/panary/panary-core/issues/798)) |
| Primärtaste | unter dem Warenkorb, 3,5rem hoch wie die Ziffern, Mint mit Navy-Schrift, mit Gesamtbetrag; „Bestellen" in beiden Betriebsarten bis [core#830](https://github.com/panary/panary-core/issues/830) |

## Nicht abgedeckt

Die Breiten sind im Browser in der Sandbox bei 1920 und 1280 px geprüft, nicht auf Kundenhardware
und nicht im Tauri-WebView. Die untere Leiste lief bei 1280 px über, behoben mit
[#798](https://github.com/panary/panary-core/issues/798). „Alle Artikel kombinieren" nimmt auch
Zeilen mit, die schon in einer Kombination stehen. Das war vorher schon so und ist hier nicht
geändert.
