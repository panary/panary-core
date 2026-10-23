---
type: Domain Concept
title: POS-Bezahlansicht — Bar kassieren im Kassenbetrieb
description: Wie die Kasse im Kassenbetrieb nach „Bezahlen" eine Bezahlansicht zeigt (nur Bar, Rückgeld nur Anzeige, Karte/Gutschein „bald"), wann sie erscheint und wie Fehler und „Offen lassen" laufen.
tags: [orders, pos, payment]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-22T15:00:00Z }
---

# POS-Bezahlansicht

Seit [core#831](https://github.com/panary/panary-core/issues/831). Entscheidung und Begründung:
[ADR 0060](../adr/0060-bezahlansicht-dockt-an-place-order-und-pay-cash-an.md).

## Wann sie erscheint

Die Primärtaste heißt „Bezahlen" und führt nach den Abschluss-Schritten (Vor Ort/Mitnehmen, Pager, Tisch) in
die Bezahlansicht, wenn **alle** gelten:

- Die Filiale hat nicht `operationMode: 'orders-only'` (Kassenbetrieb).
- Der Kanal ist **Kasse** (Telefonbestellungen werden bei Abholung bezahlt).
- Die Bestellung ist kein Personalessen und hat keinen Firmenkunden.
- Ein Kassierer ist ermittelbar (angemeldeter Mitarbeiter, sonst Auth-User).
- Kein Personalessen-Rabatt ist gewählt (auch der Rabatt „Personalessen" zählt als Personalessen).

Sonst heißt die Taste „Bestellen" und alles läuft wie vorher.

## Ablauf

1. `placeOrder` legt die Bestellung mit **vorab vergebener ID** an. Der Druckdialog öffnet wie bisher direkt nach
   dem Anlegen, also vor der Bezahlansicht (F1). Scheitert das Anlegen, bleiben die Positionen stehen.
2. Die Bezahlansicht ist ein Sheet über Raster und Ziffernleiste (wie [Anpassen](pos-anpassen-panel.md), seit core#909). Primärtaste,
   Ziffernleiste, Gruppenleiste und „Übersicht" sind gesperrt, ein Tipp auf den Scrim tut nichts.
3. **Gegeben** wird von rechts eingegeben (5, 0, 0 → 5,00 €), dazu „Passend" und die nächsten runden Scheine.
   **Rückgeld** ist reine Anzeige (F2) und wird nicht gebucht.
4. **Bar kassieren** ist erst frei, wenn der Betrag die Summe deckt. Es ruft `OrderCheckoutService.payCash`: eine
   Bar-Transaktion über die ganze Summe, Status `COMPLETED`, `performedBy` = Kassierer. Fehlt die offene Kasse
   (`BD_6004`), erscheint die Manager-PIN-Freigabe und der Abschluss wird einmal wiederholt
   (`promptCashSessionAuthorization`, derselbe Dialog wie in „Offene Bestellungen").
5. **Offen lassen** schließt die Ansicht ohne Zahlung; die Bestellung steht in „Offene Bestellungen".

Karte und Gutschein sind sichtbar, aber nicht antippbar („bald").

## Zweiter Einstieg: Abschließen in Offene Bestellungen

Seit [core#834](https://github.com/panary/panary-core/issues/834). Im Kassenbetrieb
(`operationMode !== 'orders-only'`) öffnet „Abschließen" an einer offenen Bestellung dieselbe Ansicht als Dialog
(`CashPaymentDialogComponent`, Betrag = Summe der Bestellung) statt sofort fest Bar zu kassieren. „Bar kassieren"
ruft `OrderCheckoutService.payCash` (inkl. Manager-PIN-Freigabe bei `BD_6004`), „Offen lassen" schließt den
Dialog, die Bestellung bleibt offen. Der Bestellbetrieb schließt wie vorher ohne Zahlung ab. Es gibt bewusst
keine Navigation: Der Warenkorb der Kasse bleibt unberührt.

## Fehlerfälle

| Fall | Ergebnis |
| --- | --- |
| Anlegen scheitert | keine Bezahlansicht, Warenkorb bleibt |
| Kassieren scheitert (Server lehnt ab) | Ansicht bleibt, `handleError` hat gemeldet, neuer Versuch möglich |
| Kassen-Freigabe verweigert | Snackbar „Kasse nicht freigegeben", Ansicht bleibt, Bestellung bleibt offen |
| Abbruch nach dem Anlegen, vor dem Kassieren (Netz, Neustart) | offene Bestellung in „Offene Bestellungen" |
| Zwei schnelle Tipps auf INNEN/Sofort | genau eine Bestellung (`placing` sperrt, bis das Anlegen fertig ist) |
| Anlegen scheitert nach Code-Einlösung, zweiter Versuch | dieselbe Einlösung und ID, der Code wird nicht doppelt verbraucht |

## Code

`libs/domains/orders/feature-pos-order-dialog/src/lib/{cash-payment.ts, cash-payment.component.*}`, Verdrahtung in
`order-dialog.component.ts` (`paysAtCounter`, `payment`, `onCollect`, `onKeepOpen`); Kern in
`libs/domains/orders/data-access/src/lib/services/order-checkout.service.ts`.
