---
type: ADR
title: 'Vorgangs-Referenzen als append-only Entität — und warum die Methodenliste sie nicht schützt'
description: 'ADR zur Einführung von order-references nach DSFinV-K Bon_Referenzen (Tz. 4.2.2): append-only auf zwei Schichten, Storno als erster Nutzer, und die gemessene Erkenntnis, dass die Feathers-Methodenliste nur den externen Weg absichert.'
tags: [orders, fiskalisierung, sync, append-only, dsfinv-k]
status: stable
decision: accepted
implementation: 'Umgesetzt 2026-09-24 (#348, Edge). Cloud-Empfang folgt mit panary/panary-cloud#488.'
generated: { by: claude-code/opus-5, at: 2026-09-24T06:20:00Z }
---

# Vorgangs-Referenzen als append-only Entität

## Problem

DSFinV-K Tz. 4.2.2 formuliert es als Muss: „Um einen Bezug zum ursprünglichen Vorgang zu
ermöglichen, **muss** ein Datensatz in der Datei `Bon_Referenzen` angelegt werden." Im Code
gab es dafür keine Struktur. Die einzige Provenienz-Referenz an der Bestellung war
`preOrderId` für Vorbestellungen — für Storno, Split und Umbuchung existierte nichts.

Das Rechtsgutachten zu [#345](https://github.com/panary/panary-core/issues/345) (10.3 Punkt 4)
hält zusätzlich fest, dass sich historische Bezüge nachträglich **nicht** rekonstruieren
lassen. Wer die Referenz nicht im Moment des Vorgangs schreibt, bekommt sie nie mehr.

## Entscheidung

Eine eigene Entität `order-references` (`@panary/order-references`, publishable, damit die
Cloud sie als Sync-Ziel importieren kann), append-only, mit dem Storno als erstem Nutzer.

### 1. `targetOrderId` bleibt beim Storno leer

`sourceOrderId` ist der referenzierte Vorgang (DSFinV-K `REF_BON_ID`) und immer gesetzt.
`targetOrderId` ist der Vorgang, der die Referenz erzeugt — und beim Storno gibt es ihn
nicht: Ein Storno legt keine neue Bestellung an, er setzt die bestehende auf `ABORTED`.
Ein Selbstverweis auf `sourceOrderId` wäre bequem und wäre eine Aussage über die Datenlage,
die nicht stimmt. Beim Split ist es die neu entstandene Teilbestellung.

### 2. Jeder Storno-Versuch schreibt seine eigene Referenz

Append-only heißt append-only: Das Journal bildet ab, was passiert ist, nicht den
Endzustand. Eine Idempotenz-Prüfung („pro Bestellung höchstens eine Storno-Referenz")
würde einen abgebrochenen ersten Versuch unsichtbar machen.

⚠️ **Ehrlich dazu: Praktisch ist ein Zweitversuch am Edge kaum auslösbar.** Die
Status-FSM (`validateOrderStatusTransition`) sperrt `ABORTED → *`. Ein zweiter Storno
über den regulären Weg kommt gar nicht erst am Hook an. Die Entscheidung ist damit
vor allem eine über interne Aufrufe und künftige Pfade — nicht eine, deren Wirkung
heute beobachtbar wäre. Das steht hier, damit niemand später aus der Regel schließt,
es sei ein Verhalten geprüft worden, das nie auftritt.

### 3. Der schreibende Hook ist nicht blockierend

`recordCancellationReference()` fängt jeden Fehler und loggt ihn mit eigenem
`event`-Feld (`order.cancellation_reference_failed`). Konsistent zu den TSE-Hooks
(§146a, „nie blockierend"): Ein fehlgeschlagener Referenz-Schreibvorgang darf den
Storno nicht scheitern lassen und damit die Kasse sperren.

🚨 **Der Preis ist bekannt und bewusst bezahlt:** Ein Fehler steht nur im Log. Wer
Vollständigkeit der Referenzen prüfen will, prüft das Log auf dieses Event, nicht die
Tabelle auf Lücken — eine fehlende Referenz sieht in der Tabelle aus wie „gab es nicht".

### 4. Append-only auf zwei Schichten — und die Schichtung ist nicht die naheliegende

Der Service registriert `methods: ['find', 'get', 'create']`; die Migration legt
zusätzlich SQLite-Trigger gegen `UPDATE`/`DELETE` an.

🚨 **Am 2026-09-24 gemessen, gegen die eigene Erwartung:** Die Methodenliste schützt
**nur den externen Weg**. Ein interner Aufruf — `{ provider: undefined }`, also genau
der Weg von Hooks, Seeds und Workern — läuft durch die Methodenliste hindurch und wird
**einzig vom DB-Trigger** gestoppt (`patch` wirft `SqliteError`, `remove` einen
`GeneralError`).

Aufgefallen ist das nur, weil eine Mutationsprobe grün blieb: `patch`/`remove` in
`methods` ergänzt → 12/12 Tests weiterhin grün, weil der Aufruf trotzdem scheiterte,
nur eine Schicht tiefer. Ein `rejects.toThrow()` kann das nicht unterscheiden.

**Folge für die Praxis:** Der Trigger ist nicht die „zusätzliche" Absicherung, sondern
die einzige, die intern greift. Wer ihn für einen Cleanup-Job droppt, öffnet den Service
für jeden internen Schreibzugriff, ohne dass eine Methodenliste etwas davon merkt.

### 5. Zwei Felder sind optional — beide aus gemessenem Anlass

- **`refBusinessDayId`**: `order.businessDayId` ist ebenfalls optional (Standalone-Modus
  ohne Geschäftstag). Als Pflichtfeld wäre der Referenz-Create an `validateData`
  gescheitert — und weil der Hook best-effort ist, **lautlos**.
- **`targetOrderId` und `refBusinessDayId` tragen einen `Type.Null()`-Zweig**: SQLite
  liefert ungesetzte Spalten als `null` zurück, und der Sync-Push schickt den Record
  unverändert an die Cloud. Ohne den Null-Zweig verwürfe die Cloud ihn, und
  `classifyAcceptError` stuft das als **TERMINAL** ein — Outbox `rejected`, kein Retry,
  kein Alarm. Gleiche Konstruktion wie `order.stockBookedAt`, aus demselben Grund.

### 6. Sync-Richtung: Edge → Cloud

`ORDER_REFERENCES` steht im `SyncableTransactionService`, dieselbe Richtung wie `orders`.
Ein Pull zurück würde beim Bootstrap/Restore Referenzen überschreiben, die am Edge bereits
stehen (`sync-apply.ts`).

## Konsequenzen

- Die Zahl der publishable Libs steigt von 39 auf **40**. Der Release-Prozess bumpt sie
  mit (`bump-version.mjs` liest die Liste aus den `publishable`-Tags), und die Gates, die
  die Menge gegen nx abgleichen, müssen 40 sehen.
- **Der Cloud-Empfang fehlt noch.** `order-references` braucht einen eigenen Eintrag in
  `apps/api-cloud/src/services/sync/sync-allowlist.ts`, sonst lehnt die Cloud den Push ab
  — terminal, ohne Alarm. Das ist Teil von
  [panary/panary-cloud#488](https://github.com/panary/panary-cloud/issues/488) und muss
  **vor** dem Edge-Rollout in Prod stehen (Reihenfolge wie bei `settlementScope`:
  Core-Release → Cloud-Pin → Cloud-Deploy → Edge).
- Split und Umbuchung nutzen denselben Pfad und legen `targetOrderId` dann. Die
  `refType`-Werte `Split` und `Umbuchung` sind bereits im Enum, damit das Schema nicht
  noch einmal wandern muss ([#349](https://github.com/panary/panary-core/issues/349)).
- Ein Cleanup-Job auf dieser Tabelle gibt es nicht und soll es nicht geben. Käme er,
  müsste er die Trigger droppen — und ab dem Moment wäre der interne Weg ungeschützt
  (siehe Entscheidung 4).
