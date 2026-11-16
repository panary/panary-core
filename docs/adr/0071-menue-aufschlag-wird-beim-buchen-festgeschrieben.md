---
type: ADR
title: 'Menü-Aufschlag wird beim Buchen an der Zeile festgeschrieben, der General-Preis ist keine Anzeigequelle mehr'
description: 'Der Aufschlag einer Menü-Komponente (teureres Getränk, andere Beilage) steht als optionales Feld `surcharge` an der Bestellzeile und wird beim Buchen bestimmt. Bon, Kasse und Cloud-Detail lesen ihn über zwei geteilte Lesefunktionen und rechnen ihn nirgends selbst aus. Ohne Feld kein Betrag, kein Backfill.'
tags: [orders, bon, pricing, menue, print-server]
status: stable
decision: accepted
generated: { by: claude-code/sonnet-5.5, at: 2026-11-15T22:00:00Z }
---

# ADR 0071 — Menü-Aufschlag wird beim Buchen festgeschrieben

> **Entschieden am 2026-11-15** von Michael (Anker panary/panary-core#1445, Unter-Issue panary/panary-core#1452).

## Problem

Der Bon druckte an einer Menü-Komponente `Komponentenpreis − General-Preis` der Filiale
(`genericProductSettings.generalDrinkPrice` / `generalSideDishPrice`). Für diese Werte gibt es keine
Eingabemaske, sie stehen auf dem Default 0. Der Bon druckte deshalb den vollen Preis der enthaltenen Cola
(2,30 €), obwohl der Positionsbetrag sie nie extra berechnete. Zusätzlich hätte jede spätere Preisänderung
einen Nachdruck verfälscht, weil die Anzeige aus aktuellen Stammdaten statt aus der Buchung rechnete.

## Entscheidung

1. **Festschreiben beim Buchen.** Der Aufschlag steht als optionales Feld `surcharge` am Slot (`menuSideDish`,
   `menuDrink`) und an `lineComponentSchema`: Euro brutto je Stück der Komponente, `minimum: 0`. Spätere
   Preisänderungen gelten nur für neue Bestellungen.
2. **Nie Teil des Positionsbetrags.** `lineItemGrossCents` / `lineGrossCents` bleiben unverändert; der Aufschlag
   ist eine Anzeigegröße, kein Rechenwert der Preis-Engine.
3. **Zwei Lesefunktionen als einzige Quelle** (`@panary/orders/domain`, `menuComponentSurchargePerUnitCents` und
   `menuComponentSurchargeLineCents`). Beide liefern `0` bei `FIXED_PROPORTIONAL` und wenn das Feld fehlt. Die
   Zeilenfassung skaliert wie die Engine mit `component.amount × line.amount`.
4. **Ohne Feld kein Betrag, kein Backfill.** Bestand und ältere Kassen zeigen an Komponenten keinen Betrag. Der
   General-Preis entfällt als Anzeigequelle.
5. **Reihenfolge nach ADR 0070.** Die Cloud bekommt das Feld per Pin-Bump (panary/panary-cloud#2089), bevor eine
   Kasse es schreibt (panary/panary-core#1454).
6. **Bezugsgröße ist die Auswahlgruppe des Menüs** (panary/panary-core#1454, entschieden am 2026-11-15). Der Aufschlag
   einer Wahl ist in einer **Pflichtgruppe** (`minSelections ≥ 1`) ihr Preis minus der Preis der günstigsten Option
   derselben Gruppe, in einer **freiwilligen Gruppe** (`minSelections: 0`) ihr voller Preis, denn dort ist nichts
   im Menü enthalten. Beispiel: Cola 2,30 €, Weizenbier 2,90 € → Cola 0, Weizenbier 0,60 €. Gerechnet wird in Cents,
   gespeichert als Euro brutto je Stück (`menuComponentSurchargeOfChoiceCents`). Optionen, die der Katalog nicht
   auflöst, zählen nicht als Messlatte. Bei `FIXED_PROPORTIONAL` wird nichts gestempelt. Die Kasse schreibt den
   Wert an Slot und Komponente derselben Zeile; eine neue Wahl in der Gruppe ersetzt beide samt altem Aufschlag.
   Die `general*Price`-Getter der Filiale entfallen im Code (keine Leser mehr).

## Konsequenzen

- Ab core#1454 schreibt die Kasse das Feld; Bestellungen davor tragen es nicht und zeigen an Komponenten keinen Betrag.
  Ändert jemand die Preise der Optionen, gilt das nur für neue Bestellungen.
- Ein Nachdruck einer Bestandsbestellung zeigt an Komponenten keinen Betrag mehr, anders als ihr Originalbon.
- Kasse (panary/panary-core#1453) und Cloud-Detail stellen auf dieselben Lesefunktionen um; bis dahin zeigen sie
  etwas anderes als der Bon.
- Keine DB-Migration: `lineItems` liegt am Edge als JSON-Text. Die Zeilen-Schemas sind offen, ältere Leser
  übergehen das Feld.
