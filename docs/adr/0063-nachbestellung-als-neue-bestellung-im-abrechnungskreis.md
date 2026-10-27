---
type: ADR
title: 'Nachbestellung als neue Bestellung im Abrechnungskreis, mit Besuchszähler je Tisch'
description: 'ADR zur Nachbuchung nach der Bestellannahme: jede Nachbestellung wird eine eigene Bestellung im selben Abrechnungskreis, der Kreis schließt mit seiner letzten offenen Bestellung, ein Besuchszähler trennt Gäste am selben Tisch, und der Sammelbeleg wartet auf die TSE-Anbindung.'
tags: [orders, receipts, fiskalisierung, tse, pos]
status: stable
decision: accepted
implementation: 'nicht gebaut; Folge-Issues siehe Abschnitt „Umsetzung"'
generated: { by: claude-code/opus-5.5, at: 2026-10-27T09:00:00Z }
sources:
  - { id: gutachten-345, resource: 'https://github.com/panary/panary-core/issues/345', title: 'Rechtsgutachten Split und Nachbuchung (Kommentar an #345)' }
  - { id: issue-352, resource: 'https://github.com/panary/panary-core/issues/352', title: 'Entscheidungsvorlage Nachbuchung' }
---

# Nachbestellung als neue Bestellung im Abrechnungskreis, mit Besuchszähler je Tisch

Beauftragt war, „dem Bon weitere Positionen nach der Bestellannahme hinzuzufügen“: Ein Gast
bestellt nach, und die Nachbestellung soll zur vorherigen gehören. [#352](https://github.com/panary/panary-core/issues/352)
hat daraus sechs Fragen gemacht, an denen eine Umsetzung rechtlich oder technisch scheitern
kann. Dieses ADR beantwortet sie. Entschieden hat Michael am 2026-10-27, auf Grundlage des
Rechtsgutachtens an [#345](https://github.com/panary/panary-core/issues/345) und der
Designstudie zum Tischplan, für die der Tischbetrieb genau diese Antwort braucht.

Vorgänger: [ADR 0047](0047-abrechnungskreis-als-pflichtfeld.md) (Abrechnungskreis),
[ADR 0048](0048-vorgangs-referenzen-append-only.md) (Referenzen und Journal),
[ADR 0049](0049-split-als-gegenbuchung.md) (Split als Gegenbuchung).

## Problem

Die naheliegende Umsetzung ist die falsche: Positionen an die bestehende Bestellung hängen.
Drei Dinge stehen ihr entgegen.

- **Recht.** Nach Belegausgabe darf einem Vorgang nichts hinzugefügt werden (A6, AEAO
  Nr. 2.2.3.3). Vor Abschluss ist eine Nachbestellung zulässig, aber als weiterer
  Bestellvorgang (AEAO Nr. 2.2.3.6.2, „eigenständige Vorgänge“). Eine abgesicherte Bestellung
  wird nie überschrieben, sondern storniert und neu erfasst (Gutachten 3.1, DFKA-Leitfaden S. 23).
- **Code.** `orderPatchResolver` verwirft `lineItems` still (`orders.schema.ts`, HTTP 200 ohne
  Wirkung), und `calculate-tax-details.ts` rechnet den `taxSnapshot` deshalb bei Positionen nicht
  neu. Die Sperre zu öffnen hieße, Positionen ohne neue Steuer zu ändern (ADR 0047, Nr. 5/6).
- **Betrieb.** Am Tisch bonieren mehrere Kassen, manche zeitweise ohne Verbindung. Ein
  gemeinsamer, veränderlicher Datensatz je Tisch ist dort ein Schreibkonflikt; ein angehängter
  Küchenbon müsste herausrechnen, was neu ist.

Das Gutachten erlaubt im Kassenbetrieb vor Abschluss zwar auch das „Fortsetzen der Erfassung“
(3.1, letzter Absatz). Das gilt aber nur, solange der Vorgang an einem Gerät offen ist. In
Panary ist eine Bestellung nach „Bestellen“ gespeichert, gedruckt und synchronisiert, sie ist
also kein offener Erfassungsvorgang mehr.

## Entscheidung

### 1. Abbildung: jede Nachbestellung ist eine neue Bestellung im selben Abrechnungskreis

Eine Nachbestellung legt eine **neue `orders`-Zeile** an. Sie trägt den `settlementScope` des
Tisches, ihren eigenen TSE-Vorgang (`signOrderTseStart` beim Anlegen, wie jede Bestellung) und
eine Vorgangs-Referenz `refType: Transaktion` mit `sourceOrderId` = die **erste** Bestellung des
Kreises. Die erste statt der jeweils vorigen, weil der Bezug dann für jede Nachbestellung
derselbe ist und ohne Kette nachvollziehbar bleibt.

Die fachliche Klammer „eine Rechnung für den Tisch“ ist der Abrechnungskreis. So sieht es die
DSFinV-K vor: Ein Tisch hat n Bestellvorgänge und m Belegvorgänge, unabhängig voneinander
(ADR 0047 Nr. 1, Gutachten 3.1 und Anhang H der DSFinV-K).

`assignSettlementScope` übernimmt einen mitgeschickten Wert bereits heute. Die Kasse schickt den
Kreis des gewählten Tisches mit. Am Server ändert sich für den Normalfall nichts.

**Verworfen: Positionen an die bestehende Bestellung anhängen.** Bricht A5 und A6, verlangt das
Öffnen der `lineItems`-Sperre und damit eine zweite Steuerberechnung nach dem Anlegen, und ist
mit TSE nicht nachrüstbar (Gutachten 3.2, „Designfalle“). Bitte nicht erneut vorschlagen, auch
nicht „nur im Bestellbetrieb“ oder „nur vor dem ersten Druck“: Die Abgrenzung ist der Teil, der
später bricht (Nr. 3).

**Verworfen: Storno der alten Bestellung plus eine neue mit allen Positionen.** Rechtlich
zulässig, aber für jede Nachbestellung ein Storno im Journal, ein Storno-Küchenbon für schon
Zubereitetes und eine Bestandsrückbuchung. Der Weg bleibt für echte Korrekturen (A7), nicht für
Nachbestellungen.

### 2. Grenze: ein Kreis ist offen, solange er eine nicht-terminale Bestellung hat

Nachbestellen öffnet nie einen Vorgang wieder, es legt nur einen neuen an. A6 verlangt deshalb
keinen Riegel an der Bestellung, die bleibt, wie sie ist. Der Riegel liegt am **Kreis**:

- **Offen** ist ein Kreis, solange mindestens eine seiner Bestellungen einen nicht-terminalen
  Status hat (`active`, `production`, `produced`).
- **Geschlossen** ist er, sobald alle seine Bestellungen `completed`, `aborted` oder `unclaimed`
  sind. Eine weitere Bestellung an diesem Tisch eröffnet einen **neuen** Kreis (Nr. 4).

Der Zustand wird aus den Bestellungen abgeleitet, nicht gespeichert. Ein zweites Feld, das
dasselbe aussagt, liefe auseinander.

**Der Edge lehnt nie ab.** Kommt eine Bestellung mit dem Kreis eines bereits geschlossenen
Besuchs an (eine Kasse ohne Verbindung hat nachbestellt, während eine andere kassiert hat),
ordnet `assignSettlementScope` sie dem **nächsten** Besuch zu und schreibt das ins Journal
(`order-interactions`, Pfad aus [#386](https://github.com/panary/panary-core/issues/386)). Eine
Bestellung ist bei Ankunft schon produziert. Ein Ablehnen am Outbox-Push wäre endgültig und
unbemerkt (`classifyAcceptError` → TERMINAL, siehe ADR 0047 „Release-Reihenfolge“). Dasselbe
Fail-open-Muster wie bei der Ableitung des Kreises selbst.

**`COMPLETED → UNCLAIMED` und `COMPLETED → ABORTED` sind kein Wiederöffnen.**
`order-state-machine.ts` erlaubt beide Übergänge. Sie bewegen eine abgeschlossene Bestellung
zwischen terminalen Status, keiner führt zurück nach `active`, und keiner fügt Positionen hinzu.
Wer daraus einen Nachbuch-Pfad baut („unclaimed wieder aufnehmen“), bricht A6.

### 3. Betriebsmodus: dieselbe Grenze im Bestell- und im Kassenbetrieb

Die Regel aus Nr. 2 hängt am Status, nicht an der TSE. Sie gilt deshalb unverändert in
`orders-only` und `pos-cashier`.

**Verworfen: im Bestellbetrieb (ohne Signatur) großzügiger sein.** `operationMode` wird je
Geschäftstag eingefroren (ADR 0026) und über `locations.setOperationMode` umgestellt
(cloud ADR 0046). Daten, die nach einer lockeren Regel entstanden sind, lägen nach dem
Umschalten im Kassenbetrieb vor, und mit TSE wäre die Regel nicht mehr verhandelbar
([#351](https://github.com/panary/panary-core/issues/351)). Ein Datenmodell, zwei Grenzen ist
genau die Falle, die #352 benennt.

### 4. Gästewechsel: ein Besuchszähler im Kreis

Heute ist der Kreis das Tisch-Label unverändert (ADR 0047 Nr. 3). Alle Gäste eines Tisches
landen damit an einem Tag im selben Kreis. Das verletzt die Anforderung, die die DSFinV-K an den
Kreis selbst stellt: Er „muss eine eindeutige Identifikation für den Geschäftsvorfall
enthalten“ (Tz. 3.1.2.2 mit GoBD Rz. 94, Gutachten 4.1 und A3).

Neu ist der Kreis eines Tisches **`<Tisch-Label>#<n>`**. `n` zählt je Tisch und Geschäftstag ab 1
und steigt, wenn eine Bestellung an einem Tisch eintrifft, dessen letzter Kreis geschlossen ist
(Nr. 2). Die Ableitung bleibt eine geteilte Domain-Funktion in `settlement-scope.ts`, damit
Edge, POS und Cloud denselben Wert lesen. Sie bekommt dafür die offenen und geschlossenen Kreise
des Tisches als Eingabe; ermittelt werden sie am Edge aus `orders` über die Adapter-API.

Drei Punkte, die nicht offensichtlich sind:

- **Gleichzeitig ist kein Problem.** Öffnen zwei Kassen denselben neuen Besuch, berechnen beide
  dasselbe `n` und landen im selben Kreis. Das ist fachlich richtig: Es ist derselbe Besuch.
- **Ohne Verbindung rät die Kasse.** Die POS-Offline-Ableitung kennt nur ihre eigenen Daten und
  kann einen geschlossenen Kreis für offen halten. Das korrigiert Nr. 2 am Edge.
- **Alte Clients.** Eine Kasse vor dieser Änderung schickt das Label ohne `#<n>`. Der Edge
  übernimmt den Wert wie bisher, ein solcher Kreis gilt als Besuch 0. Die Gruppierung bleibt
  dann so grob wie heute, bis die Kasse aktualisiert ist. Keine Bestandsmigration: Alte Kreise
  sind abgeschlossen und werden nicht umgeschrieben (GoBD Rz. 108).

**Länge.** `ABRECHNUNGSKREIS` hat 50 Zeichen (DSFinV-K), `order.table` ebenso, `TableEntry.label`
erlaubt 60. Der Besuchsteil braucht bis zu vier Zeichen (`#999`). Entschieden:

- Neue und geänderte Tisch-Labels werden in der Cloud-Einstellung auf **45 Zeichen** begrenzt.
  Das Schema in `location.schema.ts` bleibt bei 60: Kürzer gemacht, würde der Edge jeden
  gepullten Standort mit einem längeren Bestands-Label ablehnen.
- Passt `<Label>#<n>` trotzdem nicht in 50 Zeichen, fällt die Ableitung auf den synthetischen
  Kreis `auto:` je Bestellung zurück und loggt `order.settlement_scope_fallback`. Der Tisch
  verliert dann seine Klammer, die Kasse arbeitet weiter. Kürzen ist ausgeschlossen, weil zwei
  Tische mit gleichem Anfang still zu einem Kreis verschmölzen (ADR 0047 Nr. 3).

**Verworfen: das Label bleibt der Kreis.** Kein Schemaeingriff, aber im DSFinV-K-Export sind die
Gäste eines Tisches nicht unterscheidbar, und ein „Tisch kassieren“ (Nr. 5) müsste anders als
über den Kreis entscheiden, welche Bestellungen dazugehören.

**Verworfen: die Tisch-ID statt des Labels im Kreis.** Stabil gegen Umbenennen und kurz, aber im
Export für einen Prüfer unlesbar, und `order.table` trägt heute keine ID. Kommt mit dem Tischplan
eine `tableId` an die Bestellung, bleibt der Kreis trotzdem beim Label: Der Kreis eines Besuchs
soll lesbar sein, die Stabilität gegen Umbenennen braucht er nicht, weil ein Besuch nur Stunden
dauert.

### 5. Zusammenführung zur Rechnung: Ziel Sammelbeleg, bis #351 ein Zahlablauf mit n Belegen

Heute gilt **ein Beleg je Bestellung**, mit `orderId` als Idempotenz-Schlüssel
(`issue-receipt.hook.ts`). Bei n Bestellungen eines Kreises sind das n Belege.

**Ziel: der Sammelbeleg.** Ein Beleg mit `orderIds[]` über mehrere Bestellungen desselben Kreises.
Die Idempotenz wechselt von „ein Beleg je `orderId`“ zu der Invariante aus A13: **Jede Bestellung
steht in höchstens einem nicht-stornierten Beleg.** Der Beleg nennt den Startzeitpunkt der ersten
Bestellung im Klartext (A10, DSFinV-K Tz. 2.7.2). Er braucht einen eigenen Kassenbeleg-Vorgang
der TSE neben den Bestellvorgängen. Das ist genau das Modell aus Anhang H der DSFinV-K und
hängt an [#351](https://github.com/panary/panary-core/issues/351).

**Bis dahin: „Tisch kassieren“.** Ein Zahlablauf an der Kasse schließt alle offenen Bestellungen
des Kreises ab: ein Bezahlvorgang für den Gast, je Bestellung ein `completed` und ein Beleg.
Rechtlich sauber nach dem heutigen Modell, für den Gast unschöner (mehrere Belege). Zwei
Bedingungen:

- **Wiederaufnehmbar.** Bricht der Ablauf nach drei von fünf Bestellungen ab (Akku, Verbindung),
  zeigt der Kreis zwei offene Bestellungen und den gezahlten Teil. Ein zweiter Durchlauf
  kassiert nur den Rest. Der Ablauf ist je Bestellung idempotent, nicht je Kreis.
- **Kein Zusammenfassungs-Ausdruck, der wie ein Beleg aussieht.** Eine Übersicht über alle
  Belege des Tisches ohne Transaktionsnummer und Prüfwert ist erlaubt, eine mit beidem wäre ein
  zweiter Beleg über denselben Umsatz (A13, § 14c UStG).

**Verworfen: Sammelbeleg schon jetzt, nur im Bestellbetrieb.** Gleiche Begründung wie Nr. 3: Er
schüfe Belege, die im Kassenbetrieb nicht entstehen dürfen, solange es keinen
Kassenbeleg-Vorgang gibt.

### 6. Anzeige an der Kasse: eine Karte je Kreis

Der Bediener denkt „Tisch 4“, nicht „Vorgang 3 von 5“. Die Liste „Offen“ zeigt Bestellungen mit
Tisch als **eine Karte je Kreis**: Tisch, Zahl der Bestellungen, Summe, Zeit seit der ersten
Bestellung, aufklappbar auf die einzelnen Bestellungen. Bestellungen ohne Tisch bleiben einzelne
Karten wie heute. Aus der Karte heraus gibt es „Nachbestellen“ und „Tisch kassieren“.

„Nachbestellen“ öffnet die Kasse mit vorbelegtem Tisch und Kreis. Im Abschluss-Ablauf
(`closing-flow.ts`) entfällt dann der Tisch-Schritt. Das ist der einzige Eingriff in
`order-dialog.component.ts`, das per [ADR 0011](0011-order-dialog-monolith.md) bewusst nicht
zerlegt wird: eine Vorbelegung über die bestehenden Eingänge, keine neue Logik im Dialog.

### 7. Bestand und Küche: kein Sonderweg

Eine Nachbestellung ist eine gewöhnliche Bestellung. Die Bestandsbuchung in der Cloud hängt an
der einzelnen Bestellung (`stockBookedAt`), ihre Idempotenz reicht. Die Lücke des Splits, dass
Idempotenz je Bestellung nicht über eine Split-Gruppe schützt, tritt nicht auf, weil nichts
gegengebucht wird. Der Küchenbon druckt wie bei jedem Anlegen nur die Positionen der neuen
Bestellung, im Kopf mit „Nachbestellung“ und dem Tisch.

## Konsequenzen

**Die Release-Reihenfolge gilt auch hier.** Die neue Kreis-Ableitung liegt in
`@panary/orders/domain`. Der Kreis ist ein Feld, das schon existiert, der Push bricht also nicht
am Schema. Ein `orderIds[]` am Beleg (Nr. 5) dagegen ist ein neues Feld auf einem
synchronisierten Datensatz: Core-Release → Cloud-Pin → `api-cloud` → Edges, sonst
TERMINAL-Ablehnung (ADR 0047).

**Die Doppelquelle bleibt verboten.** Ob ein Kreis offen ist, wird immer aus den Bestellungen
gelesen. Wer dafür ein Statusfeld am Tisch oder am Kreis einführt, baut die Stelle, an der zwei
Kassen verschiedener Meinung sind.

**Der Tischplan baut darauf.** Der Live-Status eines Tisches (frei, belegt, wartet) ist dieselbe
Ableitung wie Nr. 2, nur für die Anzeige. Ein Tischwechsel (DSFinV-K Tz. 3.1.2.2,
„Tischverlegungen“) ändert `table`, nicht den Kreis. Nachbestellungen am neuen Tisch erben den
Kreis des alten Besuchs, bis er geschlossen ist. Das ist ein eigenes Vorhaben mit eigener
Custom Method und nicht Teil dieses ADR.

### Nicht entschieden, liegt beim Steuerberater

- **Zwischenrechnung** als Vorgangsende mit Beleg oder als reine Anzeige (Gutachten 9.2 Punkt 3).
  Bis dahin gibt es keine.
- **Erleichterung nach DSFinV-K Tz. 2.7.2** (Kassenbeleg erst beim Bezahlen starten, erste
  Bestellzeit im Klartext auf dem Beleg). Nr. 5 setzt sie für den Sammelbeleg voraus.
- **`processType`-Zuordnung** `AVBestellung` → `Bestellung-V1` (DFKA-Auslegung, Gutachten 9.2
  Punkt 4). Betrifft, wie die n Bestellvorgänge eines Kreises mit TSE signiert werden.
- **Besuchszähler:** ob `<Label>#<n>` die Anforderung „eindeutige Identifikation“ erfüllt oder ein
  Prüfer zusätzlich Datum oder Kassen-ID im Kreis erwartet.

## Umsetzung

Die Folge-Issues sind in PR-Größe geschnitten und tragen ihre Reihenfolge als GitHub-Beziehung:

| Issue | Inhalt | wartet auf |
|---|---|---|
| [#1139](https://github.com/panary/panary-core/issues/1139) | Kreis-Ableitung mit Besuchszähler und Riegel am Edge (Nr. 2, 4) | – |
| [#1140](https://github.com/panary/panary-core/issues/1140) | Nachbestellen mit vorbelegtem Kreis, Referenz `Transaktion` (Nr. 1, 6) | #1139 |
| [#1141](https://github.com/panary/panary-core/issues/1141) | Liste „Offen“: eine Karte je Kreis (Nr. 6) | – |
| [#1142](https://github.com/panary/panary-core/issues/1142) | „Tisch kassieren“: ein Zahlablauf, n Belege, wiederaufnehmbar (Nr. 5) | #1139, #1141 |
| [#1143](https://github.com/panary/panary-core/issues/1143) | Sammelbeleg mit `orderIds[]` und A13-Invariante (Nr. 5) | #351, #1142 |
| [panary/panary-cloud#1475](https://github.com/panary/panary-cloud/issues/1475) | Tisch-Label in der Cloud auf 45 Zeichen begrenzen (Nr. 4) | – |
