---
type: ADR
title: ARCHIVED sperrt den Edge-Login — mit Ausnahme für nie gepushte Rollen
description: Der Status ARCHIVED verhindert am Edge Passwort- und PIN-Login und blendet den Mitarbeiter aus der POS-Personalauswahl aus; die Cloud-Reconciliation nimmt Rollen der Push-Blockliste von der Archivierung aus.
tags: [security, authentication, sync, users]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-12T00:00:00Z }
---

# `ARCHIVED` sperrt den Edge-Login — mit Ausnahme für nie gepushte Rollen

## Problem

`reconcileStaleUsers` (`apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts`) setzt lokale
User auf `status: ARCHIVED`, sobald ihre `_id` nicht im Visibility-Snapshot der Cloud steht.
Der Kommentar dort beschrieb die Wirkung als „blendet sie nur aus POS-Login und
Admin-User-Liste aus".

**Diese Wirkung gab es am Edge nicht.** `ARCHIVED` kam in `apps/api-edge/src/` ausschließlich
im Scheduler selbst vor — kein Guard in `authentication.ts`, kein Filter im `users`-Service,
keiner in den Clients. Am laufenden Edge nachgemessen (2026-08-12, gebautes Artefakt, Dev-DB-Kopie):

| Prüfung | User `ACTIVE` | User `ARCHIVED` |
|---|---|---|
| `POST /authentication` (E-Mail/Passwort) | 201 | **201** |
| `verifyPin` (POS-PIN) | 200 | **200** |
| POS-Personalauswahl (Geräte-Sicht) | erscheint | **erscheint** |
| Bereits offene Sitzung | — | **bleibt gültig** |

Die Cloud kennt die Prüfung seit M2 (`apps/api-cloud/src/authentication.ts`); nur der Edge
hatte sie nie. Ein Betreiber, der in der Cloud einen Mitarbeiter entfernt, durfte also
annehmen, dass dieser sich am POS nicht mehr anmelden kann — er konnte es.

Der Guard allein wäre allerdings gefährlicher als die Lücke. `TENANT_OWNER` steht in
`SYNC_PUSH_BLOCKED_USER_ROLES` (`libs/domains/users/domain/src/lib/user.schema.ts`) und wird
nie zur Cloud gepusht. Ein Edge-lokaler Owner kann dort kein Pendant haben, steht also **nie**
im Visibility-Snapshot — `reconcileStaleUsers` archiviert ihn beim ersten Initial-Pull nach dem
Pairing garantiert, nicht nur im Ausnahmefall. Nach [ADR 0027](0027-merge-bootstrap-nur-mit-externalid.md)
bleiben genau diese verwaisten Owner-Konten nach einem Merge-Bootstrap bewusst stehen, weil sie
der einzige Zugang zum Edge-Panel sein können. Ein Guard ohne Ausnahme hätte sie stillgelegt.

Dass das kein konstruierter Fall ist, zeigte die lokale Dev-DB: Sie enthielt bereits ein
`admin | ARCHIVED | tenant:owner` — folgenlos nur deshalb, weil `ARCHIVED` nichts bewirkte.

## Entscheidung

**1. Die Reconciliation nimmt Rollen der Push-Blockliste aus.** Die Auswahl liegt als reine
Funktion in `apps/api-edge/src/workers/stale-user-reconciliation.ts`. Begründung ist nicht
„Owner sind wichtig", sondern: Wer nie gepusht wird, dessen Abwesenheit im Snapshot ist eine
Tautologie und trägt keine Information. Die Ausnahme ist deshalb an
`SYNC_PUSH_BLOCKED_USER_ROLES` gebunden, nicht an eine Kopie der Rollenliste — eine Spec hält
die Kopplung fest.

**2. `ARCHIVED` sperrt jeden Anmeldeweg.** `isLoginBlockedByStatus`
(`apps/api-edge/src/utils/user-login-status.ts`) wird an drei Stellen ausgewertet:

- **JWT-Strategy** — sessionwirksam, weil die Strategy das Entity pro Request frisch lädt.
  Eine offene POS-Sitzung endet damit sofort statt erst mit dem Token.
- **Local-Strategy** — nach dem Passwort-Vergleich. Ein vorgezogener Check wäre ein
  Existenz-Oracle.
- **`verifyPin` / `changePin`** — eigener Pfad: Das Gerät ist der Authentifizierte, die
  Auth-Strategie läuft dort nicht. Ablehnung wortgleich mit „PIN ungueltig" und mit
  mitlaufendem Fehlversuchs-Zähler, wie in `restrict-device-access-mode.hook.ts`; der
  Klartext-Grund steht im Log.

Ein **fehlender** Status lässt bewusst durch — der virtuelle Geräte-User aus `allowApiKey`
(`device:<deviceId>`) hat keinen, und fail-closed würde hier jedes Terminal aussperren.

**3. Der Listen-Filter sitzt am Geräte-Pfad, nicht global.** `userQueryResolver` erzwingt
`status: ACTIVE` nur für `device:`-Rollen. Die Admin-User-Liste zeigt archivierte Konten
weiterhin — sonst wäre ein fälschlich archivierter Mitarbeiter nicht mehr reaktivierbar, weil
er aus der einzigen Oberfläche verschwindet, in der man ihn wieder aktiv schalten könnte.
Erzwungen statt als Default, weil das `_id`-Scoping die Liste nur verkleinern kann und einen
archivierten, aber weiterhin zugewiesenen Mitarbeiter durchließe.

## Konsequenzen

- ⚠️ **Bestands-Edges können bereits archivierte Konten tragen** — dort waren sie folgenlos,
  ab diesem Stand sind sie gesperrt. Vor dem Rollout auf einem Kunden-Edge prüfen, ob ein
  benötigtes Konto betroffen ist: `SELECT loginname, role FROM users WHERE status='ARCHIVED'`.
  Reaktivieren geht über die Admin-User-Liste, die diese Konten bewusst weiter anzeigt.
- Ein zugewiesenes Terminal, dessen zugewiesener Kreis vollständig archiviert wird, zeigt eine
  leere Personalauswahl. Das ist dasselbe fail-closed-Verhalten, das `assertUsersAssignable`
  beim Zuweisen bereits erzwingt (dort mit klarer Fehlermeldung); die Freigabe-Rollen
  (`DEVICE_ACCESS_EXEMPT_ROLES`) bleiben als Zugang bestehen.
- Die Ausnahme gilt **nur** für Rollen der Push-Blockliste. Ein edge-lokal angelegter
  `tenant:technician` wird weiterhin archiviert, wenn die Cloud ihn nicht kennt — er *kann*
  gepusht werden, sein Fehlen im Snapshot ist also ein echtes Signal.
- Die Reconciliation liest jetzt `role` mit und filtert explizit auf `tenantId`: Der interne
  Aufruf trägt keinen User, `multiTenancy` stempelt dort nicht.

## Nachtrag (2026-09-12, [#275](https://github.com/panary/panary-core/issues/275)): der Bestandsfall trat ein — und der Notzugang war blind

Die erste Konsequenz oben ist am 2026-09-12 real geworden, und ihr letzter Satz war falsch.

Am Edge eines Testkunden stand das **einzige** `tenant:owner`-Konto seit dem
Merge-Bootstrap vom 2026-07-27 auf `ARCHIVED` — `updatedAt == createdAt`, also vom
Initial-Pull gesetzt, nicht von einem Menschen. Folgenlos, solange das Gerät auf `v26.8.6`
lief. Mit dem Update auf `26.9.2` (erster Watchtower-Lauf nach [#268](https://github.com/panary/panary-core/issues/268))
wurde der Guard scharf: jeder Anmeldeversuch `401 — „Dieses Benutzerkonto ist nicht aktiv."`.
Die laufende Sitzung starb erst mit dem `jwt expired`, weshalb das Fehlerbild „ging bis eben
noch" lautete und die Ursache drei Wochen alt war.

**Die Ausnahme aus Entscheidung 1 heilt Bestand nicht.** `selectStaleUsersToArchive` steigt bei
`status === ARCHIVED` in der ersten Zeile aus (Idempotenz), und `isLoginBlockedByStatus` wertet
sein `role`-Feld gar nicht aus. Die Ausnahme verhindert **neues** Archivieren, nicht die Wirkung
eines bereits gesetzten Status.

🚨 **Korrektur zur Konsequenz oben:** „Reaktivieren geht über die Admin-User-Liste" traf nicht
zu. Die Liste *zeigt* archivierte Konten — aber `apps/admin-client/.../users/user-form.ts` hatte
kein `status`-Feld. Sichtbarkeit ohne Schaltfläche ist keine Reaktivierbarkeit; die Begründung
für Entscheidung 3 stimmt erst mit dem nachgezogenen Formularfeld.

### Glied 4: „privilegierte Rolle" war dreimal definiert

Der gedachte Notzugang — ein zweites Konto mit `users: MANAGE` — war wirkungslos. Der Betreiber
kam über `tenant:technician` wieder ins Panel und sah dort **1 von 9** Konten:

| Liste | Ort (vorher) | Enthielt |
|---|---|---|
| wer darf patchen | `libs/domains/users/domain/src/lib/self-patch-policy.ts` | …, `tenant:owner`, **`tenant:technician`** |
| wer sieht alle | `apps/api-edge/src/services/users/users.schema.ts` | …, `tenant:owner`, **`tenant:manager`** |
| dieselbe, dritte Kopie | `panary-cloud` → `apps/api-cloud/src/services/users/users.schema.ts` | wie die zweite |

Die Abweichung ging in **beide** Richtungen: `tenant:technician` durfte laut Matrix und
Patch-Policy jeden Nutzer ändern, wurde vom Query-Resolver aber auf die eigene `_id` gezwungen;
`tenant:manager` sah umgekehrt alle, durfte aber nur sich selbst patchen.

🚨 **Weil das Scoping auf der Query sitzt, wirkt es auch bei `get` und `patch` by id.** Ein
`PATCH /users/<fremde-id>` endete daher in **404**, nicht in 403 — `restrictUserSelfPatch` ließ
den Techniker durch, der Blocker war allein der Datenausschnitt. Ein 404 liest sich wie „gibt es
nicht" und schickt die Diagnose in die falsche Richtung.

**Entscheidung:** Beide Dimensionen leben als eine Quelle in
`libs/domains/users/domain/src/lib/user-access-policy.ts` — `PRIVILEGED_ROLES` (ändern) und
`USER_VISIBILITY_ALL_ROLES` (sehen), mit dokumentierter Entscheidung je Rolle.
`tenant:technician` sieht ab jetzt alle Konten; `tenant:manager` sieht weiter alle und patcht
weiter nur sich selbst (Entscheidung zu [#189](https://github.com/panary/panary-core/issues/189),
`time-clock-scope.ts`). Die Invariante, deren Verletzung der Defekt war — **wer ändern darf, muss
sehen dürfen** — ist als Test in `user-access-policy.spec.ts` gelockt, zusammen mit der Ableitung
aus der `RolePermissions`-Matrix. Die Cloud-Hälfte (dritte Kopie) läuft als
`panary/panary-cloud#354`.

Zwei Dinge bleiben bewusst **draußen**:

- **Keine Rollen-Ausnahme im Login-Guard.** `isLoginBlockedByStatus` lässt `tenant:owner`
  weiterhin nicht durch — das würde `ARCHIVED` für die mächtigste Rolle dauerhaft wirkungslos
  machen, auch bei bewusster Archivierung.
- **Keine Selbstheilung beim Start.** Der Boot-Check meldet den Zustand, er vergibt keinen
  Zugang von selbst.
