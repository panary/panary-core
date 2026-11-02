---
type: Domain Concept
title: 'Nachbestellung im Abrechnungskreis — aus „Offen“ in die Kasse, Referenz auf die erste Bestellung'
description: 'Wie „Nachbestellen“ an einer offenen Tisch-Bestellung die Kasse mit Tisch und Kreis vorbelegt, warum die Abschlusskette den Tisch dann nicht fragt, wie der Edge die Referenz `Transaktion` auf die erste Bestellung des Kreises schreibt und woran der Küchenbon die Nachbestellung zeigt.'
tags: [orders, pos, edge, fiskalisierung, dsfinv-k, druck]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-02T21:15:00Z }
---

# Nachbestellung im Abrechnungskreis

Ein Gast bestellt nach. Die Nachbestellung ist eine **neue Bestellung** im Abrechnungskreis des
Tisches, nie eine Erweiterung der bestehenden
([ADR 0063](../adr/0063-nachbestellung-als-neue-bestellung-im-abrechnungskreis.md) Nr. 1, 6, 7;
umgesetzt in [#1140](https://github.com/panary/panary-core/issues/1140)). Wie der Kreis selbst
entsteht und wann er schließt: [Abrechnungskreis mit Besuchszähler](abrechnungskreis-besuchszaehler.md).

## Ablauf an der Kasse

1. **Einstieg in „Offen“.** „Nachbestellen“ steht an der Kreis-Karte (über der Karte, neben dem
   späteren „Tisch kassieren“) und im Aktionsmenü einer Einzelkarte. Die erste Nachbestellung startet
   immer von einer Einzelkarte, denn eine Kreis-Karte gibt es erst ab zwei offenen Bestellungen.
2. **Nur mit Tisch.** Ohne Tisch oder mit synthetischem Kreis (`auto:…`) fehlt die Aktion: Es gibt
   keinen Kreis, an den sich anhängen ließe. Die Regel steht einmal, in `kasseReorderFor()`
   (`libs/domains/orders/domain/src/lib/reorder.ts`).
3. **Vorbelegung.** Die Liste navigiert nach `/kasse` und gibt `{ table, settlementScope }` im
   **Navigations-State** mit (Schlüssel `KASSE_REORDER_STATE_KEY`). Nicht in der URL: Ein Neuladen
   der Kasse soll keinen Tisch wiederbeleben. `KassePageComponent` reicht die Vorbelegung nur an die
   **erste** Bestellung der Kasse weiter; bleibt man nach dem Abschicken in der Kasse, ist die nächste
   Bestellung wieder eine gewöhnliche.
4. **Im Bestelldialog** zeigt eine Zeile über dem Raster „Nachbestellung · Tisch 4“. Die Abschlusskette
   (`closing-flow.ts`, `tablePreset`) fragt den Tisch nicht: Nach dem Pager geht es direkt zur
   Fertigungszeit bzw. bei „Im Haus“ direkt zum Abschicken. Eingriff in `order-dialog.component.ts`
   ist nur ein `input()` und das Setzen von `_table`, wie ADR 0011 es verlangt.
5. **Außer Haus** bleibt die Nachbestellung am Tisch und im Kreis. Der Gast zahlt sie mit dem Tisch;
   ohne Vorbelegung leert „Außer Haus“ den Tisch wie bisher.
6. **Abschicken.** `OrderService.createOrder` schickt den Kreis mit (`settlementScope`), online wie
   offline. Am Edge übernimmt `assignSettlementScope()` ihn, solange der Besuch offen ist. Hat eine
   andere Kasse den Tisch inzwischen kassiert, ordnet der Edge die Bestellung dem nächsten Besuch zu
   (Riegel, ADR 0063 Nr. 2).

Warum der Kreis mitreist und nicht nur der Tisch: Für einen alten Kreis ohne Besuchsteil (`4`, von
einer Kasse vor #1139) leitete der Edge aus `table` allein einen neuen Kreis `4#1` ab, und die
Nachbestellung landete außerhalb.

## Die Referenz `Transaktion`

`recordFollowUpReference()` (`apps/api-edge/src/hooks/record-follow-up-reference.hook.ts`,
`after.create` der Orders) schreibt die Vorgangs-Referenz (DSFinV-K `Bon_Referenzen`):

| Feld | Wert |
|---|---|
| `refType` | `Transaktion` (es kommt etwas hinzu, nichts wandert) |
| `sourceOrderId` | die **erste** Bestellung des Kreises (früheste `recordingDate`, bei Gleichstand kleinere ID) |
| `targetOrderId` | die Nachbestellung |
| `refDate`, `refLocationId`, `refBusinessDayId` | Kopien der ersten Bestellung |

Erkannt wird die Nachbestellung **am Kreis**, nicht an einem Merkmal der Kasse: Hat der Kreis am
Geschäftstag schon eine frühere Bestellung, ist die neue eine Nachbestellung. So zählen auch eine
offline aufgenommene Bestellung und eine, bei der der Bediener den Tisch von Hand gewählt hat. Ein
eigenes Feld an `orders` wäre ein neues synchronisiertes Feld und würde bis zum Cloud-Pin-Bump
TERMINAL abgelehnt (ADR 0047). Der Enum-Wert `Transaktion` dagegen existiert in
`@panary/order-references` seit #385; die Cloud kennt ihn.

Keine Referenz bekommen:

- die **erste** Bestellung eines Kreises, auch eine, die der Edge einem neuen Besuch zugeordnet hat,
- eine **Teilbestellung aus dem Split** (`params.inheritSettlementScope`): Sie trägt `Split` (ADR 0049),
- per **Sync** angekommene Bestellungen (`params.fromSync`): Die Referenz reist selbst,
- Bestellungen mit synthetischem Kreis oder ohne Geschäftstag (Standalone ohne Tag): Ein Kreis `4`
  wäre dort nicht vom Vortag zu trennen.

Der Hook ist **awaited und nie blockierend** wie Storno- und Split-Referenz: Ein Fehler steht im Log
(`order.follow_up_reference_failed`), die Bestellung steht trotzdem. Awaited, weil der POS direkt
nach dem Anlegen `/print-order` aufruft und der Bon die Referenz liest.

## Küchenbon

`/print-order` (`print-server.router.ts`) fragt `order-references` nach `targetOrderId` und
`refType: Transaktion` und reicht `followUp` an `renderOrderReceipt`. Statt „Tisch: 4“ steht dann
**„Nachbestellung · Tisch 4“** im Kopf, auf Küchen- und Vollbon. Doppelte Breite nur, solange die
Zeile passt; sonst einfache Breite statt Umbruch. Der Bon enthält wie jeder Bestellbon nur die
Positionen der neuen Bestellung. Fällt die Abfrage aus, druckt der Bon ohne Kennzeichnung
(`print.order_follow_up_lookup_failed`).

## Grenzen

- **Zwei Kassen, ein Besuch.** Beide sehen denselben Kreis und bekommen beide eine Referenz auf
  dieselbe erste Bestellung. Das ist richtig, es ist derselbe Besuch.
- **Spät ankommende Offline-Bestellung, die früher aufgenommen wurde.** Sie ist dann selbst die
  früheste und bekommt keine Referenz; die schon geschriebenen Referenzen zeigen weiter auf die
  bisherige erste. Referenzen sind append-only (ADR 0048) und werden nicht umgeschrieben.
- **Kassenbetrieb.** Die Nachbestellung führt wie jede Barbestellung in die Bezahlansicht;
  „Offen lassen“ hält sie für den Tisch offen. Ein Zahlablauf über den ganzen Kreis ist
  [#1142](https://github.com/panary/panary-core/issues/1142).
