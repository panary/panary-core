---
type: Domain Concept
title: POS-Bestelldialog — Schließen, Kombinationen mit Stückzahl, Funktionsleiste
description: 'Wie der Bestelldialog das Schließen absichert, Kombinationen stückweise bildet und auflöst, Modifier-Mengen anzeigt und seine Tasten auf breiten wie schmalen Kassen anordnet.'
tags: [orders, pos, ui]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-21T11:10:00Z }
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
| X, nichts gebucht | schließt sofort |
| X, je ein Artikel gebucht (auch wenn alles wieder gelöscht ist) | Rückfrage „Bestellung verwerfen?" |
| Mehr → „Bestellung leeren" mit Positionen | Rückfrage „Bestellung leeren?" (kein Rückgängig) |

Beide Rückfragen öffnen mit `disableClose: true`. Ein Tipp daneben oder ESC schließt sie nicht, nur
die zwei Tasten. Gemerkt wird das gebuchte Artikel in `#hadInput`. Der Merker fällt nie zurück, denn
wer getippt hat, war mitten in einer Bestellung. Der Dialog selbst ist `ConfirmDialogComponent` aus
`@panary/shared/ui-common`, aus der Vorbestellungsliste dorthin gehoben (optional `cancelText`).

## Kombinationen

| Tipp auf | Wirkung |
| --- | --- |
| Kopf der Kombination | markiert die ganze Kombination (auch von einer markierten Position aus), rechts „Kombination auflösen" und „Kombination löschen" (mit Rückgängig). Der Mülleimer in Spalte 2 ist dann aus, damit es nur einen Löschweg gibt. Zweiter Tipp hebt die Markierung auf. |
| Position in der Kombination | markiert sie und öffnet das Anpassen-Panel wie eine freie Zeile; der Mülleimer löscht nur sie |

„Kombination auflösen" sitzt nur noch an der markierten Kombination, nicht mehr im Kombi-Menü. Der
frühere Eintrag „Kombination löschen" im Löschen-Menü ist entfallen.

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

## Funktionsleiste (Spalte 2)

Abwählen · Menge + · Menge − · Löschen · Preise · Mehr · Kombi. Jede Taste trägt ein Label unter
dem Icon. Nur „Löschen" ist rot. „Mehr" ist neutral und öffnet „Bestellung leeren" und
„Kunde entfernen". „Preise" ist eingeschaltet weiß hinterlegt mit blauem Rahmen (`aria-pressed`).

## Layout

| Bereich | Regel |
| --- | --- |
| Warenkorb (Spalte 1) | 35 %, mindestens 18,75rem, **höchstens 30rem** |
| Gruppen-Tasten | 6rem (5,25–7rem), Text oben, `text-xs`, Silbentrennung (`lang="de"`) statt `break-words`. Die Mindestbreite steht auch in `calculateVisibleProductGroups()` (89 px je Taste), beide zusammen ändern |
| Produkt-/Funktionskacheln | `text-xs`, Namen bis drei Zeilen |
| Panel-Kopf | Umschalter „1 Stück · alle n" neben dem Titel, Zusammenfassung einzeilig |
| Extras im Panel | Spalten wie die Listenansicht im Explorer (`columns-[16rem]`, `column-fill: auto`): erst untereinander, dann rechts weiter, waagrecht scrollbar |
| Panel-Fuß | Container-Query: unter 42rem Panelbreite werden Abbrechen, Modifier und „n lösen" zu 64-px-Tasten, „Fertig" füllt den Rest |
| Untere Leiste | Container-Query auf der Leiste selbst: Den Ziffernblock 0–9 und `C` zeigt sie erst ab 84,75rem Inhaltsbreite inline, darunter `C` und das Ziffern-Popup. Die Schwelle ist die Summe der festen Breiten (84,625rem) und wächst über rem mit dem Fluid-Scaling mit. Bei 16 px Root schaltet sie am Dialog ab 1425 px Viewport um (gemessen in der Sandbox, Leiste dann 1380,5 px breit). Das `fixed` Popup steht außerhalb der Leiste ([#798](https://github.com/panary/panary-core/issues/798)) |

## Nicht abgedeckt

Die Breiten sind im Browser in der Sandbox bei 1920 und 1280 px geprüft, nicht auf Kundenhardware
und nicht im Tauri-WebView. Die untere Leiste lief bei 1280 px über, behoben mit
[#798](https://github.com/panary/panary-core/issues/798). „Alle Artikel kombinieren" nimmt auch
Zeilen mit, die schon in einer Kombination stehen. Das war vorher schon so und ist hier nicht
geändert.
