---
type: Domain Concept
title: POS-Kasse — Schließen, Kombinationen mit Stückzahl, Steuerleiste
description: 'Wie die Kasse das Schließen absichert, Kombinationen stückweise bildet und auflöst, Modifier-Mengen anzeigt, beim Hinzufügen zur Zeile scrollt und sie hervorhebt, die markierte Zeile über die Steuerleiste bearbeitet und ihre Zonen auf breiten wie schmalen Kassen anordnet.'
tags: [orders, pos, ui]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-26T20:00:00Z }
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

### Beim Hinzufügen (core#1116)

Nach jedem Produkt-Tipp zeigt der Warenkorb die betroffene Zeile und hebt sie kurz hervor
([core#1116](https://github.com/panary/panary-core/issues/1116), Variante A).

| Fall | Scrollziel | Hervorhebung |
| --- | --- | --- |
| neue Position | die neue, letzte Zeile | fährt in 200 ms 8 px von oben ein, leuchtet danach 900 ms in Mint (`--accent-soft`) aus |
| dasselbe Produkt nochmal | die hochgezählte Zeile | Anzahl hüpft (scale 1.15, 180 ms), Zeile leuchtet 900 ms |

- **Ein Weg zum Scrollen.** `revealCartLine` in `cart-scroll.ts` scrollt mit derselben Bewegung wie die
  Steuerleiste (`block: 'nearest'`, sanft), ebenfalls per `afterRenderEffect`. Öffnet das Hinzufügen zugleich
  eine Steuerleiste (Anpassen, Menü-Ablauf), läuft deren Effekt danach und hat das letzte Wort.
  Unten bleibt Platz für Außenabstand und Listenrand (`scroll-margin-bottom` 0,75rem). Eine neue Zeile bekommt
  8px dazu, denn `scrollIntoView` misst sie, während sie noch einfährt und um diesen Versatz höher steht. Ohne
  den Zuschlag blieb sie danach 8px angeschnitten ([core#1121](https://github.com/panary/panary-core/issues/1121),
  im Sichttest #1119 gemessen).
- **Eigenes Wischen geht vor.** Hat die Bedienung in den letzten 1,5 s selbst in der Liste gewischt
  (`touchmove`, `wheel`; passive Listener außerhalb der Change Detection), springt sie nicht. Das
  `scroll`-Ereignis taugt dafür nicht, es feuert auch beim Scrollen von selbst. Die Hervorhebung kommt trotzdem.
- **Neustart statt Stapeln.** Ziel ist das Signal `cartPing` (`lineId`, `kind`, `seq`). Die Klasse wechselt
  mit jedem Tippen zwischen `kasse-line-<kind>-0` und `-1`, und die SCSS legt jede Animation doppelt an: Nur ein
  neuer Animationsname startet sie neu. Nach 1,2 s räumt ein Timer `cartPing` ab, sonst spielte ein Umbau der
  Liste (Kombinieren, Herauslösen) die Animation erneut ab.
- **Nur `transform` und `opacity`.** Das Mint liegt als Fläche in `::before` hinter dem Inhalt und blendet über
  `opacity` aus. Hell und dunkel kommen aus dem Token. Bei „Bewegung reduzieren" entfallen Einfahren und
  Hüpfen, das Aufleuchten bleibt.
- Öffnet die neue Zeile sofort das Anpassen-Sheet, läuft der Hinweis-Impuls „wird angepasst" neben dem
  Einfahren weiter; beide setzen `animation` auf dasselbe Element und müssen deshalb gemeinsam deklariert sein.
- Gilt für Einzelzeilen und Positionen einer markierten Kombination. `+` in der Steuerleiste ist kein
  Hinzufügen: Die Zeile ist dort schon markiert und sichtbar.

## Steuerleiste und Optionen (seit core#829)

Spalte 2 ist entfallen ([ADR 0059](../adr/0059-pos-layout-b-zonen-steuerleiste-spiegelung.md)).

| Was | Wo |
| --- | --- |
| Auswählen, Abwählen | Tipp auf die Zeile, zweiter Tipp hebt auf |
| −, Menge, +, Anpassen bzw. Kombi lösen, Löschen | Steuerleiste direkt unter der markierten Zeile, Position oder Kombination, je 3,5rem; − bei Menge 1 aus, Menge und Löschen mit Rückgängig. Nach dem Markieren scrollt der Warenkorb die Leiste samt Außenabstand in den Sichtbereich (`block: 'nearest'`, nur so weit wie nötig; `cart-scroll.ts`, [core#1021](https://github.com/panary/panary-core/issues/1021)), direkt nach dem Rendern per `afterRenderEffect` ([core#1047](https://github.com/panary/panary-core/issues/1047): ein `effect` lief erst im nächsten Uhr-Takt, ≈ 1,6 s später) |
| Rabatt, Kombination, Optionen | Reihe mit der Primärtaste unter dem Warenkorb (seit [core#1067](https://github.com/panary/panary-core/issues/1067), vorher Leiste unter der Summe); Kombination öffnet die Kombinationsansicht (core#965) |
| Pos.-Rab. (nur mit Auswahl), Personalessen, Firmenkunde, Rabattcode, Preise ein/aus, Weitere Aktionen | „Optionen" in der Reihe unter dem Warenkorb, öffnet nach oben; „Weitere Aktionen" öffnet „Bestellung leeren" und „Kunde entfernen"; ein geprüfter Code steht am Eintrag ([core#908](https://github.com/panary/panary-core/issues/908)) |
| Funktionstasten über dem Raster | keine im Hauptbereich; nur laufende Abläufe setzen welche (`boardFunctionButtons`, core#965) |
| Meldungen | Hinweis über dem unteren Rasterrand, 4 s, Fehler 6 s, nimmt keine Tipps an; ohne Leerlauf-Text und ohne Echo von Gruppe oder Funktionsblock (`notice`, core#908) |
| Kanal Kasse/Telefon | Schalter im Warenkorbkopf, Zustand ohne Antippen ablesbar |

## Layout

| Bereich | Regel |
| --- | --- |
| Zonen | Grid aus Gruppenleiste, Warenkorb, Raster, Primärtaste, Ziffernleiste; `data-hand` aus `posHandedness` spiegelt Warenkorb ↔ Raster und Primärtaste ↔ Ziffernleiste, ohne Wahl links ([ADR 0059](../adr/0059-pos-layout-b-zonen-steuerleiste-spiegelung.md)) |
| Warenkorb | fest 25rem |
| Gruppenleiste | eine Zeile, Gruppen mit gleichem Grundmaß (`--pnry-group-chip` an `.kasse`, 5,25rem; danach wird gezählt), die freien Platz bis 8,5rem unter sich teilen ([core#1046](https://github.com/panary/panary-core/issues/1046)), lange Namen brechen in zwei Zeilen um, mit Silbentrennung (`lang="de"`, nur hier — Kacheln trennen nicht); Farbe als 0,25rem-Kante oben über die volle Tastenbreite (`--group-color`, `.kasse__group-edge`), die Gruppe im Raster mit Tönung, Rand in Gruppenfarbe, kräftigerer Kante und `aria-current` (`activeProductGroupId`; `clearButtons()` nimmt die Hervorhebung mit, der Rückweg `setProductButtonsByGroupId` setzt sie wieder; liegt die Gruppe hinter dem Burger, trägt er ihre Kante und der Menüeintrag einen Haken; [core#1068](https://github.com/panary/panary-core/issues/1068), vorher Farbpunkt im Textfluss, der bei 84 px Taste 16 px der ersten Zeile kostete), im Burger-Menü weiter der Punkt; der Rest hinter dem Burger am Zeilenende ([core#1019](https://github.com/panary/panary-core/issues/1019), vorher Inhaltsbreite 4,5–13rem einzeilig gekürzt). `group-bar.ts` teilt nach den Breiten einer unsichtbaren Messzeile auf; Abstand (`gap-2`) und Burger-Breite (`w-12`) stehen dort mit, beide zusammen ändern ([core#908](https://github.com/panary/panary-core/issues/908)) |
| Produkt-/Funktionskacheln | Mindestbreite 9,5rem (`--pnry-tile-min` an `.kasse`), 5,25rem hoch (`--pnry-tile-h`), Namen bis drei Zeilen, ohne Silbentrennung; der Treffer der Ziffernleiste trägt ein Mint-Abzeichen. Funktionstasten der Abläufe (Abbrechen, „Weiter ohne …", Sofort, Pager) im selben Maß. Bis [core#1020](https://github.com/panary/panary-core/issues/1020) 12,5 × 6,5rem |
| Panel-Kopf | Umschalter „1 Stück · alle n" neben dem Titel, Zusammenfassung einzeilig |
| Extras im Panel | je Gruppe ein Raster gleich breiter Spalten (`repeat(auto-fill, minmax(16rem, 1fr))`), Überschrift über die volle Breite, senkrecht scrollbar ([core#909](https://github.com/panary/panary-core/issues/909); vorher Spalten-Liste mit `column-fill: auto`) |
| Panel-Fuß | Container-Query: unter 42rem Panelbreite werden Abbrechen, Modifier und „n lösen" zu 64-px-Tasten, „Fertig" füllt den Rest |
| Ziffernleiste | unter dem Raster, am Rand gegenüber dem Warenkorb (`.kasse__keys-row`, spiegelt mit `data-hand`, die Folge nie); Container-Query auf der Leiste selbst: Multiplier-Feld, 0–9 und `C` inline ab 53,25rem Inhaltsbreite (Summe der festen Breiten 53,125rem), darunter `C` und das Ziffern-Popup. Die Schwelle wächst über rem mit der Dichte. Das `fixed` Popup steht außerhalb der Leiste ([#798](https://github.com/panary/panary-core/issues/798)) |
| Primärtaste | unter dem Warenkorb, 3,5rem hoch wie die Ziffern, Mint mit Navy-Schrift, zweizeilig: Beschriftung oben, gültiger Gesamtbetrag groß darunter. Davor in derselben Reihe Rabatt, Kombination und Optionen à 4,5rem. Die Taste liegt zum Raster hin (`.kasse__pay`, `order: -1` bei `data-hand='right'`), die drei Tasten behalten ihre Folge. Die Summe steht nur hier, die Artikelanzahl im Warenkorb-Kopf neben der Uhrzeit; Rabattzeilen und der durchgestrichene Betrag „Ohne Rabatt“ erscheinen nur bei aktivem Rabatt über dem Kartenende ([core#1067](https://github.com/panary/panary-core/issues/1067), vorher Summenzeile und Aktionsleiste im Warenkorb: 9 statt 12 Positionen bei 1366 × 768). „Bestellen" in beiden Betriebsarten bis [core#830](https://github.com/panary/panary-core/issues/830) |

## Designstudie Bestellen (core#1062)

Nach dem zweiten Kassentest am 2026-10-25 mit einer Erstnutzerin. Studie mit Varianten und Messung:
[Artifact](https://claude.ai/artifact/TK8VzRs5s23Cc3BXuKCEAu). Michael hat je Thema gewählt, umgesetzt
wird in eigenen Issues unter dem Anker [core#1027](https://github.com/panary/panary-core/issues/1027).

| Thema | Befund (1366 × 768, Sandbox) | Wahl | Umsetzung |
| --- | --- | --- | --- |
| Warenkorb-Fuß | Karte 600 px, Liste 413 px: 9 Positionen sichtbar, mit markierter Zeile 7. Summenzeile (53 px) und Aktionsleiste (68 px) unter der Liste, die Summe steht ein zweites Mal auf der Primärtaste | A „Eine Reihe": Rabatt, Kombination, Optionen und Bezahlen in der Primärzone, Summe nur auf der Taste, Anzahl im Kopf. Liste 534 px, 12 Positionen, markiert 10 | [core#1067](https://github.com/panary/panary-core/issues/1067) |
| Gruppen-Markierung | Punkt im Textfluss kostet bei 84 px Taste 16 px der ersten Zeile, lange Namen brechen um. Die aktive Gruppe ist nicht erkennbar | B „Farbkante oben" über die volle Breite, aktive Gruppe mit getönter Fläche und Rand in Gruppenfarbe | [core#1068](https://github.com/panary/panary-core/issues/1068) |
| Dialogwechsel | Pager- und Tischkacheln tragen nur eine Zahl, der Schritt steht in 10 px neben den Funktionstasten | Schrittkopf mit gewählten Werten, großer Titel, beschriftete Kacheln, dazu 220 ms Einschieben und einmaliges Aufleuchten; bei „Bewegung reduzieren" nur Einblenden | [core#1069](https://github.com/panary/panary-core/issues/1069) |
| Modifier-Sheet | Das Sheet füllt seinen Bereich bis oben, an den gerundeten Ecken scheint der Scrim als graue Zwickel durch | 20 px Abstand oben, Griffleiste, Einfahren wie bisher | [core#1066](https://github.com/panary/panary-core/issues/1066) |

Gemessen wurden Zeilenhöhe 39 px plus 4 px Abstand, eine zweizeilige Position 56 px und die Steuerleiste
80 px. Eine Position mit Extras ist höher, sie kostet je nach Anzahl eine weitere Zeile. Dass das Sheet
auf der Sunmi nicht hereinfuhr, lag vermutlich an der Android-Einstellung „Animationen entfernen": Dann
meldet der WebView `prefers-reduced-motion: reduce`, und die Kasse blendet nur ein. Am Gerät ist das
noch nicht geprüft.

## Nicht abgedeckt

Die Breiten sind im Browser in der Sandbox bei 1920 und 1280 px geprüft, nicht auf Kundenhardware
und nicht im Tauri-WebView. Die untere Leiste lief bei 1280 px über, behoben mit
[#798](https://github.com/panary/panary-core/issues/798). „Alle Artikel kombinieren" nimmt auch
Zeilen mit, die schon in einer Kombination stehen. Das war vorher schon so und ist hier nicht
geändert.

Ob die Hervorhebung beim Hinzufügen (core#1116) auf der Sunmi ruckelfrei läuft, zeigt nur das Gerät;
geprüft sind Verdrahtung und Stylesheet an der Quelle, nicht das Rendern. Ist die hochgezählte Zeile
markiert, trägt sie schon `bg-accent-soft`, und ihr Aufleuchten ist kaum zu sehen; dort bleibt das Hüpfen
der Anzahl.
