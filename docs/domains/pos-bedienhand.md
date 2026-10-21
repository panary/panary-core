---
type: Domain Concept
title: Bedienhand am POS (posHandedness)
description: Wie ein Mitarbeiter seine Bedienhand an der Kasse trägt — Feld posHandedness ohne Null und ohne Default, Auflösung „fehlt = links", Self-Patch, Edge-Spalte, Sync-Pfad und die Release-Reihenfolge mit der Cloud.
tags: [users, pos-client, api-edge, sync, security]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-22T00:00:00.000Z }
---

Ein Mitarbeiter bestimmt, auf welcher Seite der Kasse der Warenkorb sitzt. Linkshänder
bekommen ihn links, alle anderen können ihn nach rechts legen. Das Feld ist der Daten-Teil
des POS-Redesigns (Anker panary/panary-core#819). Eingeführt wurde es mit
panary/panary-core#827, die Cloud folgt mit panary/panary-cloud#1437, die Umschaltung am
POS mit panary/panary-core#833.

## Feld und Auflösung

| Was | Wo |
|---|---|
| `posHandedness: 'left' \| 'right'`, optional | `userSchema`, `userDataSchema`, `userPatchSchema` in `libs/domains/users/domain/src/lib/user.schema.ts` |
| Werte-Konstante `PosHandedness` | ebenda |
| Default und Auflösung `resolvePosHandedness(user)` | `libs/domains/users/domain/src/lib/pos-handedness-policy.ts` |
| Self-Patch erlaubt | `SELF_PATCHABLE_FIELDS` in `self-patch-policy.ts` |
| Edge-Spalte `users.posHandedness` (nullable, ohne Default) | `apps/api-edge/migrations/20261021120000_users_add_pos_handedness.ts` |

**Fehlt der Wert, gilt links.** So sitzt der Warenkorb für Bestands-Mitarbeiter wie vor dem
Feld, rechts gibt es nur nach eigener Wahl (Entscheidung im Anker #819; der Plantext von
#827 nannte noch „rechts" und ist damit überholt). Jeder Leser holt den wirksamen Wert über
`resolvePosHandedness`. Die Funktion nimmt `unknown`, weil der Wert durch SQLite läuft:
Eine leere Spalte kommt als `null`, ein Sitzungs-Record von vor dem Update kennt das Feld
gar nicht, und beides ergibt links statt eines kaputten Layouts.

### Warum String, ohne Null, ohne Default

- **String statt Boolean.** SQLite liefert Booleans als `0`/`1`; jeder Leser bräuchte eine
  Coercion (Muster `isAutoLogOffEnabled`).
- **Kein `Null` in der Union.** Ein `null`-Clear verwirft die Cloud per `stripNulls`, der
  nächste Pull holte den alten Wert zurück (Null-Clear-Deadlock). „Nicht gewählt" heißt
  deshalb „Feld fehlt". Das Schema lehnt `null` ab, Test in `user.schema.spec.ts`.
- **Kein Spalten-Default.** Ein Default `'left'` schriebe jedem Bestands-User einen Wert zu,
  den niemand gewählt hat. Der ginge mit dem nächsten Push in die Cloud, und eine Cloud ohne
  das Feld lehnte diesen Push ab.

## Self-Patch

`posHandedness` steht in `SELF_PATCHABLE_FIELDS`: vom Nutzer selbst gesetzt, trägt keine
Rechte. Ein Mitarbeiter darf es am **eigenen** Datensatz ändern; fremde Datensätze und
Eskalationsfelder (`role`, `permissions`, `tenantId`, Filialen) bleiben gesperrt. Die
Fehlermeldung zählt die erlaubten Felder auf und nennt das neue Feld mit.

Mit #827 ist am Edge ein vorbestehender Defekt behoben: `multiTenancy()` stempelt
`tenantId` in `around.all` in den Patch-Body, **bevor** `restrictUserSelfPatch` läuft. Die
Policy sah das Feld in jedem Self-Patch und lehnte ihn mit 403 ab. Der Edge-Hook nimmt den
Stempel jetzt heraus, wenn er gleich dem eigenen Mandanten ist; ein abweichender bleibt im
Body und wird abgewiesen. Dieselbe Lücke hatte panary/panary-cloud#1021 in der Cloud
geschlossen (`withoutServerStamp`).

⚠️ **Der POS-Client meldet sich als Gerät an**, nicht als Mitarbeiter (`device:<id>`). Ein
regulärer `patch` vom Terminal scheitert deshalb an `FOREIGN_RECORD`, wie beim PIN-Wechsel
(`changePin`). Das Umschalten am POS (#833) braucht einen eigenen Weg, der die Person hinter
dem Terminal bindet; der Self-Patch deckt die persönliche Anmeldung ab.

## Sync

| Richtung | Verhalten |
|---|---|
| Edge → Cloud, Bootstrap | leere Spalte (`null`) fällt per `stripNonNullableNulls` weg, gesetzter Wert geht mit |
| Edge → Cloud, live (Outbox) | voller Record mit `posHandedness`; `null` streicht die Cloud per `stripNulls` vor der Validierung, wie bei `email` |
| Cloud → Edge, Pull-Apply | patcht die Spalte bedingungslos mit dem Cloud-Wert (kein Last-Write-Wins) |

### Release-Reihenfolge

Beide Seiten validieren User mit `additionalProperties:false`, das Feld muss also auf beiden
Seiten bekannt sein, bevor es irgendwo **gesetzt** wird:

- **Edge pusht einen Wert an eine Cloud ohne das Feld** → die Cloud lehnt den User-Patch
  terminal ab, samt eines im selben Record steckenden PIN-Wechsels. Weil der Push immer den
  vollen Record schickt, gilt das danach für **jeden** weiteren Push dieses Mitarbeiters.
- **Cloud schickt einen Wert an einen Edge ohne #827** → der Pull-Apply lehnt den User ab
  (Schema und fehlende Spalte).

Solange niemand das Feld setzt, ist jede Kombination unschädlich: Bis #833 und das
Cloud-Formular (#1437) gibt es keine Oberfläche dafür. **Die Cloud-Hälfte (#1437) muss vor
dem core-Release mit #833 ausgerollt sein**, und das Cloud-Formular darf erst Werte schreiben,
wenn die Edges #827 tragen.

## Nicht abgedeckt

- **Pull-Apply ist bedingungslos** (`user.schema.ts`, `USER_EDGE_LOCAL_FIELDS`-Kommentar):
  Kommt ein Cloud-Pull vor dem Push der lokalen Änderung an, überschreibt er sie mit dem
  alten Wert, wie bei `posPin`. Sichtbar nur bei wackligem Netz.

## Verwandt

- [POS-PIN: erzwungener Wechsel](../security/pos-pin-erzwungener-wechsel.md) — dieselbe
  Release-Reihenfolge Cloud vor core, dasselbe Geräte-Login-Problem
- [POS-Auto-Logout](pos-auto-logout.md) — Muster für ein SQLite-festes Lesen eines User-Felds
