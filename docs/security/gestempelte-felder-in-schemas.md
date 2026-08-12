---
type: Architecture
title: Gestempelte Felder gehören ins Schema — auch ins PATCH-Schema
description: Hooks stempeln tenantId und userId vor der Validierung; ein geschlossenes Schema ohne diese Felder lehnt jeden externen Aufruf mit 400 ab — zweimal aufgetreten, beide Male unsichtbar.
tags: [security, notifications, users]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-11T21:51:53Z }
---

# Gestempelte Felder gehören ins Schema — auch ins PATCH-Schema

Die Schemas dieses Repos werden von beiden Backends validiert. Beide setzen ihre
Mandanten-Hooks in `around.all`, also **vor** `validateData` in `before.create` /
`before.patch`. Was ein Hook dort stempelt, steht bei der Validierung schon in
`context.data` — und ein Schema mit `additionalProperties: false`, das das Feld nicht
kennt, lehnt den Aufruf mit **400 „validation failed"** ab, obwohl der Client korrekte
Daten geschickt hat.

## Wer was stempelt

| Hook              | Feld                              | Bei welchen Methoden               |
| ----------------- | --------------------------------- | ---------------------------------- |
| `multiTenancy()`  | `data.tenantId` (ggf. `locationId`, `brandId`) | `create`, `update`, **`patch`** |
| `userScoping()`   | `data.userId`                     | `create`, `update`, **`patch`**     |

`patch` ist der Punkt, an dem die Regel bisher zweimal gerissen ist — sie wird beim
Lesen der Hook-Doku leicht als „gilt fürs Anlegen" gelesen.

## Die Regel

> Trägt ein Schema `additionalProperties: false` und wird sein Service mit
> `multiTenancy()` bzw. `userScoping()` registriert, muss es `tenantId` bzw. `userId`
> deklarieren — im **DATA**- und im **PATCH**-Schema.

**Optional deklarieren, nicht als Pflichtfeld** (`Type.Partial(Type.Pick(...))` bzw.
`Type.Intersect([..., Type.Partial(Type.Pick(...))])`): Der Client soll die Felder
weiterhin nicht senden müssen, und interne Aufrufe ohne Nutzerkontext bleiben möglich.

**`additionalProperties: false` nicht entfernen.** Das ist der kürzere Fix und der
falsche: Danach kämen beliebige Client-Felder durch die Validierung und landeten in der
Collection. Die Felder explizit aufnehmen.

**Das Feld im Schema ist keine Client-Erlaubnis.** Cloud-seitig verwirft der jeweilige
Patch-Resolver `tenantId`/`userId` per `protectFromExternal()`; der Hook-Wert gewinnt
ohnehin gegen alles, was der Client mitschickt. Das Schema wird ausschließlich
hook-verträglich gemacht.

## Warum das kein Test findet

Typecheck, Lint und Build sind grün: Der Widerspruch entsteht erst zur Laufzeit zwischen
Hook und Schema, nicht im Typsystem. Ein Unit-Test, der den Service mockt, sieht ihn auch
nicht — der Mock **ist** der Service, es gibt keine Hook-Kette, die stempeln könnte.

Gefangen wird die Klasse deshalb an zwei Stellen:

* **Laufzeit-Invariante am Schema** (dieses Repo) —
  [`patch-stamp-fields.spec.ts`](../../libs/domains/notifications/domain/src/lib/patch-stamp-fields.spec.ts)
  validiert jedes betroffene Patch-Schema gegen einen Payload, der die Stempel enthält,
  und prüft in derselben Datei die Gegenrichtung: unbekannte Felder müssen weiter
  abgelehnt werden. Ohne die zweite Hälfte wäre der Test auch mit
  `additionalProperties: true` grün — also genau dann, wenn der Schutz weg ist.
* **Registrierungs-Gate** (panary-cloud) — `checkStampFields()` liest das kompilierte
  AJV-Schema beim Service-Aufbau, `stamp-fields-invariant.spec.ts` ist die harte
  Variante mit begründungspflichtiger Ausnahmeliste.

## Vorgeschichte

* **2026-07-27, DATA-Schemas:** `printer-commands`, der komplette Dienstplan-Bereich und
  `push-subscriptions` lagen gleichzeitig lahm — jeder externe Create scheiterte. Fix:
  Felder ins DATA-Schema, danach entstand das Cloud-Gate.
* **2026-08-11, PATCH-Schemas** (panary/panary-core#174, panary/panary-cloud#199):
  Dieselbe Ursache eine Ebene weiter. Das Gate prüfte nur `validators.data`, die
  PATCH-Seite war nie abgedeckt. Betroffen waren `notifications`,
  `notification-preferences` und `push-subscriptions`; sichtbar wurde es als
  Benachrichtigung, die sich nicht wegklicken lässt — das Frontend verschluckte den
  400er in einem leeren `catch` und rollte still zurück.

* **2026-08-12, `sync-conflicts`** (panary/panary-core#183): Dritte Wiederholung, diesmal
  in einem handgeschriebenen Patch-Schema — also außerhalb dessen, wonach die Messung vom
  Vortag gesucht hatte. Aufgefallen beim Pairing eines Edge-Testservers: Der Merge-Modus
  erzeugte einen Personal-Konflikt, und beide Auflösungs-Buttons im Admin-Panel liefen ins
  Leere. Hier war der 400er **nicht** stumm — er stand als „Mandant: must NOT have
  additional properties" im Panel, nur ohne Bezug zum geklickten Button.

Die ersten beiden Male war der Defekt **stumm**: ein 400er, den niemand sah. Die
Fehlerbehandlung im Konsumenten ist deshalb Teil dieser Regel, nicht ihr Beiwerk.

## Bestand (Stand 2026-08-11)

🚨 **Korrektur vom 2026-08-12 — die erste Fassung dieses Abschnitts war falsch.**
Sie behauptete, außer den drei Notifications-Schemas seien alle engen Patch-Schemas
„offen und damit unauffällig". Das stimmt nicht: **`Type.Pick` und `Type.Partial` erben
`additionalProperties: false` vom Quell-Schema**, auch wenn das Options-Objekt nur `$id`
setzt. Die Messung dahinter las die Schema-**Quelle** und suchte dort nach dem Literal —
sie konnte die geerbte Schließung gar nicht sehen. Aufgefallen ist es erst, als das
Cloud-Gate dieselbe Frage am **kompilierten** Schema stellte und sofort elf Services fand
(panary/panary-cloud#199).

Gemessen am kompilierten Schema (`schema.additionalProperties`) sind in `libs/domains/`
**alle** engen Patch-Schemas geschlossen. Ohne `tenantId` sind:

| Schema | `tenantId` | Anmerkung |
| --- | --- | --- |
| `workingTimePatchSchema` | fehlt | Service läuft mit `multiTenancy({ isolateLocation: false })` |
| `syncCursorPatchSchema` | fehlt | Sync-Pfad, meist `skipMultiTenancy` |
| `syncOutboxEntryPatchSchema` | fehlt | dito |
| `fiscalCounterPatchSchema` | ~~fehlt~~ → vorhanden | behoben in panary/panary-core#180 |
| `syncConflictPatchSchema` | ~~fehlte in dieser Liste~~ → vorhanden | behoben in panary/panary-core#183, siehe unten |
| `pairingCodePatchSchema`, `cloudEdgePatchSchema`, `cloudConnectionPatchSchema` | vorhanden | unauffällig |

🚨 **Diese Liste war schon bei ihrer Entstehung unvollständig.** `syncConflictPatchSchema`
hatte denselben Defekt und stand nicht darin — es ist kein abgeleitetes Schema
(`Type.Pick`/`Type.Partial`), sondern ein handgeschriebenes
`Type.Object({ resolution }, { additionalProperties: false })`. Wer nach geerbten
Schließungen sucht, findet es nicht; es trägt sein `additionalProperties: false` selbst.
Am 2026-08-12 fiel es beim Edge-Pairing auf — offene Sync-Konflikte ließen sich über das
Admin-Panel überhaupt nicht auflösen (panary/panary-core#183).

Konsequenz für künftige Messungen: Das Kriterium ist **nicht** „abgeleitetes Schema mit
geerbter Schließung", sondern schlicht `schema.additionalProperties === false` am
kompilierten Schema — unabhängig davon, woher die Schließung kommt.

Der Edge stempelt bei `patch` genauso wie bei `create`
(`libs/shared/backend/src/hooks/multi-tenancy.hook.ts`, `['create','update','patch']`).
Für die vier Schemas ohne `tenantId` heißt das: **ein externer Patch scheitert mit 400.**
Ob das heute jemanden trifft, hängt am Aufrufpfad — interne Aufrufe
(`provider: undefined`) werden nicht gestempelt und laufen durch, und die POS-Zeiterfassung
geht über Custom-Methods statt über einen direkten `working-times`-Patch. **Das ist eine
Vermutung, keine Messung** — sie gehört nachgeprüft, bevor jemand sie als Entwarnung liest.

⚠️ **Mit `grep` ist das nicht messbar**, und zwar in beide Richtungen: Der Literal-Scan
übersieht geerbte Schließungen, und ein `grep -A/-B` über ein Zeilenfenster zieht das
`additionalProperties: false` des **Query**-Schemas fälschlich zum Patch-Schema (so erschien
`fiscalCounterPatchSchema` in einem dritten Messversuch als offen, obwohl es geschlossen
ist). Verlässlich ist nur das kompilierte Schema:

```bash
npx tsx -e "const s = require('./libs/domains/<domain>/domain/src/lib/<x>.schema.ts').<x>PatchSchema
console.log(s.additionalProperties, Object.keys(s.properties))"
```
