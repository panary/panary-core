---
type: Domain Concept
title: POS-Anpassen-Panel — Zutaten abwählen, Extras hinzufügen
description: 'Beim Antippen eines Produkts mit ui.showOptionsAuto (oder einer Warenkorb-Position) zeigt der Bestelldialog rechts ein Panel mit abwählbaren Zutaten und Extras je Optionsgruppe; die OHNE-Funktionstaste ist entfallen.'
tags: [orders, pos, products]
status: stable
generated: { by: claude-code/opus-5, at: 2026-10-13T20:30:00Z }
---

# POS-Anpassen-Panel

Seit [#639](https://github.com/panary/panary-core/issues/639). Szenario: Ein Gast bestellt einen
Burger ohne Ketchup und mit extra Käse. Die Bedienung tippt den Burger an, rechts erscheint statt
des Produktrasters das Panel **„Anpassen"**. Dort ist Ketchup abzuwählen und Käse per Plus
hinzuzufügen. „Fertig" führt zurück ins Raster der Produktgruppe.

## Wann es sich öffnet

| Auslöser | Bedingung |
| --- | --- |
| Antippen des Produkts (Kachel oder Numpad-Nummer) | `product.ui.showOptionsAuto === true` **und** anpassbarer Inhalt |
| Antippen der Position im Warenkorb | anpassbarer Inhalt, unabhängig vom Flag |

**Anpassbarer Inhalt** heißt: mindestens eine `ingredientReferences`-Zutat mit `isRemovable: true`
oder eine `optionGroups`-Gruppe mit Optionen (`hasCustomizableContent` in
`libs/domains/orders/feature-pos-order-dialog/src/lib/product-customize.ts`). Ohne beides bleibt es
beim bisherigen Extras-Raster mit „Alle Modifier anzeigen".

Bundles (Menüs) öffnen das Panel **nicht**. Sie laufen weiter durch den Bundle-Flow mit seinen
Pflichtschritten.

`ui.showOptionsAuto` pflegt die Cloud-Produktdetailseite. Das Legacy-Feld `showExtrasAfterSelect`
wird weiterhin nur im Soßen-Schritt gelesen und nicht migriert.

### Eigene Zeile je Tipp

Ein Produkt, das das Panel von selbst öffnet, bekommt **je Tipp eine eigene Warenkorbzeile**, statt
die Menge einer vorhandenen Zeile zu erhöhen. „Ein Burger ohne Ketchup, einer normal" braucht zwei
Zeilen, und eine Anpassung an einer zusammengelegten Zeile träfe jedes Stück. Der Multiplikator
(`3 ×` vor dem Tipp) ergibt weiterhin eine Zeile mit Menge 3. Das Panel zeigt dann „gilt für 3×".

## Aufbau

| Bereich | Inhalt | Bedienung |
| --- | --- | --- |
| Kopf | Produktname, „gilt für n×", Zusammenfassung („ohne Ketchup · 2× Käse") | — |
| Zutaten | jede `isRemovable`-Zutat als Chip, Name aus `displayName` vor `ingredientName` | Tipp schaltet „drin" ↔ „ohne" (rot, durchgestrichen, Preis-Effekt) |
| Extras | je Optionsgruppe eine Liste mit Name, Aufpreis, `−` Menge `+` | Plus gesperrt bei `maxSelections`, Minus bei Menge 0 |
| Fuß | Abbrechen · Alle Modifier · Fertig | Fertig gesperrt („Noch n wählen"), solange `minSelections` fehlt |

- **`maxSelections: 0`** gilt als unbegrenzt.
- Eine Option, deren Produkt kein Modifier ist, steht mit Warnhinweis da und lässt sich nicht
  buchen (dieselbe Regel wie im Raster, #273).
- **Abbrechen** stellt die Modifier vom Öffnen des Panels wieder her. Jeder andere Ansichtswechsel
  (Produktgruppe, andere Position, Auswahl aufheben) schließt das Panel und **behält** die
  Änderungen — wie früher der Wechsel aus dem Extras-Raster.
- **Alle Modifier** öffnet das Raster aller Katalog-Modifier für die Zeile, etwa für ein Extra, das
  in keiner Optionsgruppe des Produkts steht.

Gebucht wird über dieselben Methoden wie bisher. Zutaten nutzen `toggleIngredientRemoval`, also den
Modifier „Ohne X" (siehe [„OHNE"-Modifier](modifier-ohne-marker.md)). Extras laufen über
`increaseExtra`/`decreaseExtra` mit dem **Gruppennamen als `topic`**, sodass `pricingMode: 'HIGHEST'`
und die Gruppenzählung des Bundle-Flows greifen.

## Aufteilung im Code

| Datei | Rolle |
| --- | --- |
| `product-customize.ts` | reine Funktionen: Modell bauen, Zutat umschalten, Auslöser prüfen |
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

- Verbrauch: Eine abgewählte Zutat wird heute noch voll verbucht
  ([#640](https://github.com/panary/panary-core/issues/640)).
- Storefront: Zutaten-Abwahl bei der Online-Bestellung, hinter Feature-Flag
  ([panary/panary-cloud#1104](https://github.com/panary/panary-cloud/issues/1104)).
