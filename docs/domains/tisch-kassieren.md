---
type: Domain Concept
title: 'Tisch kassieren — ein Zahlablauf über alle offenen Bestellungen eines Kreises'
description: 'Wie „Tisch kassieren“ an der Kreis-Karte alle offenen Bestellungen eines Abrechnungskreises in einem Bezahlvorgang abschließt, je Bestellung mit eigenem Beleg, warum der Ablauf je Bestellung idempotent ist, was nach einem Abbruch passiert und was bewusst fehlt.'
tags: [orders, pos, receipts, fiskalisierung, dsfinv-k]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-02T22:30:00Z }
---

# Tisch kassieren

Ein Tisch hat nach Nachbestellungen mehrere offene Bestellungen in einem Abrechnungskreis. Der Gast
will einmal zahlen. „Tisch kassieren“ an der Kreis-Karte in „Offen“ schließt alle offenen
Bestellungen des Kreises in **einem Bezahlvorgang** ab, mit **je Bestellung einem Beleg**
([ADR 0063](../adr/0063-nachbestellung-als-neue-bestellung-im-abrechnungskreis.md) Nr. 5,
umgesetzt in [#1142](https://github.com/panary/panary-core/issues/1142)). Der Sammelbeleg über
alle Bestellungen wartet auf die TSE-Anbindung
([#1143](https://github.com/panary/panary-core/issues/1143), [#351](https://github.com/panary/panary-core/issues/351)).
Wie der Kreis entsteht: [Abrechnungskreis mit Besuchszähler](abrechnungskreis-besuchszaehler.md),
wie Nachbestellungen hineinkommen: [Nachbestellung im Abrechnungskreis](nachbestellung-im-abrechnungskreis.md).

## Ablauf

1. **Taste.** Über der Kreis-Karte stehen „Nachbestellen“ und „Tisch kassieren“ (im Bestellbetrieb
   `orders-only`: „Tisch abschließen“). Die Kreis-Karte gibt es ab zwei offenen Bestellungen; eine
   einzelne Bestellung kassiert man wie bisher über „Abschließen“.
2. **Zahlliste.** `tableCheckoutPlan()` (`libs/domains/orders/domain/src/lib/open-order-groups.ts`)
   nimmt die offenen Bestellungen der Karte, die älteste zuerst, je mit ihrem Betrag in Cent aus
   derselben Engine wie die Einzelkarte. Die Summe für den Gast ist die Cent-Summe genau dieser
   Beträge, und dieselben Beträge gehen je Bestellung in die Zahlung. So weichen Anzeige und Buchung
   nie um einen Cent voneinander ab.
3. **Bezahlansicht.** Dieselbe Ansicht wie beim Abschließen
   ([POS-Bezahlansicht](pos-bezahlansicht.md)), mit „Tisch 4 · 2 Bestellungen“ im Kopf und der
   Kreis-Summe als Betrag. Rückgeld bezieht sich auf die Summe.
4. **Kassieren.** `OrderCheckoutService.payCashCircle()` ruft **der Reihe nach** je Bestellung
   `payCash()` auf: ein Patch mit Bar-Zahlung und `completed`, am Edge TSE-Finish und Beleg wie bei
   jeder einzelnen Bestellung (`issue-receipt.hook.ts`). Die erste Bestellung löst die Freigaben aus
   (Kasse eröffnen, Ruhetag). Beide liegen danach am Geschäftstag, die übrigen Bestellungen laufen
   ohne Rückfrage durch.
5. **Bestellbetrieb.** Ohne Kassierfunktion schließt die Taste die Bestellungen nur ab
   (`complete()` je Bestellung), wie „Abschließen“ an der Einzelkarte.

## Idempotent je Bestellung, nicht je Kreis

Vor jedem Kassieren liest `payCashCircle()` die Bestellung **frisch** und überspringt sie, wenn sie
nicht mehr offen ist (z. B. an einer zweiten Kasse kassiert). Grund: Der Edge lässt einen Patch auf
eine schon abgeschlossene Bestellung durch und überschriebe deren Zahlung samt Kassierer
([#1300](https://github.com/panary/panary-core/issues/1300)). Lässt sich eine Bestellung nicht
lesen, hält der Ablauf an, statt blind zu buchen.

## Abbruch und Wiederaufnahme

Der Ablauf hält bei der ersten Bestellung an, die nicht bezahlt wird (Kasse nicht freigegeben,
Ruhetag abgelehnt, Server-Fehler, Verbindung weg).

- **Noch nichts gebucht:** Die Ansicht bleibt offen, wie bei einer einzelnen Bestellung.
- **Schon ein Teil gebucht:** Die Ansicht schließt, und eine quittierpflichtige Meldung nennt
  „x von n kassiert“ und den **nicht gebuchten Betrag**. Der Gast hat für alles gezahlt, der
  Kassierer muss den Rest nachbuchen.
- Die gebuchten Bestellungen sind `completed` und verschwinden aus „Offen“. Die Kreis-Karte zeigt den
  gezahlten Teil („1 bereits kassiert“, `settledOrdersInCircle()`: nur `completed`, gleicher Kreis,
  gleicher Geschäftstag). Ein zweiter Tipp auf „Tisch kassieren“ kassiert nur den Rest. Bleibt nur
  eine Bestellung offen, wird sie zur Einzelkarte und läuft über „Abschließen“.

## Bewusst nicht enthalten

- **Personalessen im Kreis:** Die Taste fehlt. Personalessen wird über die Abrechnung beglichen, nicht
  an der Theke, und sein Betrag bleibt am Terminal verborgen. Die übrigen Bestellungen schließt man
  einzeln ab.
- **Keine Tisch-Übersicht zum Drucken.** Ein Ausdruck mit Transaktionsnummer und Prüfwert über alle
  Bestellungen wäre ein zweiter Beleg über denselben Umsatz (A13, § 14c UStG). Eine reine Übersicht
  ohne Belegmerkmale ist erlaubt, aber nicht gebaut.
- **Kartenzahlung, Teilzahlung, getrennt zahlen:** nicht Teil dieses Ablaufs (Bon-Split:
  [Bon-Split](bon-split.md)).

## Grenzen

- **Besuch-0-Kreise** (alter Client, Kreis nur das Tisch-Label) zählen im gezahlten Teil alle
  kassierten Bestellungen des Tisches am Geschäftstag, nicht nur die des Besuchs.
- Der gezahlte Teil steht nur an der Kreis-Karte. Ist nach einem Abbruch nur eine Bestellung offen,
  zeigt die Einzelkarte ihn nicht.
- Mehrere Belege für einen Gast sind rechtlich sauber, aber unschöner. Das ändert erst der Sammelbeleg.
