---
type: Domain Concept
title: Offene Forderungen in der Tagesaggregation
description: Warum offene Personal- und Firmenkundenessen aus dem Bar-Umsatz herausfallen, wie der receivablesCents-Bucket rechnet und was das für Kassen-Soll und Anzeige-Netto bedeutet.
tags: [businessdays, orders, users, corporate-customers]
status: stable
generated: { by: claude-code/opus-5, at: 2026-07-31T10:00:00.000Z }
---

# Offene Forderungen in der Tagesaggregation

Ein angeschriebenes Personal- oder Firmenkundenessen ist eine **Forderung**, kein
Barumsatz. Diese Seite beschreibt, wie der Aggregator das seit Core-Runde 2
abbildet. Der fachliche Rahmen und die Rechtslage stehen im Cloud-Wiki:
[Sammelabrechnung — Umsetzungsplan](../../../panary-cloud/docs/domains/personalessen-abrechnung-plan.md).

---

## 1. Der Bestandsfehler

`finalizeOrder` bucht im `pos-cashier`-Modus für **jede** Bestellung eine
`CASH`-Transaktion über den Rechnungsbetrag — auch für ein Essen, das
angeschrieben wird. Damit floss Geld in `financials.payments.cashCents`, das nie
in der Lade lag.

Folge: Der Kassensturz meldete **schon am Leistungstag** einen Fehlbetrag in Höhe
der offenen Essen. Der Überschuss am Zahltag war nur die zweite Hälfte desselben
Fehlers, nicht ein zweiter Fehler.

---

## 2. Klassifikation mit einer Sicht von außen

Der Abrechnungsstand lebt als eigenes Dokument in der Cloud
(`meal-settlements`); die Bestellung wird **nie** gepatcht — [ADR
0001](../adr/0001-sync-protocol.md) §3 plus der 90-Tage-Backfill des
Edge-Bootstraps. Der Aggregator kann den Stand also nicht aus der Order lesen und
bekommt ihn hereingereicht:

```ts
aggregateFinancials(orders, { settlements: { settledOrderIds } })
```

Drei Zustände, bewusst unterscheidbar:

| Aufruf | Bedeutung |
| --- | --- |
| ohne `settlements` | keine Information — es gilt das Boolean-Verhalten (`isPaid === true`) |
| leere `settledOrderIds` | Information liegt vor, **nichts** ist abgerechnet |
| gefüllte Menge | genau diese Bestellungen sind beglichen |

Die ersten beiden auseinanderzuhalten ist der Punkt: ein vergessener Parameter
darf nicht stillschweigend alles auf „offen" kippen. Das Legacy-Feld `isPaid`
schlägt die View — ein historisch auf `true` gesetzter Bon bleibt abgerechnet,
auch ohne Beleg.

---

## 3. Der Bucket

`PaymentBreakdown.receivablesCents` ist **optional**. Wäre er required, bräche
der Cloud-Typecheck schon im Pin-Bump-Commit, der nur Ranges und Lockfile
enthalten soll. Alt-Berichte ohne das Feld bleiben lesbar; jeder Konsument
rechnet `?? 0`.

> **`PAYMENT_BUCKET_KEYS` iterieren statt aufzählen.** Rund 14 Stellen in Cloud
> und Edge summieren die Buckets von Hand (Z-Bon, DSFinV-K-Export,
> Finanz-Karten). Ein fünfter Bucket bricht dort **nicht am Compiler** — er
> findet sich einfach nicht in der Summe wieder, und die Differenz ist still.

### Wo der Zweig sitzt

In `aggregateFinancials` **nach** den Storno-/Refund-`continue`s (ein stornierter
Bon ist keine Forderung) und **vor** der `tx.method`-Verteilung. Er steuert exakt
`gross − tip` bei, damit die Persist-Invariante `Σ payments === grossTotal −
tips` hält: der Bucket verschiebt nur *innerhalb* der Summe.

---

## 4. Anzeige-Netto — drei Zweige

1. **`receivablesCents` fehlt** → alte Formel unverändert (`cash + card − offene
   Personalessen`). Sonst änderten sich rückwirkend Zahlen in bereits
   abgeschlossenen Berichten.
2. **`orders-only`** → `Σ payments − receivables`. In diesem Modus gibt es keinen
   Kassierpfad; `cash + card` wäre für einen Tag mit Umsatz schlicht 0.
3. **sonst** → `cash + card`. Der Abzug der offenen Personalessen entfällt: sie
   stecken gar nicht mehr in `cashCents`, ihn zu behalten wäre eine **zweite**
   Kürzung.

---

## 5. Kassen-Soll

```
erwarteterEndbestand = Anfangsbestand + Barumsatz + barBeglicheneForderungen
                       − Entnahmen − Auszahlungen
```

Der Forderungs-Term geht mit **Plus** ein: das Geld kommt am Zahltag in die Lade,
während der Umsatz fiskalisch am Leistungstag steht. Das Vorzeichen der
`varianceCents` bleibt unverändert (`expected − counted`) — es hängt an Anzeige
und Auswertung in Cloud und Edge, und wer es dreht, dreht still jede bestehende
Kassendifferenz um.

### Keine Knex-Migration

`cash-sessions` steht in `SyncableTransactionService` als reiner Push
(Edge→Cloud); einen Cloud→Edge-Apply gibt es nicht. Das „no such
column"-Risiko existiert hier also gar nicht. Umgekehrt entstünde eines: der
Outbox-Recorder schickt die volle Knex-Row, und eine noch nicht gepinnte Cloud
lehnte die unbekannte Spalte mit 400 **terminal** ab. Das Feld ist
cloud-abgeleitet — kein Edge liest oder schreibt es.

---

## 6. Der Regressionsbeweis

`settlement-regression.spec.ts` hält einen gemischten Geschäftstag als Golden
Numbers fest. Die Datei entstand **vor** dem Umbau und war auf unverändertem
Produktionscode grün — ein Anker, der danach geschrieben wird, misst nichts.

Bewegt haben sich genau drei Zahlen: `cashCents`, `receivablesCents`,
`displayNetRevenueCents`. Von 143 Aggregator-Tests brachen exakt vier plus die
Anzeige-Netto-Formel; 138 blieben unverändert grün.

Der Erhaltungssatz in einer Zeile:

```
cashCents_alt  ===  cashCents_neu + receivablesCents_neu
      7.850    ===       3.910    +        3.940
```

---

## 7. Was der Cloud-Nachzug noch braucht

Erst nach Core-Release und Pin-Bump:

- `buildAggregationInput` lädt die Settlements des Tages und reicht **dasselbe**
  Options-Objekt an beide Aggregate.
- `aggregate-orders.ts` gibt `operationMode` an die Derive-Funktion.
- `derive-cash-by-cashier.ts` schließt offene Forderungen aus — es ist ein
  **zweiter, unabhängiger** Rechenweg neben dem Z-Bon-Roll-up. Eine Korrektur
  muss beide anfassen.
- Report-Schema bekommt `receivablesCents` und `settlementAsOf`. Der Stichtag muss
  beim ersten `completed` persistiert und bei jedem `reAggregate`
  **wiederverwendet** werden, sonst ist die Reproduzierbarkeit nur verschoben —
  er gehört in `STABLE_HASH_FIELDS`.

> ⚠️ `compute-cash-reconciliation.spec.ts` in der Cloud **mockt** die
> Aggregator-Lib und repliziert die Formel handschriftlich. Wird der Mock nicht
> mitgezogen, bleibt der Test grün, während die echte Formel abweicht.
