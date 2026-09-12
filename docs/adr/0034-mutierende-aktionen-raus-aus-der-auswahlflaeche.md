---
type: ADR
title: Mutierende Aktionen raus aus der Auswahlfläche des Warenkorbs
description: Warum die Warenkorbzeile im POS-Bestelldialog seit #269 ein einziges Klickziel ist und Löschen, − und + als 56-px-Tasten in der Funktionsleiste auf die Markierung wirken — inklusive der Entscheidung, dass Minus bei Menge 1 deaktiviert ist statt zu löschen.
tags: [orders, pos, ux]
status: stable
decision: accepted
generated: { by: claude-code/fable-5.1, at: 2026-09-12T12:10:00Z }
---

# Mutierende Aktionen raus aus der Auswahlfläche des Warenkorbs

## Problem

Im POS-Bestelldialog war die **gesamte Warenkorbzeile** klickbar, und dieser Klick war der
**einzige** Weg zu den Extras (`selectProduct()` → `setExtraSubButtons()`). Genau innerhalb
dieser Auswahlfläche saßen links zwei **28×28 px** große Knöpfe für − und + mit
`stopPropagation`; im Kombinations-Header waren es **24×24 px**, und die wirkten auf alle
Positionen der Kombination gleichzeitig.

Die Folge im Alltag: Wer eine Soße zur Pommes geben will, tippt die Zeile an und trifft das
Plus. Die Menge steigt still um 1 — `increaseQuantity` schrieb weder ein `orderInteraction`
noch bot es ein Undo. Großes Ziel für die häufige Absicht, kleines Ziel mit Geldwirkung
mittendrin. Alle übrigen POS-Tasten sind `h-14` (56 px) plus `pnry-touch`; die Warenkorb-Knöpfe
waren die einzige Ausnahme.

Der Plus-Knopf in der Zeile war zudem redundant: Ein zweiter Tap auf dieselbe Produktkachel
erhöht die Menge bereits (`increaseLineItem` endet in `increaseQuantity(existing)`), größere
Mengen gehen über den Multiplier. Der Minus-Knopf trug dagegen ein **Doppelverhalten**: Bei
Menge 1 löschte er die Zeile — im Lösch-Menü rechts fehlte „Position löschen" ganz.

Beim Umbau kam ein zweiter Befund dazu: `getCombinations` baut die Gruppen bei jedem Aufruf
neu. `decreaseLineItem` spleißte für eine Position **innerhalb** einer Kombination deshalb in
eine Wegwerf-Kopie — die Zeile blieb still im Warenkorb, nur das `item-delete` wurde
geschrieben.

## Entscheidung

1. **Die Warenkorbzeile ist ein einziges Klickziel.** Antippen wählt aus, mehr nicht. Die Menge
   steht als Text („2×") vor dem Artikelnamen. Der Kombinations-Header ist ebenfalls nur noch
   Klickziel und markiert die ganze Kombination (`toggleCombinationSelection`).
2. **Alle mutierenden Aktionen auf die Auswahl sitzen in Spalte 2** als Tasten im Bestandsmaß
   (`pnry-touch h-14 w-14`): Löschen (rot), −, +. Sie wirken kontextabhängig auf das, was
   markiert ist — Zeile, Position in einer Kombination oder ganze Kombination
   (`selectedTargets()`). Ohne Markierung sind sie deaktiviert (`[disabled]`), kein stiller
   No-Op.
3. **Minus verringert nur noch.** Bei Menge 1 ist die Taste deaktiviert statt löschend
   (`canDecreaseSelection()`); bei einer Kombination nur, wenn **jede** Position über 1 steht.
   Der Lösch-Pfad liegt vollständig in `deleteSelection()` → `#removeLineItems()`, das über die
   Objektidentität in `#lineItems` entfernt statt über die Kopie aus `getCombinations`.
4. **Jede Mengenänderung und jedes Löschen bietet „Rückgängig" per Snackbar an** (6 s). Das
   Undo eines Löschens nimmt alle drei Wirkungen zurück: Zeile an alter Stelle,
   Positionsrabatt, `item-delete`-Ereignis; bei einer auf eine Position geschrumpften und
   deshalb aufgelösten Kombination auch die `bundleNumber` der Nachbarzeile. Ein Angebot
   verfällt, sobald ein neueres kommt, die Bestellung abgeschickt oder der Warenkorb geleert
   wird (`#undoSerial`).

Bewusst **nicht** getan: `item-increase` im Interaction-Log. Ein Zähler für den Fehlklick wäre
zwar messbar, aber die Ursache ist mit dem Umbau weg — und jeder zweite Kacheltap wäre ein
Eintrag.

## Konsequenzen

- Der Kernbildschirm ändert sein Bedienkonzept. Die Knöpfe sind nicht weg, sie sind
  umgezogen; die Mitarbeiterinnen werden sie zunächst in der Zeile suchen. Nach dem Rollout
  kurz ansagen. Der POS hat keinen Staging-Kanal — ein `v*`-Tag rollt binnen ~1 h nach Prod.
- Spalte 2 wächst von 4 auf 7 Tasten: Mindesthöhe 428 px (7×56 + 6×6) statt 242 px. Auf dem
  kleinsten Terminal ist das zu prüfen; die Ausweichoption ist Gruppieren oder Verdichten der
  bestehenden vier, **nicht** das Unterschreiten des 56-px-Maßes.
- „Runter bis weg" kostet einen Tap mehr (Minus bis 1, dann Löschen). Die Alternative — Minus
  bei 1 auf Löschen spiegeln — hätte das alte Doppelverhalten an neuer Stelle zurückgebracht.
- `decreaseQuantity` löscht nicht mehr und schreibt kein `item-delete`; das Ereignis entsteht
  nur noch beim tatsächlichen Entfernen einer Zeile und trägt die volle Menge der Zeile.
- Zwei Mengen-Wege bleiben ohne Snackbar: der zweite Kacheltap und der Multiplier. Sie sind
  Eingabe, nicht Korrektur — ein Angebot bei jedem Tap wäre Rauschen.
- Die Verdrahtung ist ohne TestBed prüfbar (ADR 0011); der eigentliche Beweis, dass der
  Fehlklick verschwindet, kommt nur aus dem Betrieb. Das Undo des `item-delete` ist nur über
  `placeOrder` beobachtbar, weil `#orderInteractions` ein echtes Private-Feld ist.

**Nachtrag (#271):** Dieselbe Wegwerf-Kopie traf auch das **Hinzufügen**: Der
Kombinations-Zweig von `increaseLineItem` pushte in `this.combinations[i]`, die Zeile war
danach nirgends — ein Kacheltap bei markierter Kombination war ein stiller No-Op, gemessen am
2026-09-12. Seit #271 schreibt auch dieser Zweig nur in `#lineItems` und setzt die
`bundleNumber`; der Positionsindex für den Bundle-Flow kommt aus der neu berechneten
Kombination. Die Regel lautet damit für beide Richtungen: **`this.combinations[…]` wird nie
als Array mutiert** — Elemente ja, das Array nie.

Umsetzung: [#269](https://github.com/panary/panary-core/issues/269) —
`libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.{html,ts,spec.ts}`.
