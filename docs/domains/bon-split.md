---
type: Domain Concept
title: 'Bon-Split — „getrennt zahlen" als Umbuchung'
description: 'Fachliches Modell des Bon-Splits am Edge: order.splitOff als append-only Gegenbuchung, effectiveLineItems als einzige Ableitung der Restmenge, Rabatt- und Steueraufteilung, Vorbedingungen und die bewusst abgelehnte Teilung von Modifier-Zeilen.'
tags: [orders, fiskalisierung, dsfinv-k, pricing]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-24T14:50:00Z }
---

# Bon-Split — „getrennt zahlen" als Umbuchung

Eine offene Bestellung lässt sich in Teilbestellungen aufteilen. Jede
Zielbestellung trägt denselben **Abrechnungskreis**, eine eigene Belegnummer,
eine eigene Startzeit und eine Referenz auf den Ursprung. Entscheidungen und
Begründungen: [ADR 0049](../adr/0049-split-als-gegenbuchung.md), Vorarbeiten
[ADR 0047](../adr/0047-abrechnungskreis-als-pflichtfeld.md) (Abrechnungskreis)
und [ADR 0048](../adr/0048-vorgangs-referenzen-append-only.md) (Referenzen,
Journal).

## Das Modell in einem Satz

Der Split **verschiebt nichts, er bucht um**: `order.lineItems` bleibt
unverändert, `order.splitOff[]` hält append-only fest, was gegangen ist, und
`effectiveLineItems(order)` leitet daraus ab, was der Vorgang noch trägt.

```
Quelle vor dem Split          Quelle nach dem Split         Ziel
─────────────────────         ─────────────────────         ─────────────
lineItems: [                  lineItems: [                  lineItems: [
  { _id: l1, amount: 5 }        { _id: l1, amount: 5 }  ←     { _id: NEU,
]                             ]        unverändert!            externalId: wie l1,
                              splitOff: [                      amount: 3 }
                                { lineItemRowId: l1,        ]
                                  amount: 3,
                                  targetOrderId: … }
                              ]
effectiveLineItems → 5        effectiveLineItems → 2
```

Der Umweg über eine Ableitung existiert, weil zwei Anforderungen gleichzeitig
gelten: Die Quellzeile darf nicht geändert werden (A5), und die Quelle darf
danach nicht mehr den vollen Betrag tragen (A13, § 14c UStG). Als `UPDATE` wäre
nur eines von beidem möglich.

🚨 **`effectiveLineItems` ist die einzige Fassung dieser Ableitung.** Wer die
Restmenge anderswo selbst zusammenrechnet, druckt nach einem Split eine andere
Zahl, als die API ausweist — still, ohne Fehler, auf einem steuerrelevanten
Dokument. Vier Stellen lesen sie: die Preis-Engine `computeOrderTax`, der
Patch-Hook `calculateTaxDetailsOnPatch`, der Beleg (`issueReceipt`) und der
Bon-Renderer.

## Schnittstelle

```
POST /orders   →  Methode `split`
{ "orderId": "<uuid>", "lineItems": [{ "lineItemRowId": "<uuid>", "amount": 3 }] }
→ { "sourceOrder": …, "targetOrder": … }
```

- `lineItemRowId` ist die **Zeilen**-ID (`lineItem._id`), nicht die Artikel-ID —
  die steht in `externalId` ([ADR 0033](../adr/0033-bestellzeilen-tragen-eine-eigene-id.md)).
- `amount` weglassen = die ganze (Rest-)Zeile.
- Ein Aufruf erzeugt **ein** Ziel. Drei Belege = zwei Aufrufe.

### Vorbedingungen und Fehlercodes

| Code | Wann |
|---|---|
| `order-split/source-not-splittable` | Quelle ist `COMPLETED` oder `ABORTED`, oder es wurde bereits ein Beleg ausgestellt (A6) |
| `order-split/empty-selection` | keine Auswahl |
| `order-split/unknown-line` | Zeile gibt es nicht — auch bei Bestandsdaten **ohne** `lineItem._id` |
| `order-split/duplicate-line` | dieselbe Zeile zweimal in einer Auswahl |
| `order-split/amount-exceeds-remainder` | mehr verlangt, als die Zeile noch trägt |
| `order-split/partial-split-unsupported` | Teilmenge einer Zeile mit Modifiern/Komponenten (siehe unten) |
| `order-split/nothing-remains` | die Quelle bliebe leer — das wäre eine Umbuchung, kein Split |

⚠️ `COMPLETED` ist in der Status-FSM **nicht** hart terminal (`COMPLETED →
UNCLAIMED`/`→ ABORTED` sind erlaubt). Der Split lehnt trotzdem hart ab: A6
verlangt, dass es keinen Code-Pfad gibt, der einen abgeschlossenen Vorgang wieder
öffnet. Der Status-Guard ist hier **kein** Ersatz für die eigene Prüfung.

## Was die Zielbestellung erbt

Sie entsteht über `orders.create` und läuft damit durch die volle Hook-Kette:

| Was | Woher |
|---|---|
| Geschäftstag (inkl. Auto-Rotation) | `restrictOrderToBusinessDay()` — läuft **nur** im `before.create`, nicht im Patch |
| Belegnummer | `assignDailySequenceNumber()` — eine eigene je Teilbeleg |
| Abrechnungskreis | von der Quelle übernommen; `assignSettlementScope()` respektiert den mitgeschickten Wert |
| TSE-Vorgang | `signOrderTseStart` — im Kassenbetrieb ein **eigener** Vorgang; die Quelle wird **nicht** storniert |
| `taxSnapshot` | `calculateTaxDetails` |
| Startzeit (`recordingDate`) | der Split-Zeitpunkt, **nicht** der der Quelle (A10) |

## Rabatte und Steuer

- **Prozentrabatte** (Order wie Position) werden auf beide Seiten kopiert und
  wirken dort auf der jeweiligen Basis. Es gibt nichts zu verteilen.
- **Festbeträge** werden mit `distributeByLargestRemainder` über die
  Brutto-Anteile beider Seiten geteilt — summen-exakt.
- Ein **Positionsrabatt auf einer ganz gewanderten Zeile** wandert mit und
  verschwindet aus der Quelle; er bliebe sonst als Rabatt ohne Position stehen.

🚨 **Ein vorhandener `taxSnapshot` ist autoritativ, auch mit leerer
`taxes`-Liste.** `computeOrderTax` verwirft Eimer ≤ 0; bei 100 % Nachlass
(Personalessen) ist die Liste deshalb leer. Wer daraus „kein Snapshot" schließt,
weist die **volle** Steuer aus — auf beiden Seiten des Splits.

🚫 **Die Invariante „Σ netto + Σ steuer === brutto" beweist die MwSt-Methode
nicht.** Sie hält auch bei falscher Formel. Geprüft wird gegen die **Steuereimer
je Satz**.

### Rundungsrest (A14)

`order.splitRoundingRemainderCents` trägt die Differenz zwischen Ursprungsbetrag
und der Summe der Teilbelege. Sie **bleibt stehen** und wird nicht geglättet —
ein nachträglich korrigierter Cent ist von einem Rechenfehler nicht mehr zu
unterscheiden. Der Wert darf negativ sein, wird über mehrere Splits **aufsummiert**
und ist im Regelfall 0: Die Verteilungen laufen über largest-remainder. Er
entsteht dort, wo ein Prozentrabatt je Seite gerundet wird.

```
2 × 1,05 € mit 10 %:   zusammen 210 − 21 = 189 ct
                       getrennt  105 − 11 =  94 ct je Seite  →  188 ct
                       splitRoundingRemainderCents = 1
```

## Warum Modifier-Zeilen nur ganz wandern

Ein Modifier zählt mit **seinem eigenen** `amount` und skaliert **nicht** mit der
Menge der Hauptzeile:

```
2 × Brötchen à 4,00 € + 1 × „Extra Käse" à 0,50 €  =  8,50 €   ← korrekt
                          naive Lesart 2 × (4,00 + 0,50) =  9,00 €   ← falsch
```

Gäbe man „3 von 5" ab, trüge die Quelle den Aufpreis weiter voll **und** das Ziel
bekäme ihn noch einmal — der Split erfände Umsatz. Bundle-Komponenten haben die
spiegelbildliche Falle (`FIXED_PROPORTIONAL` verteilt einen Festpreis). Eine
**ganze** solche Zeile zu verschieben ist unproblematisch und erlaubt.

Es gibt keine Norm, die sagt, wie ein Aufpreis auf Teilmengen fällt. Eine
Hausregel wäre eine Behauptung an einer prüfungsrelevanten Stelle — deshalb die
Ablehnung mit eigenem Code statt einer erfundenen Aufteilung.

## Spuren, die der Split hinterlässt

| Wo | Was |
|---|---|
| `order-references` | ein Datensatz `refType: 'Split'`, `sourceOrderId` = Quelle, `targetOrderId` = Ziel (DSFinV-K `Bon_Referenzen`, Tz. 4.2.2) |
| `order-interactions` | `order-split` (Quelle), `order-split-target` (Ziel), je bewegter Zeile ein `item-moved` mit `lineItemRowId` |
| Log | `order.split`; Fehlschläge als `order.split_reference_failed` / `order.split_interaction_failed` |

🚨 **Referenz und Journal sind nicht blockierend** — wie beim Storno und den
TSE-Hooks (§ 146a): Ein fehlgeschlagener Schreibvorgang darf die Kasse nicht
sperren. Der Preis ist bekannt: Ein Fehler steht nur im Log, und eine fehlende
Referenz sieht in der Tabelle aus wie „gab es nicht". Wer Vollständigkeit prüfen
will, prüft das Log auf diese Events, nicht die Tabelle auf Lücken.

Ohne `params.user` schreibt das Journal **nichts**: Ein Journal-Ereignis ohne
„wer" beantwortet die einzige Frage nicht, für die es existiert.

## Was noch fehlt

- **POS-Oberfläche** — [#350](https://github.com/panary/panary-core/issues/350).
- **Bestandsbuchung in der Cloud** —
  [panary/panary-cloud#488](https://github.com/panary/panary-cloud/issues/488).
  Bis dahin ist eine **Doppelbuchung** möglich: Die Idempotenz über
  `stockBookedAt` schützt je Order, nicht über eine Split-Gruppe hinweg, und der
  Fehler ist still.
- **Bon aus dem Snapshot statt live** — der Renderer rechnet `computeOrderTax`
  weiterhin zum Druckzeitpunkt (ADR 0047, Begründung für die Vertagung in
  ADR 0049 Nr. 1).
- **Bestandsdaten ohne `lineItem._id`** lassen sich nicht splitten.
