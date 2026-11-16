---
type: ADR
title: 'Die Steuer-Konfiguration eines Menüs wird nach sieben festen Regeln geprüft'
description: 'Eine reine Funktion in `@panary/products/domain` prüft ein Menü nach sieben festen Regeln gegen die Rechnung der Kasse und liefert Befunde mit stabilem Code, Schwere und Empfehlungsschlüssel. Die Erkennung von Beilage und Getränk am Gruppennamen steht an einer Stelle und wird von Kasse und Prüfung gemeinsam genutzt.'
tags: [products, orders, pricing, tax, menue]
status: stable
decision: accepted
generated: { by: claude-code/sonnet-5.5, at: 2026-11-16T00:00:00Z }
---

# ADR 0072 — Menü-Steuerregeln als feste Prüfung

> **Entschieden am 2026-11-15** von Michael (Anker panary/panary-core#1445, Unter-Issue panary/panary-core#1455). Regeln und
> Schwere bestätigt: Regeln 1, 2, 3, 5 und 6 als Warnung, Regeln 4 und 7 als Hinweis. Keine Regel sperrt das Speichern.

## Problem

Ob ein Menü steuerlich richtig gebucht wird, hängt an seiner Konfiguration im Katalog. Eine falsche Konfiguration
fiel nirgends auf: Ein Getränk mit eigenem Steuersatz, das als Extra statt als Getränk gebucht wird, läuft mit seinem
Preis still zum Satz des Menüs. Die Zuordnung steht dabei allein am Namen der Auswahlgruppe, an zwei Stellen mit
leicht unterschiedlicher Schreibweise (`selectOptionGroupItem` ohne „getraenk“, `roleFromGroupName` mit).

## Entscheidung

1. **Eine reine Funktion `checkMenuTax`** (`libs/domains/products/domain/src/lib/menu-tax-check.ts`) liefert je Befund
   `rule`, einen stabilen `code`, die Schwere, `groupId`/`productId` und einen Empfehlungsschlüssel. Sie enthält keinen Text
   und keine Seiteneffekte; Wortlaut und Anzeige gehören den Aufrufern (Edge-Admin, Cloud-Katalog). Eingabe sind das Menü,
   ein Auflöser für Options-Produkte und die Steuersätze der Filiale.
2. **Die Regeln beschreiben die Rechnung der Kasse**, nicht das Steuerrecht. Verglichen werden die **wirksamen** Sätze,
   also nach dem Ersatz, den die Kasse macht (`taxInside || 19`, `taxOutside || 7`). Feste gesetzliche Sätze stehen nicht
   in den Regeln, die Sätze der Filiale sind die Quelle.
3. **Eine Erkennung für Beilage und Getränk:** `menuOptionGroupSlot(name)` in `@panary/products/domain` bildet das
   Verhalten von `selectOptionGroupItem` exakt nach (`beilage`/`side`, `getränk`/`drink`, Beilage vor Getränk, ohne
   „getraenk“). Die Kasse ruft sie auf, Regel 1 benutzt sie, ein Spec hält die Gleichheit mit dem bisherigen Ausdruck fest.
   `roleFromGroupName` bleibt unverändert.

| Regel | Code | Schwere | Trifft, wenn |
|---|---|---|---|
| 1 | `EXTRA_GROUP_RATE_DIFFERS` | Warnung | Eine Gruppe, die die Kasse als Extra bucht, enthält eine Option mit Preis über 0, deren wirksamer Satz (im Haus oder außer Haus) vom Menü abweicht. Gilt in beiden Preismodi: Ein Extra läuft immer zum Satz der Zeile. |
| 2 | `OPTION_WITHOUT_PRICE_OTHER_RATE` | Warnung | Ein Options-Produkt mit abweichendem wirksamem Satz hat den Preis 0. Sein Satz bekommt keinen Anteil am Menü. |
| 3 | `MAIN_WITHOUT_SHARE` | Warnung | Festpreis-Menü: `mainPrice` ist 0, oder fehlt und die teuerste wählbare Kombination erreicht den Festpreis. Das Hauptgericht bekommt keinen Anteil. |
| 4 | `MAIN_PRICE_MISSING` | Hinweis | Festpreis-Menü ohne `mainPrice`, Regel 3 trifft nicht. Der Nachlass liegt ganz auf dem Hauptgericht. Regel 3 und 4 erscheinen nie zusammen. |
| 5 | `RATE_NOT_IN_LOCATION` | Warnung | Ein wirksamer Satz des Menüs oder einer Option kommt in den Steuersätzen der Filiale nicht vor. Entfällt ohne Filialsätze. |
| 6 | `RATE_MISSING_OR_ZERO` | Warnung | Am Menü oder an einer Option fehlt ein Satz oder er steht auf 0. Die Kasse rechnet dann mit 19 % im Haus bzw. 7 % außer Haus. |
| 7 | `OPTION_UNRESOLVED` | Hinweis | Ein Options-Produkt ist nicht auflösbar. Die Option wurde nicht geprüft. |

**Regel 1 nach core#1450.** Beilage- und Getränkegruppen bucht die Kasse seitdem in beiden Preismodi als Komponente mit
eigenem Satz, auch ohne Festpreis. Sie sind damit in Ordnung, und Regel 1 trifft nur Gruppen, die die Kasse als Extra
bucht. Für diese ist der Satz des Menüs maßgeblich, ob mit oder ohne Festpreis. Empfehlung bei einer Pflichtgruppe mit einer
Wahl: Gruppe als Beilage oder Getränk führen (`GROUP_AS_SIDE_OR_DRINK`). Bei `maxSelections > 1`, `freeQuantity > 0`,
`pricingMode: HIGHEST` oder optionaler Gruppe: Option in eine eigene Beilagen- oder Getränkegruppe legen
(`MOVE_OPTION_TO_OWN_SIDE_OR_DRINK_GROUP`), weil die Kasse eine Beilage oder ein Getränk in einen einzigen, überschreibenden
Platz bucht und Freimenge und Mehrfachwahl dort nicht greifen.

**Teuerste wählbare Kombination (Regel 3)** wird gebildet wie die Summe in `fixedBundleMainWeight`: über alle Gruppen
einschließlich Extras und Untergruppen eines Options-Produkts, je Gruppe die `maxSelections` teuersten Optionen. Preis ist
der `price` des Options-Produkts, weil die Kasse nur den liest.

## Konsequenzen

- Die Funktion ist fest verdrahtet und deterministisch. Die Anzeige im Edge-Admin steht seit panary/panary-core#1456,
  im Cloud-Katalog kommt sie mit panary/panary-cloud#2095, #2096; die Cloud bekommt die Funktion erst mit einem core-Release und Pin-Bump.
- Die Regeln erkennen **nicht**, ob ein Produkt den richtigen Satz trägt oder die Aufteilung nach Einzelpreisen für den
  Betrieb die richtige Methode ist. Das klärt die Steuerberatung des Betriebs.
- **Nicht Teil der Regeln:** Zwei Beilagen- oder zwei Getränkegruppen im selben Menü. Der Legacy-Slot hält nur die letzte
  Wahl, die Komponenten (seit core#1450) halten je Gruppe eine, der Betrag liegt dann über dem des Slots. Eine achte Regel
  dafür braucht die Bestätigung von Michael.
- „Getraenk“ ohne Umlaut erkennt die Kasse beim Buchen nicht, `roleFromGroupName` schon. Die Kasse anzugleichen würde
  Gruppen vom Extra in den Getränke-Platz verschieben (Freimenge, Mehrfachwahl und Preise ändern sich) und ist eine eigene
  Entscheidung. Bis dahin meldet Regel 1 solche Gruppen zu Recht.
- Die Zuordnung über den Gruppennamen bleibt fragil. Eine ausdrückliche Rolle an der Auswahlgruppe wäre die saubere Lösung,
  ist aber eine Schema-Änderung am Katalog.

Verwandt: [ADR 0004](0004-order-bundle-pricing-modell.md) (Preis-/Steuer-Engine), [ADR 0071](0071-menue-aufschlag-wird-beim-buchen-festgeschrieben.md).
