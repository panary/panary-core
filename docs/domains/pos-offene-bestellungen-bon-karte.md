---
type: Domain Concept
title: POS-Offene Bestellungen — Bon-Karte
description: 'Wie die Bon-Karte unter „Offene Bestellungen“ Positionen, Modifier, Beilage und Getränk in einem Raster mit Preisspalte zeigt, den Kopf in einer Zeile hält und das Aktionsmenü vollständig sichtbar macht.'
tags: [orders, pos, ui]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-26T21:50:00Z }
---

# POS-Offene Bestellungen — Bon-Karte

Seit [core#1126](https://github.com/panary/panary-core/issues/1126). Code:
`libs/domains/orders/feature-pos-active/src/lib/active-orders.component.{html,ts}`.

## Positionen: Raster Menge | Name | Preis

Jede Position ist ein Grid mit drei Spalten (`2rem | minmax(0,1fr) | auto`, in Kombinationen `1.5rem`). Unterzeilen
(Modifier, Beilage, Getränk) setzen ihren Namen in die Namensspalte und tragen eine **eigene Preiszelle** in der
Preisspalte. Alle Beträge einer Karte enden damit an derselben rechten Kante, `tabular-nums`, rechtsbündig. Vorher
standen die Aufpreise in der Namensspalte und endeten an deren Rand; lange Namen wie „Coca Cola ZERO*“ brachen um.

| Zeile | Schrift | Preis |
|---|---|---|
| Position | `text-ink` | Zeilensumme ohne Vorzeichen |
| Modifier | `text-xs text-ink-muted`, „+“ vor dem Namen | `+0,70 €` (Betrag wie Engine und Bon, #698); 0-€-Modifier ohne Preis |
| Beilage, Getränk eines Menüs | `text-sm text-ink` mit Symbol | Menü-Aufpreis `+2,30 €` ([core#807](https://github.com/panary/panary-core/issues/807)), beim Festpreis-Menü keiner |

Die Preiszelle wird auch leer gerendert, damit die Folge der Grid-Zellen nicht verrutscht. Beilage und Getränk liefert
die Vorlage `#menuParts` als zwei Zellen ins Raster der Position, für freie Positionen und Kombinationen gleich.

### Modifier unter ihrer Komponente

Seit [core#1127](https://github.com/panary/panary-core/issues/1127) stehen Modifier, die zu Beilage oder Getränk
gewählt wurden, direkt unter der Komponente: `text-xs text-ink-muted pl-6`, eine Stufe weiter eingerückt, Preis in
derselben Preisspalte (Vorlage `#componentModifiers`). Die Gruppierung kommt aus `groupModifiersByComponent(item,
{ components: false })`; Modifier ohne Zuordnung bleiben unter der Position wie bisher. Modell und Regeln:
[Modifier je Menü-Komponente](modifier-menue-komponente.md).

## Kopf in einer Zeile

Grid `1fr | auto | 1fr`: `#0386` links, Bon-Nummer groß mittig, Uhrzeit rechts, beide kleinen Werte vertikal zur
Nummer zentriert. Die Zeile „Uhr“ (`COMMON.CLOCK`) entfällt hier; der Schlüssel bleibt für andere Stellen.

## Aktionsmenü: Karte wächst mit dem Overlay

Bon-Inhalt und Overlay liegen in **derselben Grid-Zelle** der Karte (`grid-cols-1 grid-rows-[minmax(0,1fr)]`). Die
Karte ist so hoch wie der größere der beiden Teile, gedeckelt durch `cardMaxHeight()`: Bei unbestimmter Höhe löst
das Grid `1fr` gegen `max-height` auf. Darüber scrollt das Overlay innen (`overflow-y-auto`, `justify-center-safe`),
der Bon-Inhalt behält sein eigenes Scrollen (`min-h-0`). Vorher lag das Overlay `absolute inset-0` über dem Bon und
schnitt auf kurzen Karten oben ab; der Schließen-Knopf war nicht erreichbar.

Gemessen in der Sandbox (Chromium, 1280 × 520, Zoom 120 %): Karte auf `cardMaxHeight()` (280,7px), Overlay
`scrollHeight` 348 bei `clientHeight` 279, erster Knopf innerhalb der Karte, Nachbarkarten unverändert. Bei 70 % und
85 % wächst die kurze Karte auf die Overlay-Höhe, ohne innen zu scrollen.

## Eine Karte je Abrechnungskreis

Seit [core#1141](https://github.com/panary/panary-core/issues/1141), Folge von [ADR 0063](../adr/0063-nachbestellung-als-neue-bestellung-im-abrechnungskreis.md)
Nr. 6: Der Bediener denkt „Tisch 4“, nicht „Vorgang 3 von 5“. Hat ein Tisch durch Nachbestellungen mehrere offene
Bestellungen, zeigt „Offen“ **eine Kreis-Karte** statt mehrerer Bons.

| Fall | Darstellung |
|---|---|
| Zwei oder mehr offene Bestellungen mit gleichem, echtem `settlementScope` und Tisch | Kreis-Karte „Tisch 4 · 2 Bestellungen“ mit Uhrzeit und Minuten seit der ersten Bestellung und der Summe |
| Bestellung ohne Tisch oder mit synthetischem Kreis (`auto:…`) | einzelne Bon-Karte wie bisher |
| Kreis mit genau einer offenen Bestellung | einzelne Bon-Karte wie bisher |
| Zwei Besuche desselben Tisches (`4#1`, `4#2`) | zwei Kreis-Karten |

Ein Tipp auf die Kreis-Karte klappt sie auf: Die Einzelbestellungen folgen dahinter als gewohnte Bon-Karten, mit allen
Aktionen (Abschließen, Split, Rabatt …). Die Kreis-Karte selbst hat keine Aktionen, denn jede Aktion gehört zu einer
einzelnen Bestellung.

### Regeln

- **Gruppierung:** reine Funktion `groupOpenOrdersBySettlementScope` in `libs/domains/orders/domain`
  (`open-order-groups.ts`). Die Liste liefert `ordersActive()`, schon nach `recordingDate` absteigend. Die Kreis-Karte steht
  an der Stelle ihrer neuesten Bestellung, andere Karten behalten ihre Reihenfolge.
- **Summe:** nie aus Positionen gerechnet. Jede Bestellung liefert ihren Betrag über dieselbe Engine wie die Einzelkarte
  (`calculateTaxSummary` auf `effectiveLineItems`), die Kreis-Summe addiert diese Beträge in Cent (`sumCents`). Aufgeklappt
  stimmen Kreis-Summe und Summe der Einzelkarten damit immer überein, auch nach einem Split.
- **Personalessen:** Ist eine Bestellung des Kreises ein Personalessen, bleibt die Summe der Kreis-Karte aus, wie bei der
  Einzelkarte (die Rabattsätze sind pro Mitarbeiter verschieden).
- **Live:** Die Kreis-Karte ist ein `computed()` auf `ordersActive()`. Neue, geänderte oder abgeschlossene Bestellungen
  aus den bestehenden `orders`-Events (auch von einer zweiten Kasse) aktualisieren sie ohne Neuladen. Die Minuten tickt
  ein Zeitgeber alle 30 s weiter.
- **Aufgeklappt-Zustand** (`expandedCircles`) liegt nur in der Komponente. Schließt die letzte Bestellung bis auf eine, wird der
  Kreis wieder zur Einzelkarte; wächst er erneut, ist er wieder aufgeklappt, solange die Seite offen bleibt.
- Ohne Besuchszähler (alter Client, Kreis nur das Tisch-Label) gruppiert die Karte alle Gäste eines Tisches am Tag.

Tests: `open-order-groups.spec.ts` (Gruppierung), `active-orders.template.spec.ts` (Einbindung, Summe aus Cent-Beträgen).
