---
type: ADR
title: Konflikt-Auflösung wendet an, bevor sie als gelöst gilt
description: Warum der Sync-Konflikt-Apply als Before-Hook läuft, den Cloud-Record auf das Patch-Schema des Ziels reduziert und das Ergebnis nachkontrolliert, statt Fehlschläge zu loggen.
tags: [sync, edge, working-times]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-12T21:30:00Z }
---

# Konflikt-Auflösung wendet an, bevor sie als gelöst gilt

## Problem

Beim Sichttest am 2026-09-12 (lokal gefahrener Edge auf `8471d2b2`) meldete „Online-Version
uebernehmen" auf einem offenen Sync-Konflikt **Erfolg und wendete nichts an**: `PATCH
/sync-conflicts/<id>` antwortete 200, die Zeile verschwand aus der Liste, der Zähler
„Datenkonflikte" fiel — und der Zieldatensatz trug unverändert seinen alten Wert. Die einzige
Spur war ein `logger.warn` (`sync.conflict.apply_failed`, `errorMessage: "validation failed"`),
den niemand liest.

Die Untersuchung fand **drei** Ursachen übereinander, von denen jede allein den Pfad gekippt
hätte:

1. **`cloudPayload` kam als JSON-String zurück.** Die Spalte ist `text`
   (`20260502000002_sync_conflicts`), aber `sync-conflicts` registrierte keine
   `getJsonFieldHooks` — Knex serialisiert beim Schreiben und liefert beim Lesen einen String.
   `(result.cloudPayload as { _id }).._id` war damit `undefined`; der Apply lief als
   **Multi-Patch mit einem String als Data** und starb an AJV. Das war der Fehler, den der
   Sichttest tatsächlich gesehen hat.
2. **Das PATCH-Schema des Ziels ist enger als der Cloud-Record.** `working-times` erlaubt fünf
   Felder (`checkoutDate`, `originCheckoutDate`, `breaks`, `updatedBy`, `tenantId`), der
   Cloud-Record trägt dreizehn — `additionalProperties: false` lehnt den Rest ab.
3. **Der Fehlschlag war unsichtbar.** Das Anwenden lief als `after.patch`-Hook mit `try/catch`.
   Der Konflikt stand zu diesem Zeitpunkt bereits auf `status=resolved, resolution=use-cloud`,
   und der Fehler wurde verschluckt.

Ursache 3 ist die gefährlichste und unabhängig von den anderen beiden: Sie erzeugt einen
`resolved`-Zustand, hinter dem nichts passiert ist. Ein Bestandskonflikt mit
`status=resolved, resolution=use-cloud` ist nachträglich **nicht** in „angewandt" und „nicht
angewandt" unterscheidbar.

Zwei weitere Fälle derselben Klasse fielen dabei auf:

* Der Guard `if (!result.resolution || !result.cloudPayload) return` übersprang **auch**
  „Verwerfen", wenn kein Cloud-Stand gespeichert war. Bootstrap-Konflikte legen
  `cloudPayload: null` an — dort wurde der Edge-Record nie gelöscht, der Konflikt galt
  trotzdem als erledigt.
* Der Rückfall `.catch(() => create(vollerRecord))` hinter dem Patch legt bei `working-times`
  einen **neuen** Datensatz an: `workingTimeDataResolver._id` ist `() => uuidv7()`,
  `checkoutDate` wird auf `null` gesetzt. Aus „Cloud-Stand wiederherstellen" wurde ein zweiter,
  halb leerer Eintrag.

## Entscheidung

**1. Anwenden vor dem Statuswechsel.** Der Apply läuft als `before.patch`-Hook. Schlägt er
fehl, scheitert der ganze Patch, der Konflikt bleibt `open`, und das Admin-Panel zeigt die
Meldung (`formatApiError` reicht `message` durch, `errors()` rendert sie, die Zeile bleibt
stehen, weil sie nur bei Erfolg entfernt wird). Die umgekehrte Fehlerrichtung — Apply gelingt,
Statuswechsel scheitert — ist die harmlose: Der Konflikt bleibt offen, ein zweiter Klick
wiederholt einen idempotenten Patch.

`sync.conflict.apply_failed` bleibt als Log-Event bestehen, aber **nie mehr allein**: Es wird
immer zusammen mit einem Fehler an den Aufrufer geschrieben.

**2. Der Apply passt sich an das Schema an, nicht umgekehrt.** Der Cloud-Record wird vor dem
Patch auf die Felder des Ziel-Patch-Schemas reduziert. Die Patch-Schemas werden **nicht**
aufgeweitet, damit der Apply durchläuft — ihre Enge ist Absicht (`_id`, `userId`,
`checkinDate` sollen extern nicht änderbar sein, `.claude/rules/security.md` §8).

Das Schema kommt aus dem markierten Validierungs-Hook (`hooks/validate-data.hook.ts`, #267),
gelesen über `services/schema-shape.ts` — dieselbe Implementierung, die der Boot-Check
`assert-stamp-fields.ts` benutzt. Ist kein Schema lesbar oder ist es offen, wird der Record
unverändert durchgereicht: Dort kann ein Zusatzfeld nicht zum 400 führen.

**3. Nachkontrolle statt Vertrauen.** Nach dem Patch wird der Zieldatensatz erneut gelesen und
gegen den Cloud-Stand verglichen. Bleibt ein Feld zurück, gilt die Auflösung als
**fehlgeschlagen** — ein teilweise angewandter Cloud-Stand ist kein „überwiegend gelungen".
Verglichen wird nur, was es lokal überhaupt gibt (Cloud-only-Felder wie `_deletedAt` sind
erwartete Modelldifferenz), mit zwei Normalisierungen: SQLite-Booleans (`0`/`1`) gelten als
Booleans, `undefined` und `null` als gleich.

Bewusst ausgenommen sind die serverseitigen Stempel `createdAt`, `updatedAt` und `updatedBy`.
`updatedBy` gehört dazu, weil `workingTimePatchResolver` es auf den aufrufenden User setzt —
ohne die Ausnahme scheiterte jede Auflösung, bei der in der Cloud jemand anderes zuletzt
geschrieben hat, also der Normalfall eines Concurrent-Write-Konflikts. Bei `users` kommen die
gerätelokalen Time-Clock-Pointer (`USER_EDGE_LOCAL_FIELDS`) dazu: Sie dürfen die
Edge-Cloud-Grenze nie überqueren (Null-Clear-Deadlock) und dürfen die Auflösung deshalb auch
nicht scheitern lassen.

**4. Kein Create-Fallback.** Fehlt der Zieldatensatz lokal, wird die Auflösung abgelehnt statt
geraten. „Verwerfen" bleibt der Weg, den Konflikt zu schließen.

**5. `fromSync: true` auf dem USE_CLOUD-Pfad**, identisch zum regulären Pull-Apply
(`sync-apply.ts`): Der Wert kommt aus der Cloud und darf nicht als Outbox-Eintrag dorthin
zurück (Sync-Echo); `users` re-hasht sonst den bereits gehashten Cloud-Passwort-Hash.
„Verwerfen" läuft weiterhin **ohne** `fromSync` — es ist eine lokale Entscheidung des
Operators, und die Push-Semantik dieses Pfades bleibt unverändert.

## Konsequenzen

* **Eine Auflösung kann jetzt scheitern, und das ist der Punkt.** Wo vorher still nichts
  passierte, steht jetzt eine Fehlermeldung mit den betroffenen Feldnamen. Ein dauerhaft
  unpatchbarer Cloud-Record lässt sich per USE_CLOUD nicht auflösen — „Diesen Standort
  behalten" und „Verwerfen" bleiben verfügbar. Ein eigener Konflikt-Status `failed` wurde
  bewusst **nicht** eingeführt: Er wäre eine Schema-Erweiterung in `@panary/sync` (Pin-Zyklus)
  für einen Zustand, den die Fehlermeldung plus offener Konflikt schon abbilden.
* **„Verwerfen" löscht jetzt auch bei Bootstrap-Konflikten.** Das ist die dokumentierte
  Absicht des Pfades, war aber bis hierher wirkungslos — beim ersten Einsatz nach dem Release
  verschwinden also Datensätze, die vorher liegen blieben.
* **Reichweite ist gemessen, nicht geschätzt.** Von den sieben push-fähigen Services
  (`SyncableTransactionService`) hat genau einer ein engeres, geschlossenes Patch-Schema:
  `working-times`. `cash-sessions` ist offen, `audit-events` kennt gar keinen externen Patch,
  bei `orders`/`receipts`/`order-interactions`/`users` decken sich Patch- und Data-Felder.
  Festgehalten in `apply-scope.spec.ts`: Verengt sich ein weiteres Schema, wird die Spec rot.
* **Der Schema-Leser ist jetzt geteilte Infrastruktur** (`services/schema-shape.ts`). Boot-Check
  und Apply stellen dieselbe Frage; zwei Implementierungen wären zwei Gelegenheiten,
  auseinanderzulaufen — und die Abweichung fiele niemandem auf, weil beide Seiten still bzw.
  grün blieben.
* **Nicht rekonstruierbar bleibt die Vergangenheit.** Ob es in Produktion bereits
  USE_CLOUD-Auflösungen gab, die nichts angewandt haben, ließe sich nur über
  `sync.conflict.apply_failed` in alten Edge-Logs sehen — die rotieren.

## Verwandt

* [Gestempelte Felder gehören ins Schema](../security/gestempelte-felder-in-schemas.md) — der
  Boot-Check und das harte Gate, aus denen der Schema-Leser stammt.
* [ADR 0027 — Merge beim Bootstrap nur mit externalId](0027-merge-bootstrap-nur-mit-externalid.md) —
  erzeugt die Bootstrap-Konflikte, deren „Verwerfen" hier repariert wurde.
