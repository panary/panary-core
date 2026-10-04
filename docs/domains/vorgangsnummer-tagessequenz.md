---
type: Domain Concept
title: Vorgangsnummer je Geschäftstag (dailySequenceNumber)
description: Wie der Edge die Vorgangs- bzw. Abholnummer einer Bestellung vergibt — Zähler je Geschäftstag statt Uhrzeit, prozesslokaler Merker gegen das Rennen bis zum Insert, Teil-Unique-Index ab Migrationszeitpunkt und was das für Bestandsdaten heißt.
tags: [orders, businessdays, receipts, kassensichv]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-04T10:00:00Z }
---

# Vorgangsnummer je Geschäftstag

`order.dailySequenceNumber` ist die große Nummer auf dem POS-Bon, der letzte Teil der
internen Belegnummer `R-<datum>-<loc>-<seq>` (`formatInternalReceiptNumber`) und der
Rückfallwert der TSE-Vorgangsnummer, falls der Fiskal-Zähler ausfällt
(`fallbackTransactionNumber` in `sign-order-tse.hook.ts`). Die Fiskal-Vorgangsnummer
selbst kommt aus dem lückenlosen Fiskal-Zähler (ADR 0005, Punkt 5); die
Belegnummer im Sinne von §6 KassenSichV ist die TSE-Transaktionsnummer (ADR 0007).

## Regel

Innerhalb eines Geschäftstags vergibt der Edge jede Nummer genau einmal, beginnend bei 1:

```
next = max(MAX(dailySequenceNumber) im Geschäftstag, zuletzt vergebene Nummer) + 1
```

- **Schlüssel ist `businessDayId`.** Ein Geschäftstag gehört genau einer Filiale eines
  Mandanten; die Abfrage filtert zusätzlich auf `tenantId`/`locationId`, wenn gestempelt.
- **Mutex + Merker.** Der Hook `assignDailySequenceNumber` (before.create der `orders`)
  läuft unter einem prozessweiten Mutex. Der Mutex endet aber mit dem Hook, der Insert
  folgt erst nach weiteren Hooks. Ohne den Merker `lastAssigned` (zuletzt vergebene
  Nummer je Geschäftstag) lesen zwei parallele Bestellungen dasselbe Maximum. Der Edge
  ist single-process; nach einem Neustart zählt er über dem gespeicherten Maximum weiter.
- **Lücken sind möglich**, wenn ein Create nach dem Hook scheitert (Validierung, Rabatt-
  Regel). Die Nummer ist eine Abholnummer, keine lückenlose Fiskalnummer.

## Erzwungen: Teil-Unique-Index

Migration `20261004100000_orders_daily_sequence_unique` legt
`uq_orders_businessDay_dailySequenceNumber` auf `(businessDayId, dailySequenceNumber)` an —
**nur für Zeilen mit `createdAt` nach dem Migrationslauf**:

- Bestandsdaten können Duplikate tragen (genau das war der Fehler). Ein voller Index
  scheiterte beim Anlegen, der Edge käme nicht hoch. Umschreiben scheidet aus: Die Nummer
  steht auf ausgegebenen Belegen.
- Orders, die ein Bootstrap/Restore später aus der Cloud zurückspielt, tragen ihr altes
  `createdAt` und fallen ebenfalls nicht unter den Index.
- Nicht das Vierer-Tupel mit `tenantId`/`locationId`: SQLite wertet NULL im Unique-Index
  als verschieden, eine Bestellung ohne gestempelte `tenantId` fiele still heraus.

Gefundene Bestands-Duplikate meldet die Migration einmalig als
`migration.orders_daily_sequence_duplicates` (Anzahl Gruppen, Anzahl Orders, bis zu zehn
Beispiele) auf stderr. Ein Duplikat, das trotzdem entsteht, scheitert beim Insert laut
(`UNIQUE constraint failed`, HTTP 500) statt still auf zwei Belegen zu stehen.

Bestandsmessung von Hand:

```sql
SELECT businessDayId, dailySequenceNumber, COUNT(*) n
FROM orders WHERE businessDayId IS NOT NULL
GROUP BY 1, 2 HAVING n > 1 ORDER BY n DESC;
```

## Vorher (bis v26.10.5)

Die Nummer war `"<Minuten><Sekunden>"`, und ein Kollisionszähler zählte die Basis statt
des Kandidaten: Ab der dritten Bestellung derselben Sekunde kam wieder dieselbe Nummer
heraus (gemessen: viermal `9221`). Dazu wiederholte sich der Wert stündlich, und die
Zähl-Query lief ohne Mandanten- und Geschäftstag-Filter über die ganze Tabelle
([panary/panary-core#537](https://github.com/panary/panary-core/issues/537)).

Am ersten Geschäftstag nach dem Update zählt der Edge über dem Maximum des Tages weiter —
über dem höchsten alten Wert, z. B. von `9221` auf `9222`. Ab dem nächsten Geschäftstag beginnt sie bei 1.

## Code

- `apps/api-edge/src/hooks/assign-daily-sequence-number.ts` — Vergabe
- `apps/api-edge/migrations/20261004100000_orders_daily_sequence_unique.ts` — Index + Bestandsmeldung
- `apps/api-edge/test/services/orders/daily-sequence-number.test.ts` — volle Hook-Kette, seriell und parallel
- `apps/api-edge/test/migrations/orders-daily-sequence-unique.spec.ts` — Index gegen echte SQLite
