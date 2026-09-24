---
type: ADR
title: 'Abrechnungskreis als Pflichtfeld — und die sieben Designentscheidungen des Split-Vorhabens'
description: 'ADR zur Einführung von order.settlementScope als verpflichtender, unveränderlicher Vorgangsklammer nach DSFinV-K ABRECHNUNGSKREIS — und zur Entscheidung der sieben Designfragen, an denen eine spätere TSE-Anbindung scheitert, wenn sie jetzt falsch fallen.'
tags: [orders, fiskalisierung, tse, sync, multi-tenancy]
status: stable
decision: accepted
implementation: 'Entscheidung 3 umgesetzt 2026-09-22 (#345, Edge + POS); 1/2/4/7 offen, 5/6 bereits erfüllt'
generated: { by: claude-code/opus-5, at: 2026-09-22T16:30:00Z }
---

# Abrechnungskreis als Pflichtfeld — und die sieben Designentscheidungen des Split-Vorhabens

Für den POS ist eine Split-Funktion beauftragt: einzelne Positionen einer Bestellung
in separate Bestellungen überführen („getrennt zahlen"). Ein Rechtsgutachten vom
2026-09-20 (Volltext als Kommentar an [#345](https://github.com/panary/panary-core/issues/345))
hat die Normlage ausgewertet — AEAO zu § 146a i. d. F. BMF 30.06.2023 samt aller vier
Änderungsschreiben bis 17.03.2026, KassenSichV, GoBD, DSFinV-K 2.4, DFKA-Leitfaden — und
endet mit **sieben Designentscheidungen, die jetzt fallen müssen**. Sie fallen jetzt,
weil eine spätere TSE-Anbindung an ihnen scheitert, wenn sie heute falsch getroffen
werden; nachrüsten hieße dann nicht migrieren, sondern neu bauen.

Dieses ADR hält alle sieben fest und setzt die dritte um. Die übrigen sechs stehen hier,
weil eine Entscheidung, die man nur im Kopf trifft, in drei Monaten niemand mehr
nachvollziehen kann — auch die, die schon erfüllt sind.

Reihenfolge des Vorhabens: dieses Issue → [#348](https://github.com/panary/panary-core/issues/348)
(Referenzen + Journal) → [#349](https://github.com/panary/panary-core/issues/349)
(Split-Backend, [ADR 0049](0049-split-als-gegenbuchung.md)) → [#350](https://github.com/panary/panary-core/issues/350) (POS-UI) →
[panary/panary-cloud#488](https://github.com/panary/panary-cloud/issues/488). Vertagt:
[#352](https://github.com/panary/panary-core/issues/352) (Nachbuchung, Entscheidungsvorlage),
[#351](https://github.com/panary/panary-core/issues/351) (TSE-Pflichtlage).

## Problem

Der Split vor Abschluss ist zulässig und normativ ausdrücklich vorgesehen — die DSFinV-K
nennt „Splittbuchungen und Tischverlegungen" in Tz. 3.1.2.2 beim Namen. Ein Storno ist
dafür **nicht** nötig: Bestellungen sind „andere Vorgänge" ohne Umsatzwirkung, der Umsatz
entsteht erst mit dem jeweiligen Kassenbeleg. Ein Split erzeugt also n Belege statt einem.

Die Klammer, über die ein Prüfer das nachvollzieht, ist das Feld **`ABRECHNUNGSKREIS`**
(DSFinV-K Tz. 2.7.1, 3.1.2.2) — ergänzt um `Bon_Referenzen`. Österreich verlangt mit dem
RKSV-Verrechnungskreis dasselbe Konzept; wer eines sauber baut, deckt beide Märkte.

Der Code hatte diese Klammer nicht. `order.table` war ein **optionaler freier String**
ohne Fremdschlüssel, gespeist aus `locationService.tables`. Damit fehlte genau die
Eigenschaft, die Anforderung A3 des Gutachtens verlangt: ein Feld, das über Bestellungen,
Split-Belege, Umbuchungen und Stornos hinweg **identisch** bleibt und immer da ist. Eine
Bestellung ohne Tisch — im Thekenbetrieb der Regelfall — trug gar nichts.

## Entscheidung

### 3. Abrechnungskreis als Pflichtfeld (umgesetzt)

`order.settlementScope` ist ein **Pflichtfeld** in `orderSchema`, `maxLength: 50` — das ist
keine Hausnummer, sondern die Feldlänge des DSFinV-K-Feldes `ABRECHNUNGSKREIS`. Nach dem
Create ist es unveränderlich; der `orderPatchResolver` strippt es still, auf derselben
Liste wie `dailySequenceNumber`.

**Wert:** der Tischwert, unverändert. Nur so gilt die Eigenschaft, an der alles hängt —
zwei Bestellungen desselben Tisches tragen denselben Abrechnungskreis. Ohne Tisch ein
synthetischer Wert mit dem reservierten Präfix `auto:`, gebaut aus Standort, Geschäftstag
und Vorgangsnummer. Das ist fachlich der richtige Zuschnitt: Ohne Tisch gibt es nichts zu
gruppieren, jede Bestellung ist ihr eigener Abrechnungskreis.

Drei Punkte, die nicht offensichtlich sind:

**Kein Präfix für den Tischfall.** Naheliegend wäre `tisch:3` gewesen, symmetrisch zu
`auto:`. Es geht nicht: `table` trägt bereits `maxLength: 50`, ein Präfix sprengte die
DSFinV-K-Grenze, sobald ein Tischname sie ausreizt — und müsste dann kürzen. Zwei
verschiedene Tische verschmölzen still zu einem Abrechnungskreis. Bleibende Unschärfe: Ein
Tisch, den der Betreiber wörtlich `auto:…` nennt, wird als synthetisch gelesen. Das wird
bewusst **nicht** abgefangen; ein Sonderfall, der solche Tische auf den synthetischen Pfad
schickte, zerrisse die Tisch-Gruppierung — die Herkunft ist eine Auswertungsangabe, die
Gruppierung die fiskalische Klammer.

**Pflicht im Lese-Schema, optional im Create-Schema.** `orderDataSchema` führt
`settlementScope` als `Type.Partial` — wie `tenantId`/`locationId` und aus demselben
Grund: Das Feld wird serverseitig gestempelt, und eine 400-Meldung „must have required
property 'settlementScope'" zeigte fälschlich auf den Client statt auf den Stempel-Pfad;
genau diese Fehlkonstruktion meldet `assert-stamp-fields.ts` im Boot. Der zweite Grund
wiegt schwerer: Dieses Schema validiert auch den Sync-Push Edge → Cloud. Als Pflichtfeld
verwürfe eine bereits gebumpte Cloud jeden Push eines noch nicht aktualisierten Edge mit
`BadRequest` — und `classifyAcceptError` stuft das als **TERMINAL** ein: Outbox
`rejected`, kein Retry, kein `sync-conflicts`-Eintrag, kein Operator-Alarm. Die Pflicht
erzwingt der Edge-Hook, nicht der Create-Validator.

**Der Ableitungspfad ist fail-open.** Ein Pflichtfeld mit serverseitigem Default ist ein
Fiskal-Gate: Schlägt die Ableitung fehl, ist keine Bestellung mehr aufgebbar.
`assignSettlementScope()` wirft deshalb nie, setzt im Fehlerfall einen groben
synthetischen Wert und loggt `order.settlement_scope_fallback`. Dasselbe Muster wie
`business_day.age_check_skipped` in `restrict-order-to-business-day.ts`: Ein Geschäftstag
ohne brauchbaren Zeitstempel überspringt die Altersgrenze, statt die Kasse zu sperren. Die
Risiko-Asymmetrie ist in beiden Fällen dieselbe — ein unscharfer Abrechnungskreis ist ein
Auswertungsproblem, eine blockierte Kasse ein Betriebsausfall.

### 5. und 6. — bereits erfüllt, deshalb nicht anzufassen

**Append-only Positionsdaten, Positions-ID ≠ Artikel-ID.** Erfüllt.
[ADR 0033](0033-bestellzeilen-tragen-eine-eigene-id.md) trennt `lineItem._id` (Zeilenidentität) von
`externalId` (Artikelidentität) — genau die Unterscheidung, ohne die ein Split entweder
die Historie zerstört oder die Zuordnung mehrdeutig macht. Dazu sperrt der
`orderPatchResolver` `lineItems` per Patch (`lineItems: async () => undefined`); ein
Client bekommt HTTP 200 und es passiert nichts. Das ist die technische Fassung von A5 und
**nicht aufzuweichen**: `calculate-tax-details.ts` hält ausdrücklich fest, dass `lineItems`
deshalb kein Trigger für die `taxSnapshot`-Neuberechnung ist. Wer die Sperre öffnet, ändert
Positionen ohne neue Steuer — still falsch auf einem steuerrelevanten Dokument.

**Steuer- und Rabatt-Snapshot an der Position.** Weitgehend erfüllt: `taxSnapshot` wird
beim Bonieren berechnet und gespeichert, `appliedDiscounts` ist seit
[ADR 0030](0030-legacy-rabattfeld-abgeschafft.md) die einzige Rabattquelle mit
positionsgenauer Zuordnung. **Eine Lücke bleibt und gehört nach #349:**
`renderOrderReceipt` rechnet `computeOrderTax` live zum Druckzeitpunkt statt aus
`taxSnapshot`. Solange Stammdaten und Steuersätze stillstehen, fällt das nicht auf; bei
einem Steuersatzwechsel druckt es rückwirkend andere Zahlen als der Snapshot trägt
(GoBD Rz. 111).

> ⚠️ **Nachtrag (#349):** Die Lücke ist **nicht** geschlossen worden.
> [ADR 0049](0049-split-als-gegenbuchung.md) Nr. 1 begründet die Vertagung: `computeOrderTax`
> liefert `computedAmountCents` je `appliedDiscount` als **Seiteneffekt**, und der Renderer
> hängt daran — wer die Quelle umstellt, ohne den Seiteneffekt zu ersetzen, bricht die
> Nachlasszeile, und zwar still. Der Split selbst ist davon unberührt: Bon und Datensatz
> stimmen überein, weil beide dieselbe Funktion auf denselben Eingaben rechnen.

### 1., 2., 4. und 7. — entschieden, noch nicht gebaut

**1. Vorgang ≠ Bestellung ≠ Tisch.** Drei getrennte Konzepte; ein Tisch hat n
Bestellvorgänge und m Belegvorgänge, unabhängig voneinander. Der Abrechnungskreis aus
diesem ADR ist die erste der drei Achsen. Die Trennung Bestellung/Beleg bleibt offen —
heute ist beides dieselbe `orders`-Zeile. Das ist noch kein Defekt, aber die Stelle, an der
#349 ansetzen muss: Ein POS, der beim Nachbestellen eine Zeile anhängt, ist mit TSE nicht
nachrüstbar.

**2. Vorgangs-Lebenszyklus als expliziter Zustand.** Teilweise vorhanden: Die TSE-Klammer
ist verdrahtet (`signOrderTseStart` am Create, `…Finish` auf `completed`, `…Cancel` auf
`aborted`), und der FSM-Guard `validateOrderStatusTransition` lehnt Rücksprünge aus
Terminal-Status ab. Was fehlt, ist der Riegel in der vom Gutachten verlangten Härte: „kein
Schreibpfad daran vorbei, auch kein Admin-Override". Interne Aufrufe passieren den Guard
heute.

**4. Referenztabelle zwischen Vorgängen.** Gibt es nicht — nur `preOrderId`. Kommt mit
#348, mit den DSFinV-K-Feldnamen als Zielbild (`REF_TYP`, `REF_BON_ID`, `REF_Z_KASSE_ID`,
`REF_Z_NR`, `REF_DATUM`). ⚠️ `REF_TYP` hat genau vier Ausprägungen; für Split, Umbuchung
und Storno ist es `"Transaktion"`. **`AVTransfer` bildet keinen Bon-Split ab** — wer es
dafür verwendet, bucht den Umsatz aus dem Kassenabschluss heraus.

**7. Belegnummernkreis pro Kasse, lückenerkennbar.** **Nicht** erfüllt, und das ist der
gravierendste der offenen Punkte. `dailySequenceNumber` ist keine Sequenz: Sie entsteht in
`assign-daily-sequence-number.ts` aus `Minuten + Sekunden` der Uhrzeit, mit einem
Kollisions-Suffix aus der Trefferzahl. Sie ist damit weder fortlaufend noch
lückenerkennbar, und die Kollisionsabfrage läuft ohne Standort-Filter. § 2 Satz 4
KassenSichV verlangt das Gegenteil. Der Umbau gehört nach #351, nicht hierher — aber er
gehört benannt, bevor jemand die Zahl für eine Belegnummer hält.

## Konsequenzen

**Die Release-Reihenfolge ist nicht optional.** Der Outbox-Push schickt den **ganzen**
Order-Record (`sync-outbox-recorder.hook.ts`, `payload = context.result`), und die Cloud
validiert ihn gegen `orderDataSchema` aus dem **gepinnten** `@panary/orders/domain` — mit
`additionalProperties: false`. Ein Edge, der `settlementScope` sendet, bevor der Cloud-Pin
gebumpt und `api-cloud` deployt ist, bekommt `BadRequest` → TERMINAL → Outbox `rejected`,
ohne Retry, ohne `sync-conflicts`-Eintrag, ohne Alarm. Die einzige Spur ist eine
`sync.push.op_rejected`-Warnzeile.

Zwingende Reihenfolge: **Core-Release → `@panary/*`-Pin in panary-cloud bumpen →
`api-cloud` deployen → erst dann Edges aktualisieren.** Die umgekehrte Richtung ist durch
die `Type.Partial`-Entscheidung oben abgesichert: Eine gebumpte Cloud nimmt auch Pushes
alter Edges weiter an.

**Bestandsdaten sind migriert, aber unterscheidbar.** Die Migration übernimmt den
Tischwert unverändert und gibt Bestellungen ohne Tisch `auto:backfill-<id-ende>`. Eine
spätere Auswertung kann damit „gewachsen" von „gesetzt" unterscheiden — ohne diese
Unterscheidung läse sich ein Thekenbetrieb wie ein Gastro-Betrieb, in dem jeder Gast an
einem eigenen Tisch saß.

**Die Spalte ist `NOT NULL` mit dem Platzhalter `auto:unset`, nicht nullable.** Eine
nullable Spalte wäre der gefährlichere Weg: Der Edge serialisiert ungesetzte nullable
SQLite-Spalten als `null`, und der Sync-Push verwürfe sie gegen `Type.String(...)` mit
`must be string` — wieder terminal. Bleibt irgendwo `auto:unset` stehen, hat ein
Schreibpfad den Hook umgangen; der Wert ist absichtlich greppbar.

**Die Ableitung ist eine geteilte Domain-Funktion**
(`libs/domains/orders/domain/src/lib/settlement-scope.ts`), kein Hook-Detail: Edge, POS und
Cloud müssen denselben Wert lesen. Der POS-Offline-Pfad ruft dieselbe Funktion, weil dort
bis zum Replay kein Server existiert, der stempeln könnte — der Edge-Hook übernimmt einen
mitgeschickten Wert, der Wert überlebt den Replay also unverändert. Die Edge-**Migration**
darf die Funktion nicht importieren (`migrations/` ist ein Asset-Ordner mit
`--bundle=false`; ein Domain-Import fiele still aus) und hält ihre Literale per Test gegen
die Domain-Konstanten.

**Offen für den Steuerberater:** Ob der Abrechnungskreis im Thekenbetrieb (`pos-cashier`,
kein Tisch) einen fachlichen Wert braucht oder der synthetische genügt. Das Gutachten
verlangt das Feld, sagt aber nichts über einen Betrieb ohne Tische.

**Vorab-Befund außerhalb des Auftrags, hier nur festgehalten:** Wird das System in
Deutschland produktiv zur Erfassung von Geschäftsvorfällen eingesetzt, ist der Betrieb
**ohne** TSE bereits heute ein Verstoß gegen § 146a Abs. 1 Satz 2 AO. Die
Übergangsregelungen sind abgelaufen. Das ist Gegenstand von
[#351](https://github.com/panary/panary-core/issues/351), nicht dieses ADR.
