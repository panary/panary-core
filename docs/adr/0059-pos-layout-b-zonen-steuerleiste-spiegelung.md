---
type: ADR
title: POS-Layout B — Gruppenleiste, Warenkorbspalte, Steuerleiste, Spiegelung
description: Warum der Kassenbildschirm seit core#829 ein Zonen-Grid mit einzeiliger Gruppenleiste, fester Warenkorbspalte und einer Steuerleiste unter der markierten Zeile ist und je Mitarbeiter gespiegelt wird — ersetzt Punkt 2 von ADR 0034; core#908 hat Gruppenleiste, Infozeile und Ziffernleiste nachgeschärft.
tags: [orders, pos, ux, design-system]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-10-25T18:35:00Z }
---

# POS-Layout B — Gruppenleiste, Warenkorbspalte, Steuerleiste, Spiegelung

## Problem

Der Bestellbildschirm hatte drei Spalten: Warenkorb (35 %), eine schmale Spalte 2 mit sieben
Funktionstasten und das Raster. Darüber lag eine Gruppenleiste, die bei vielen Gruppen in ein
Überlauf-Menü kippte, und darunter eine Leiste mit fünf Icon-Tasten, „Bestellen", Multiplier und
Ziffern. Drei Befunde aus der Designstudie (Anker [core#819](https://github.com/panary/panary-core/issues/819)):

- **Spalte 2 wuchs ohne Ende.** [ADR 0034](0034-mutierende-aktionen-raus-aus-der-auswahlflaeche.md)
  Punkt 2 legte Löschen, − und + dorthin. Mit Abwählen, Preise, Mehr und Kombi waren es sieben
  Tasten und 428 px Mindesthöhe. Bei 800×600 wurden sie gestaucht (#757), und gesucht wurden sie
  weit weg von der Zeile, auf die sie wirken.
- **Gruppen per Wischen oder Menü.** Ab etwa zehn Gruppen verschwand der Rest hinter einem
  Hamburger-Menü.
- **Linkshänder** greifen bei Warenkorb links und Primärtaste links über die Ziffern hinweg.

## Entscheidung

1. **Benannte Zonen in einem Grid:** Gruppenleiste (volle Breite), Warenkorb (fest 25rem),
   Raster (Rest), Primärtaste unter dem Warenkorb, Ziffernleiste unter dem Raster. Die Kopfzeile mit der
   Infozeile ist mit [core#908](https://github.com/panary/panary-core/issues/908) entfallen (Punkt 8).
2. **Ersetzt ADR 0034 Punkt 2.** Die mutierenden Aktionen sitzen nicht mehr in einer Spalte,
   sondern in einer **Steuerleiste direkt unter der markierten Zeile**: −, Menge, +, Anpassen,
   Löschen, je 3,5rem. Bei einer ganzen Kombination wird „Anpassen" zu „Kombi lösen". Punkt 1
   gilt weiter: Die Zeile bleibt **ein** Klickziel, die Steuerleiste ist eine eigene Fläche
   daneben. Punkt 3 (Minus bei Menge 1 aus) und Punkt 4 (Rückgängig) gelten unverändert.
3. **Der Zeilentipp wählt nur aus**, der zweite Tipp hebt die Auswahl auf (ersetzt „Abwählen").
   Angepasst wird über die Steuerleiste. Bis dahin öffnete der Tipp das Panel sofort und nahm das
   Raster weg, auch wenn nur die Menge zu ändern war.
4. **Gruppenleiste ohne Wischen, eine Zeile** (seit [core#908](https://github.com/panary/panary-core/issues/908)):
   Jede Gruppe ist gleich breit (seit core#1019, unten), die Gruppenfarbe ist ein Punkt davor. Was nicht passt, liegt
   hinter einem Burger-Button am Zeilenende. `group-bar.ts` teilt nach den Breiten auf, die eine unsichtbare
   Messzeile mit allen Gruppen liefert; die Reihenfolge bleibt, keine Gruppe rückt in eine Lücke vor.
   *Vorher (core#829):* `minmax(9rem, 1fr)` in höchstens zwei Zeilen, danach „Weitere (n)". Auf dem
   MacBook brachen die breiten Felder lange Namen um, und die zweite Zeile kostete eine Rasterzeile.
   *Nachgeschärft ([core#1019](https://github.com/panary/panary-core/issues/1019)):* Die Inhaltsbreite
   kostete auf der Sunmi Gruppen in der Zeile. Seither ist jede Gruppe gleich breit (`--pnry-group-chip`,
   5,25rem), lange Namen brechen in zwei Zeilen um, mit Silbentrennung nur in dieser Taste. Die Aufteilung
   misst weiter, statt die Breite als Konstante zu wiederholen. Das Maß ist seit
   [core#1046](https://github.com/panary/panary-core/issues/1046) nur noch Grundmaß der Zählung: Freien Platz
   teilen die sichtbaren Tasten bis 8,5rem unter sich, sonst kürzte die Sandbox „ALKOHOLFREIE GETRÄNKE“ bei
   halb leerer Leiste.
5. **Spiegelung je Mitarbeiter** über `grid-template-areas` und `data-hand` aus `posHandedness`
   ([core#827](https://github.com/panary/panary-core/issues/827)). Gespiegelt werden Zonen
   (Warenkorb ↔ Raster, Primärtaste ↔ Ziffernleiste), nie Inhalte: Die Ziffern laufen 0–9 von links
   nach rechts, − steht vor +. Fehlt das Feld, gilt links, also die Position wie bisher. Keine
   `dir="rtl"`-Tricks.
6. **Spalte 2 entfällt.** Rabatt · Kombination · Optionen bilden eine eigene Leiste (core#965). Bis
   [core#1067](https://github.com/panary/panary-core/issues/1067) stand sie unter der Summe im Warenkorb, seither
   steht sie mit der Primärtaste in einer Reihe unter dem Warenkorb, und die Summenzeile ist entfallen. Kombination ist eine Mint-Taste dort (unter „Optionen" kostete sie zwei Tipps); Positionsrabatt
   (nur mit markierter Zeile), Personalessen, Firmenkunde, Rabattcode, Preise ein/aus und „Weitere Aktionen"
   liegen unter „Optionen". Der Hauptbereich zeigt initial keine Funktionstasten, nur Abläufe setzen welche. Der Kanal Kasse/Telefon ist ein Schalter im
   Warenkorbkopf, sein Zustand ist ohne Antippen ablesbar.
7. **Farbcode der Funktionstasten:** `confirm` ist Mint (`accent-*`) statt Teal, die Primärtaste Mint
   mit Navy-Schrift (`bg-action`/`text-on-action`). Amber bleibt „überspringt", Rot „verwirft"
   (code-style.md §9.1).
8. **Hinweis statt Infozeile** (core#908): Meldungen aus `setInfoBoxText` erscheinen als Hinweis über dem
   unteren Rasterrand, 4 s (Fehler 6 s), ohne Tipps anzunehmen und ohne eine Kachel zu verschieben. Stumm
   bleiben der Leerlauf-Text und das Echo dessen, was Gruppenleiste oder Funktionsblock schon zeigen.
   *Verworfen:* die Meldungen ganz streichen (rund 50 Aufrufe tragen Fehler und Sperrgründe) und eine
   schmale feste Zeile (sie hätte wieder Platz gekostet, und ein erscheinender Hinweis verschöbe das Raster
   unter dem Finger).
9. **Primärtaste und Ziffern gleich hoch** (3,5rem), die Ziffernleiste liegt am Rand **gegenüber** dem
   Warenkorb: bei links rechtsbündig, bei rechts linksbündig. Gespiegelt wird nur die Ausrichtung, die
   Folge Feld, 0–9, C bleibt (core#908).

## Konsequenzen

- Die Bedienung ändert sich am Kernbildschirm. Der Default links lässt den Warenkorb an seinem Platz,
  aber −, + und Löschen wandern aus Spalte 2 unter die Zeile, und der Zeilentipp öffnet das Panel
  nicht mehr. Ansage vor dem Rollout; Release-Bündel K2–K5 empfohlen (Plan des Ankers).
- Logik bleibt unverändert: Mengen, Löschen und Rückgängig laufen über dieselben Methoden
  (`increaseSelectedQuantity`, `decreaseSelectedQuantity`, `deleteSelection`). Multiplier und
  `product.ui.index` bleiben wie gehabt (Konzept §5), neu ist nur, dass die Kachel des Treffers ein
  Mint-Abzeichen trägt.
- Die Kombinations-Funktionstasten über dem Raster (#795) waren mit core#829 weg; seit core#965 steht der
  Einstieg „Kombination" in der Warenkorb-Leiste (core#908 hatte ihn kurz als Kachel über dem Raster). Das Raster bleibt bei markierter Kombination stehen, ein Kacheltap legt
  dort weiter ab ([#271](https://github.com/panary/panary-core/issues/271)).
- Die Primärtaste heißt in beiden Betriebsarten „Bestellen", bis die Bezahlansicht
  ([core#830](https://github.com/panary/panary-core/issues/830)) wirklich kassiert.
- Geprüft im Browser der Sandbox. Die Maße auf dem Sunmi D3 sind weiter ungemessen.

Umsetzung: [core#829](https://github.com/panary/panary-core/issues/829), Feinschliff
[core#908](https://github.com/panary/panary-core/issues/908) —
`libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.{html,scss,ts}`, `group-bar.ts`.
Bedienung im Detail: [POS-Bestelldialog — Bedienung](../domains/pos-bestelldialog-bedienung.md).
