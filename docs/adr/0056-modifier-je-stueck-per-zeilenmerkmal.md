---
type: ADR
title: Modifier je Stück per Zeilenmerkmal modifierScope
description: Warum ein Modifier künftig je Stück zählt, die Engine das aber nur für Zeilen mit modifierScope 'unit' tut und Bestandsbestellungen bitgenau wie bisher rechnen.
tags: [orders, pricing, pos, businessdays]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-10-14T12:00:00Z }
---

# Modifier je Stück per Zeilenmerkmal `modifierScope`

## Problem

Die Preis-Engine (`compute-order-tax.ts`) zählte einen Modifier im Legacy-Pfad **einmal je
Zeile**. FIXED_PROPORTIONAL, der Komponenten-Pfad und der Verbrauch (`computeCogs`,
`explodeOrderConsumption`) rechnen dagegen **je Stück**. „2× Margherita + Gauda“ kostete
deshalb einmal Gauda, verbuchte aber zweimal. Für abgewählte Zutaten war das
[panary/panary-core#696](https://github.com/panary/panary-core/issues/696): „3× Burger ohne
Ketchup“ zog den Abzug einmal ab, sparte aber dreimal Ketchup.

Der Grund für die Asymmetrie war das POS-Verhalten: Ein Extra galt für die ganze Zeile, egal
wie viele Stück sie trug. Michael hat am 2026-10-14 entschieden, dass der POS Zeilen beim
Anpassen splittet und gleiche Konfigurationen wieder zusammenführt
([#699](https://github.com/panary/panary-core/issues/699)). Danach hat jede Zeile gleiche Stücke,
und ein Modifier beschreibt **ein** Stück.

Die Engine global umzustellen geht trotzdem nicht. Nachdruck (`order-receipt.renderer.ts`),
Rabatt-, `dineLocation`- und Split-Patch (`calculate-tax-details.ts`), der Berichts-Rückfall
(`getOrderGrossCents`), Bon-Split, digitaler Beleg und die Cloud-Anzeigen rufen die Engine für
**gespeicherte** Bestellungen erneut auf. Ein Nachdruck wiese dann einen anderen Betrag aus als
der signierte Bon, ein späterer Rabatt-Patch verschöbe den `taxSnapshot`.

## Entscheidung

- Neues optionales Feld an der Order-Zeile: `modifierScope: 'line' | 'unit'`.
- `'unit'`: Modifier zählen `× line.amount`, Preis und Verbrauch stimmen überein. Die Klemme
  der Modifier-Summe auf −Basis bleibt.
- Fehlt das Feld oder steht es auf `'line'`, rechnet die Engine wie bisher, also einmal je
  Zeile. Bestand, Offline-Replay alter Edges und Sync bleiben bitgenau.
- Komponenten-Zeilen skalieren wie bisher unabhängig vom Feld.
- Eine Quelle für jede Anzeige: `modifierLineGrossCents(line, modifier)` liefert den Betrag
  eines Modifiers so, wie ihn die Engine zählt. `modifiersCountPerUnit(line)` sagt, ob der Bon
  „je“ vor die Menge schreibt. Bon, POS-Warenkorb und Verlauf nutzen beide.
- **Kein Backfill** (wie ADR 0004). Bestandsbestellungen behalten ihren damaligen Preis und
  ihren damaligen, teils doppelten Verbrauch.
- Gesetzt wird das Merkmal erst vom POS-Writer ([#699](https://github.com/panary/panary-core/issues/699))
  und vom Storefront-Server ([panary/panary-cloud#1152](https://github.com/panary/panary-cloud/issues/1152)).

## Konsequenzen

- **Reihenfolge beim Ausliefern ist Pflicht.** Erst dieses Core-Release, dann der Cloud-Pin-Bump
  (#1152), erst danach ein POS, der das Merkmal schreibt. Sonst zeigen Cloud-Bestelldetail und
  KPI-Rückfälle Werte je Zeile; der gespeicherte `taxSnapshot` bliebe aber maßgeblich.
- Neue Zeilen mit Mehrstück-Modifiern werden korrekt teurer, bei Abzügen günstiger als bisher.
- Der Bon schreibt bei Zeilen mit `'unit'` und Menge > 1 „je 1x Käse“ und als Betrag den
  Gesamtaufpreis der Zeile, damit er sich gegen die Positionssumme aufrechnet.
- Bon-Split-Teilmengen von Modifier-Zeilen werden mit dem Merkmal fachlich möglich
  ([#700](https://github.com/panary/panary-core/issues/700)). Bis dahin bleiben sie gesperrt.
- **Nachdruck von Komponenten-Zeilen:** Deren Modifier-Zeile auf dem Bon zeigte bisher
  `price × amount`, obwohl die Engine (und damit die Positionssumme) schon mit der Zeilenmenge
  skalierte. Über `modifierLineGrossCents` druckt der Bon jetzt den skalierten Betrag mit „je“.
  Positions- und Gesamtsumme bleiben bitgenau. Es ändert sich nur die Modifier-Zeile, die sich
  vorher nicht aufrechnete.
- **Verlauf und aktive Bestellungen** zeigen dieselbe Zahl. Ein alter OHNE-Marker
  (`amount −1`) erscheint im Verlauf jetzt mit 0 € statt mit negativem Betrag, wie in der Engine.
- Die TSE signiert nur Beträge. Gespeicherte Signaturen bleiben gültig, weil gespeicherte
  Bestellungen ohne Merkmal nicht anders rechnen.
