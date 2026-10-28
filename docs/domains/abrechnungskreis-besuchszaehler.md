---
type: Domain Concept
title: 'Abrechnungskreis mit Besuchszähler — `<Tisch>#<n>` und der Riegel am Edge'
description: 'Wie der Abrechnungskreis eines Tisches entsteht (`<Label>#<n>` je Tisch und Geschäftstag), wann ein Besuch offen ist, wie der Edge eine Bestellung für einen geschlossenen Besuch dem nächsten zuordnet und im Journal vermerkt, was der POS offline rechnet und welche Grenzen bewusst bleiben.'
tags: [orders, fiskalisierung, dsfinv-k, pos, edge]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-28T14:00:00Z }
---

# Abrechnungskreis mit Besuchszähler

Der Abrechnungskreis (`order.settlementScope`, DSFinV-K `ABRECHNUNGSKREIS`) klammert alle
Bestellungen eines Tisches. Seit [#1139](https://github.com/panary/panary-core/issues/1139)
trennt ein **Besuchszähler** die Gästegruppen, die nacheinander am selben Tisch sitzen:
`4#1`, `4#2`, … Entscheidung und Begründung:
[ADR 0063](../adr/0063-nachbestellung-als-neue-bestellung-im-abrechnungskreis.md) Nr. 2 und 4,
Vorgänger [ADR 0047](../adr/0047-abrechnungskreis-als-pflichtfeld.md).

## Regeln

| Lage | Kreis |
|---|---|
| Tisch ohne Bestellung am Geschäftstag | `<Label>#1` |
| Tisch hat einen offenen Besuch | dieser Besuch (bei mehreren der höchste) |
| alle Besuche des Tisches geschlossen | höchstes `n` + 1 |
| `<Label>#<n>` länger als 50 Zeichen | synthetisch `auto:…`, Log `order.settlement_scope_fallback` (`reason: visit_scope_too_long`) |
| ohne Tisch | synthetisch `auto:…` je Bestellung, wie bisher |

**Offen** ist ein Besuch, solange eine seiner Bestellungen `active`, `production` oder
`produced` ist. `completed`, `aborted` und `unclaimed` schließen ihn. Der Zustand wird immer
aus den Bestellungen gelesen (`isSettlementScopeOpen`), nie gespeichert.

Der Zähler läuft je Tisch **und Geschäftstag**: Am nächsten Tag beginnt Tisch 4 wieder bei `4#1`.

## Wo gerechnet wird

Eine Funktion, drei Stellen: `visitSettlementScope()` und `deriveSettlementScope()` in
`libs/domains/orders/domain/src/lib/settlement-scope.ts`.

- **Edge** (`apps/api-edge/src/hooks/assign-settlement-scope.hook.ts`, `before.create`): liest
  die Bestellungen des Tisches am Geschäftstag über die Adapter-API (intern, mit Mandant,
  Standort und Geschäftstag) und leitet daraus ab.
- **POS offline** (`order.service.ts`, `#enqueueOfflineOrder`): rechnet mit den Bestellungen,
  die die Kasse kennt. Online schickt der POS keinen Kreis, der Edge stempelt.
- **Cloud**: liest nur, rechnet nicht.

## Der Riegel: geschlossener Besuch → nächster Besuch

Bringt eine Bestellung den Kreis `4#1` mit, und `4#1` ist am Edge geschlossen (eine Kasse ohne
Verbindung hat nachbestellt, während eine andere kassiert hat), dann

1. landet sie im nächsten Besuch (`4#2`, oder im schon offenen Folgebesuch),
2. schreibt der Edge die Logzeile `order.settlement_scope_reassigned` mit beiden Kreisen,
3. legt `createOrderInteractions()` nach dem Anlegen einen Journal-Eintrag
   `settlement-scope-reassigned` an. Bediener ist `creationContext.createdBy`, sofern er zum
   Mandanten der Bestellung gehört; sonst gibt es nur die Logzeile (ADR 0048: ohne Bediener kein
   Eintrag).

Abgelehnt wird nie: Die Bestellung ist bei Ankunft schon produziert, und eine Ablehnung am
Outbox-Push wäre endgültig und unbemerkt.

Ein mitgeschickter Kreis gilt unverändert, wenn er

- keinen Besuchsteil hat (alter Client: das Label allein, „Besuch 0"; oder `auto:…`),
- dem Edge noch unbekannt ist (eine zweite Kasse hat den Besuch gerade eröffnet),
- offen ist,
- oder die Kreise nicht lesbar sind (Log `order.settlement_scope_lookup_failed`, fail-open).

Eine Teilbestellung aus `orders.split` erbt den Kreis ihrer Quelle immer, auch einen geschlossenen
(Server-Schalter `params.inheritSettlementScope`, ADR 0049): Der Split ist eine Umbuchung innerhalb
des Kreises, kein neuer Besuch.

## Release-Reihenfolge

Der Journal-Typ `settlement-scope-reassigned` ist ein neuer Enum-Wert auf einem
synchronisierten Datensatz. Bis die Cloud den Pin auf `@panary/order-interactions` hochzieht
und `api-cloud` ausgerollt ist, lehnt sie **genau diese Einträge** TERMINAL ab; die übrigen
Journal-Einträge und die Bestellung selbst sind nicht betroffen. Bewusst ohne neue Felder:
Neue Spalten reisten als `null` mit **jedem** Journal-Eintrag zur Cloud und würden dort alle
ablehnen. Die beiden Kreise stehen deshalb nur in der Logzeile.

## Grenzen

- **Tischverlegung.** Der Edge sucht die Besuche über `table`. Eine verlegte Bestellung
  behält ihren Kreis (`9#1` an Tisch 10) und zählt für Tisch 9 nicht mehr. Die Verlegung ist
  ein eigenes Vorhaben (ADR 0063, Konsequenzen).
- **Label mit `#<Zahl>`.** `Bar#2` ergibt `Bar#2#1` und wird richtig zerlegt. Nur ein
  Bestandskreis eines alten Clients mit genau diesem Label ließe sich als Besuch lesen; er
  zählt nicht, weil die Suche nach dem Tisch geht.
- **Bestandsdaten** bleiben ohne Besuchsteil, nichts wird umgeschrieben (GoBD Rz. 108).
- Ob `<Label>#<n>` einem Prüfer als „eindeutige Identifikation" genügt, entscheidet der
  Steuerberater (ADR 0063, „Nicht entschieden").
