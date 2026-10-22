---
type: ADR
title: Bezahlansicht dockt an placeOrder und payCash an
description: Warum die Bezahlansicht der Kasse die Bestellung zuerst anlegt (placeOrder mit vorab vergebener ID) und dann über OrderCheckoutService.payCash bar abschließt, statt Bestellung und Zahlung in einem Schritt zu bauen.
tags: [orders, pos, payment, ux]
status: stable
decision: accepted
generated: { by: claude-code/sonnet-5.5, at: 2026-10-22T15:00:00Z }
---

# Bezahlansicht dockt an placeOrder und payCash an

## Problem

Im Kassenbetrieb wurde an der Kasse nur bestellt; kassiert wurde in „Offene Bestellungen"
(`finalizeOrder`). Der neue Kassenbildschirm (Anker panary/panary-core#819, Entscheidung 5) soll an der
Theke direkt in eine Bezahlansicht führen — nur Bar, Karte und Gutschein sichtbar „bald". Dabei dürfen der
Druckdialog (F1), die Kassen-Freigabe bei fehlender offener Kasse (`BD_6004`) und das Verhalten im
Bestellbetrieb nicht ändern, und Zahlungslogik darf nicht an zwei Stellen unterschiedlich laufen.

## Entscheidung

1. **Erst bestellen, dann kassieren.** `placeOrder` legt die Bestellung wie bisher an, im Kassenbetrieb mit
   **vorab vergebener `_id`** (derselbe Weg wie beim Rabattcode). Der Druckdialog öffnet im `OrderService` direkt
   nach dem Anlegen, also vor der Bezahlansicht. Danach zeigt die Kasse die Bezahlansicht; „Bar kassieren"
   patcht Payment und Status über `payCash` auf diese ID.
2. **Ein Kern für beide Wege.** `OrderCheckoutService.payCash(input: PayCashInput)` (`orderId`, `total`, `cashierId`, `requestCashSession`) ist
   der unveränderte Kern aus „Offene Bestellungen": eine Bar-Transaktion über die ganze Summe, Status und
   Payment in einem Patch, bei `BD_6004` die Manager-PIN-Freigabe und genau ein Wiederholungsversuch. Die
   Freigabe kommt als Funktion hinein (`promptCashSessionAuthorization`), damit die Data-Access-Lib keine
   Feature-Lib kennt.
3. **Nur dort, wo an der Theke bezahlt wird.** „Bezahlen" erscheint, wenn die Filiale nicht `orders-only` ist
   (gleiche Quelle wie `finalizeOrder`), der Kanal Kasse ist und die Bestellung weder Personalessen noch
   Firmenkunde ist. Alles andere läuft den bisherigen Weg.
4. **„Offen lassen" ist der heutige Weg.** Die Bestellung ist dann angelegt und wird später in „Offene Bestellungen"
   abgeschlossen.
5. **Rückgeld ist nur Anzeige (F2).** Es wird nicht gebucht; die Transaktion trägt immer die Summe.

## Konsequenzen

- Scheitert das Kassieren nach dem Anlegen (Netz, abgelehnte Freigabe), steht eine **offene** Bestellung in
  „Offene Bestellungen" — sichtbar und auffindbar, nicht verloren. Das ist gewollt; der Gegenentwurf (eine
  gemeinsame Transaktion von Bestellung und Zahlung) bräuchte eine Server-Änderung und würde TSE-Signatur und
  Offline-Outbox berühren.
- **Anlegen ist einmalig.** Im Bezahl-Fall bleibt der Warenkorb über den Server-Roundtrip stehen; `placing`
  sperrt Primärtaste, Ziffern, Gruppenleiste und „Übersicht", und ein zweiter `placeOrder`-Aufruf kehrt zurück —
  sonst entstünde bei zwei schnellen Tipps eine zweite Bestellung. Scheitert das Anlegen mit eingelöstem
  Rabattcode, merkt sich der Dialog Einlösung und ID (`#redeemedForRetry`): Der nächste Versuch löst nicht
  erneut ein.
- Personalessen — auch über den Rabatt „Personalessen" — und Firmenkunden bekommen keine Bezahlansicht: Bei
  einem Personalessen speichert `placeOrder` nur diesen Rabatt, die Summe der Vorschau stimmte nicht mit der
  Bestellung überein.
- Bei verlorener Antwort des ersten Patches (Server hat abgeschlossen, Client sieht einen Fehler) sendet ein
  zweiter Versuch eine neue Transaktions-ID und einen neuen Zeitstempel. Der Patch ersetzt `payment`, es gibt keine
  Doppelbuchung, aber die erste ID geht in der Audit-Spur verloren. Bewusst offen.
- Der Betrag der Zahlung ist die Summe auf der Primärtaste (mit Rabattvorschau). Weicht die vom Server berechnete
  Summe je ab, ist das ein eigener Befund.
- Die Bezahlansicht ist Anzeige und Eingabe; kassiert wird nur über `payCash`. Karten und Gutscheine sind nicht
  antippbar, bis sie ein eigenes Issue bekommen.
- Betriebsart-Wechsel mitten am Tag: Die Kasse zeigt sofort „Bezahlen", der Edge-Guard verlangt die offene Kasse
  erst ab dem Tages-Snapshot des nächsten Tages (siehe Issue-Risiko, panary/panary-core#831).
