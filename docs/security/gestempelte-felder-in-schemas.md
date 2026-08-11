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

Beide Male war der Defekt **stumm**: ein 400er, den niemand sah. Die Fehlerbehandlung im
Konsumenten ist deshalb Teil dieser Regel, nicht ihr Beiwerk.

## Bestand (Stand 2026-08-11)

Geschlossene **und** enge Patch-Schemas gibt es in `libs/domains/` genau drei — die drei
Notifications-Schemas oben; alle deklarieren die Stempelfelder seit
panary/panary-core#174. Alle übrigen engen Patch-Schemas (`working-times`,
`edge-pairing`, `sync`, `tse`, `cloud-connection`, `cloud-edges`) sind offen und damit
unauffällig; die vollen `Type.Partial(<schema>)`-Varianten (`tenants`, `brands`,
`reservations`, …) erben `tenantId` ohnehin.

⚠️ **Mit `grep` allein ist das nicht messbar.** Die Deklaration ist mehrzeilig, und das
`additionalProperties: false` der **Query**-Schemas steht wenige Zeilen darunter — ein
`grep -A/-B` über das Fenster zieht es fälschlich zum Patch-Schema. Genau so erschien
`fiscalCounterPatchSchema` in einem ersten Messversuch als betroffen, obwohl es offen ist.
Wer nachzählt, parst pro Datei den Block zwischen zwei `export const` und prüft
`Type.Pick(` **und** `additionalProperties: false` innerhalb desselben Blocks — oder liest
die Treffer einzeln nach.
