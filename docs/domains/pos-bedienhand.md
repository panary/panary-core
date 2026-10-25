---
type: Domain Concept
title: Bedienhand am POS (posHandedness)
description: Wie ein Mitarbeiter seine Bedienhand an der Kasse trägt und am POS umschaltet — Feld posHandedness ohne Null und ohne Default, Auflösung „fehlt = links" (= Rechtshänder, Bezeichnung seit core#1063), Self-Patch, Methode setPosHandedness über das Bediener-Token, Offline-Nachsenden, Sync-Pfad und die Release-Reihenfolge mit der Cloud.
tags: [users, pos-client, api-edge, sync, security]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-25T18:30:00.000Z }
---

Ein Mitarbeiter bestimmt, auf welcher Seite der Kasse der Warenkorb sitzt. Rechtshänder
haben ihn links und die Rail rechts, Linkshänder umgekehrt (Zuordnung seit core#1063, siehe unten). Das Feld ist der Daten-Teil
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
(`changePin`). Der Self-Patch deckt die persönliche Anmeldung ab; am Terminal gilt der Weg unten.

## Bezeichnung und Wert (seit core#1063)

Der Wert ist die **Seite des Warenkorbs**, die Bezeichnung im Menü die Hand des Mitarbeiters:

| Gespeichert | Warenkorb | Rail | Menü |
|---|---|---|---|
| `left` (auch: Feld fehlt) | links | rechts | Rechtshänder |
| `right` | rechts | links | Linkshänder |

Bis core#1063 hieß `left` „Linkshänder". Michael stellte im Test auf der Sunmi-Kasse (2026-10-25) fest, dass das
seiner Regel widerspricht: Rechtshänder wollen den Warenkorb links und die Rail rechts. Getauscht wurde **nur die
Bezeichnung**, nicht der Wert. Ein gedrehter Wert hätte das Layout jedes Mitarbeiters gekippt, der schon gewählt
hatte. Wer nie gewählt hat, steht damit im Rechtshänder-Layout. Die Zuordnung steht in `HAND_OPTIONS`
(`libs/apps/pos-client/shell/src/lib/navigation/pos-navigation.ts`), die Spec `pos-navigation.spec.ts` prüft
Beschriftung (de/en/tr), Warenkorb-Seite aus den Grid-Areas der Kasse und Rail-Seite zusammen.

## Umschalten am POS (seit #833)

Avatar-Menü der Rail → „Rechtshänder"/„Linkshänder" (seit core#942, vorher „Warenkorb-Seite"). Kasse und
Rail spiegeln sofort — die Rail sitzt dem Warenkorb gegenüber ([POS-Navigation](pos-navigation.md)) —, gespeichert wird am Edge
über die Custom-Method **`users.setPosHandedness({ posHandedness })`**.

| Regel | Umsetzung |
|---|---|
| Person allein aus dem Bediener-Token | Ziel ist `params.posOperator.userId` (Token aus `verifyPin`, geprüft gegen Signatur, Gerät, Mandant, Kontostatus, 12 h; ADR 0053). Eine `userId` im Body gibt es nicht |
| Fail-closed | ohne Token oder mit abgelehntem Token `401`; anders als bei `orders`, wo ein ungültiges Token den Aufruf durchlässt |
| Nur dieses eine Feld | jeder andere Schlüssel im Body und jeder Wert außer `left`/`right` → `400` |
| Mandant | zusätzlich `checkCallerOwnsRecord` gegen das Gerät, obwohl das Token schon gebunden ist |
| Recht des Geräts | Ability `CAN_SET_POS_HANDEDNESS` (DEVICE_POS, DEVICE_TABLET) über ein eigenes Methoden-Set in `authorize()` — kein `users:UPDATE`, kein Durchgriff auf `patch` oder `changePin` |
| Schreiben | interner `users.patch` (Validator, Resolver, Sync-Outbox), danach sofortiger Sync-Lauf wie bei `changePin`; Audit `UPDATE`/`CONFIGURATION` |

Code: `apps/api-edge/src/services/users/users.ts` (`setPosHandedness`),
`libs/shared/backend/src/hooks/authorize.hook.ts` (`HANDEDNESS_METHODS`),
`libs/domains/users/data-access/src/lib/services/pos-handedness.service.ts` (Client),
`libs/apps/pos-client/shell/src/lib/shell/pos-account-panel.ts` (Menüeintrag).

### Offline und Nachsenden

Die Offline-Outbox der Bestellungen trägt `users` nicht (`pos-outbox-replay.service.ts` kennt nur
`orders` und `pre-orders`). `PosHandednessService` hält die Wahl deshalb selbst:

- Offline oder bei einem Verbindungsfehler (kein Status, `408`, `5xx`) wird die Wahl mit dem
  **Bediener-Token ihrer Sitzung** in `localStorage.pnry_pos_handedness_pending` gemerkt. Die
  Kasse spiegelt trotzdem sofort.
- Die Shell sendet gemerkte Wahlen nach, sobald der Edge wieder erreichbar ist — jede mit ihrem
  eigenen Token, nicht mit dem des gerade Angemeldeten. Hat inzwischen jemand anderes übernommen,
  bleibt die Zuordnung richtig.
- Endgültig verloren ist eine Wahl nur, wenn der Edge sie selbst verwirft: `400` oder die
  gekennzeichnete Token-Ablehnung der Methode (`NotAuthenticated` mit `data.reason:
  POS_OPERATOR_REQUIRED`, etwa Token nach 12 h abgelaufen). Ein `401` der abgelaufenen
  Geräte-Sitzung zählt nicht dazu — die Wahl bleibt gemerkt.
- **Nur lokal (core#964):** Fehlt das Bediener-Token (abgelaufen, Edge ohne Token-Ausgabe) oder kennt der
  Edge die Methode nicht (`404`/`405`, Edge vor v26.10.26), wirkt die Wahl trotzdem sofort. Sie wird
  in `localStorage.pnry_pos_handedness_local` gehalten (überlebt Neuladen und schlägt den Datensatz),
  der Bediener bekommt einen Hinweis. Ein späteres erfolgreiches Speichern räumt den Eintrag ab. Vorher
  warf `choose` ohne Token, bevor etwas umschaltete — der Schalter wirkte dann gar nicht.
- Eine neue Wahl wartet auf ein laufendes Nachsenden; sonst käme der ältere Wert zuletzt an.
- Bis zum Neuladen gewinnt die Wahl dieser Sitzung über den geladenen Datensatz: Die Kasse hält
  den Mitarbeiter als Momentaufnahme. Ändert ein Admin den Wert in der Cloud, sieht der POS ihn
  nach dem nächsten Login.

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

- **Offline länger als die Token-Laufzeit:** Eine gemerkte Wahl, die erst nach 12 h nachgesendet
  wird, lehnt der Edge ab; sie verfällt still, die Kasse zeigt danach wieder den gespeicherten Wert.
- **Pull-Apply ist bedingungslos** (`user.schema.ts`, `USER_EDGE_LOCAL_FIELDS`-Kommentar):
  Kommt ein Cloud-Pull vor dem Push der lokalen Änderung an, überschreibt er sie mit dem
  alten Wert, wie bei `posPin`. Sichtbar nur bei wackligem Netz.

## Verwandt

- [POS-PIN: erzwungener Wechsel](../security/pos-pin-erzwungener-wechsel.md) — dieselbe
  Release-Reihenfolge Cloud vor core, dasselbe Geräte-Login-Problem
- [POS-Auto-Logout](pos-auto-logout.md) — Muster für ein SQLite-festes Lesen eines User-Felds
