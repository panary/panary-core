---
type: Domain Concept
title: POS-Numpad-Artikelsuche — Artikelnummer eintippen und buchen
description: 'Wie der Bestelldialog eine über das Numpad eingetippte Artikelnummer (ui.index) auflöst: dieselbe Sichtbarkeitsregel wie das Raster (kein hideOnMainScreen) und kein Buchen bei doppelt vergebener Nummer.'
tags: [orders, pos, products]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-19T13:10:00Z }
---

# POS-Numpad-Artikelsuche

Im Bestelldialog kann die Kassenkraft statt einer Kachel die **Artikelnummer** (`product.ui.index`)
über das Numpad eintippen. Während des Tippens zeigt das Numpad den Namen des Treffers an; die
Bestätigung bucht ihn wie ein Tippen auf die Kachel (`increaseLineItem`, danach dieselbe
Folgeansicht wie im Raster).

## Regeln (#709)

| Lage | Anzeige im Numpad | Bestätigung |
| --- | --- | --- |
| Genau ein buchbarer Treffer | Produktname | bucht das Produkt |
| Kein Treffer | leer | tut nichts |
| Treffer hat `ui.hideOnMainScreen` | leer | tut nichts — wie „kein Treffer" |
| Versteckter Modifier **und** ein sichtbares Produkt mit derselben Nummer | Name des sichtbaren | bucht das sichtbare |
| Zwei oder mehr sichtbare Produkte mit derselben Nummer | „Nummer mehrfach vergeben" | bucht **nichts**, die Infobox nennt alle Treffer (rot) |

**Sichtbarkeit:** Das Numpad bucht nur, was auch im Raster bucht. Produkte mit
`ui.hideOnMainScreen` sind Modifier, die nur in Menüs und Optionsgruppen existieren (#697); als
eigenständiger Artikel würden sie über die Nummer sonst doch gebucht. Die Regel steht im Dialog
neben `#gridProducts` (`#numpadProducts`), nicht im Service — Anpassen-Panel, Optionsgruppen und
„Alle Modifier" lesen den Katalog weiter ungefiltert.

**Doppelte Nummer:** Die Artikelnummer ist im Katalog nicht eindeutig erzwungen. Früher nahm
`ProductService.findProductByIndex` per `.find` den ersten Treffer, und die Reihenfolge im Cache
entschied still, welches Produkt auf dem Bon landete. Heute liefert
`ProductService.findProductsByIndex` alle Treffer, und der Dialog bucht bei mehr als einem nichts.
Die Kassenkraft wählt das Produkt dann im Raster; behoben wird die Doppelvergabe in den
Katalog-Stammdaten.

## Code

- `libs/domains/products/data-access/src/lib/services/product.service.ts` — `findProductsByIndex`
- `libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.ts` —
  `_searchForArticleName`, `applyProductSearch`, `#numpadProducts`

## Nicht abgedeckt

Ob es in Bestandskatalogen doppelte Artikelnummern gibt, prüft der POS nicht vorab; er meldet sie
erst beim Eintippen. Eine Sperre beim Speichern in der Cloud gibt es nicht.
