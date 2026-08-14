---
type: Architecture
title: POS-PIN — erzwungener Wechsel bei der nächsten Anmeldung (mustChangePosPin)
description: Vom Admin vergebene POS-PINs erzwingen über das Flag mustChangePosPin einen Wechsel beim nächsten Terminal-Login, umgesetzt über die neue Custom-Method users.changePin mit Proof-of-Possession.
tags: [users, rbac, sync, pos]
status: stable
generated: { by: claude-code/opus-5, at: 2026-07-29T10:00:00Z }
---

# Erzwungener POS-PIN-Wechsel

## Problem

Vergibt ein Admin in der Cloud-Admin-UI einen POS-PIN (beim Anlegen oder über
den Reset-Dialog), **kennt er diesen PIN**. Solange der Mitarbeiter ihn nicht
gewechselt hat, ist der PIN ein geteiltes Geheimnis — und damit ist keine
POS-Aktion (Storno, Rabatt, Zeitstempel, Kassenöffnung) mehr eindeutig einer
Person zurechenbar. Genau diese Zurechenbarkeit ist der Zweck des PINs.

Praktisch blieben dem Admin nur zwei schlechte Wege: alle PINs notieren und
einzeln mitteilen, oder einen generischen PIN vergeben ohne sicherstellen zu
können, dass er gewechselt wird.

Erschwerend: der Selbst-Service-Pfad im POS war **funktionslos**. Die
Einstellungen riefen `usersService.patch(userId, { posPin })` auf — der
POS-Client authentifiziert sich aber per API-Key als *Gerät*
(virtueller User `device:<deviceId>`, siehe `allowApiKey`-Hook), und
`DEVICE_POS` hat bewusst kein `users:UPDATE`. Der Aufruf endete in 403,
danach hätte zusätzlich `restrictUserSelfPatch` mit `FOREIGN_RECORD`
abgelehnt. Der „PIN speichern"-Button war toter Code.

## Entscheidung

### Feld

`mustChangePosPin` (Boolean, Default `false`) im geteilten `userSchema`
(`libs/domains/users/domain/src/lib/user.schema.ts`) **und** in der
`Type.Pick`-Liste von `userDataSchema` — ohne den Pick-Eintrag wäre das Feld
wegen `additionalProperties: false` weder create- noch patchbar, und der
Cloud→Edge-Pull würde den **kompletten** User-Record verwerfen.

Gesetzt wird es ausschließlich von der Cloud-Admin-UI (Checkbox, Default an),
gelöscht ausschließlich von `users.changePin`. Es steht bewusst **nicht** in
`SELF_PATCHABLE_FIELDS` — sonst könnte sich jeder Mitarbeiter den Zwang selbst
wegpatchen, ohne den PIN zu ändern.

### Custom-Method statt Matrix-Aufweichung

Neu: `users.changePin({ userId, currentPin, newPin })`, implementiert am Edge
(`apps/api-edge/src/services/users/users.ts`) und gespiegelt in der Cloud
(Tier `cloud-direct` — dort spricht der POS-Client direkt gegen `api-cloud`).

`currentPin` ist **Pflicht** und wird per bcrypt gegen den gespeicherten Hash
geprüft. Das ist die einzige Bindung an die Person hinter dem Terminal: das
Gerät authentifiziert sich, nicht der Mitarbeiter. Ohne diesen Beweis könnte
jeder am Terminal eine beliebige `userId` wählen und den PIN eines Kollegen
überschreiben — die User-Liste liefert der Login-Screen ohnehin.

Die Methode patcht ausschließlich `posPin` + `mustChangePosPin: false` über die
Feathers-Adapter-API. Weitere Body-Felder werden nicht durchgereicht; die
Methode bringt damit ihre eigene Feld-Allowlist mit.

Autorisiert wird über die neue Ability `CAN_CHANGE_POS_PIN` mit einem eigenen
`PIN_CHANGE_METHODS`-Set im `authorize`-Hook — bewusst **nicht** durch
Erweitern von `TIME_CLOCK_METHODS`, sonst würde `CAN_CLOCK_IN` plötzlich auch
PIN-Wechsel autorisieren. Alternativen und ihre Ablehnung:

| Variante | Warum verworfen |
|---|---|
| `users:UPDATE` an `DEVICE_POS` | Öffnet dem Gerät jede users-Methode, die auf UPDATE mappt — heute `checkin`/`checkout`/…, morgen jede neue. Killt die Regressionsschranke „DEVICE_POS darf trotz Ability KEINEN regulären users-Patch". |
| `SELF_PATCHABLE_FIELDS` erweitern | Wirkungslos: Geräte scheitern vorher an `FOREIGN_RECORD` (`_id` ist `device:<id>`, nie eine User-`_id`). Zusätzlich könnten Mitarbeiter in der Cloud den Zwang selbst löschen. |

Ergänzend prüft die Methode den Tenant explizit — `multiTenancy()` ist bei
Custom-Methods ein No-Op (es stempelt/filtert nur `create`/`update`/`patch`
bzw. `find`/`get`/`remove`).

### Erzwingung im POS

`verifyPin` liefert den vollen User (minus `posPin`/`password`). Ist
`mustChangePosPin` gesetzt, wechselt der Login in den neuen Schritt
`change-pin` (neue PIN + Bestätigung über denselben Ziffernblock) und schreibt
`pos_current_user` **nicht** in den localStorage. Ohne diesen Eintrag leitet
der `posAuthGuard` jede geschützte Route zurück auf `/login` — der Zwang hält
damit auch gegen manuelle URL-Eingabe.

Der beim Login verifizierte Klartext-PIN wird als Proof-of-Possession in einem
privaten Klassenfeld gehalten (kein Signal, kein localStorage) und beim
Abschluss verworfen. Nach einem Reload ist er weg und ein neuer Login fällig —
korrektes Verhalten.

> **SQLite-Falle:** Der Edge liefert Booleans als `0`/`1`. Ein `=== true` würde
> den Zwang still wirkungslos machen, `Boolean('0')` wäre umgekehrt `true`.
> Die Auswertung läuft deshalb über `requiresPosPinChange` aus
> `@panary/users/domain`, das beide Fälle kapselt und getestet ist.

### PIN-Länge: exakt 4 Ziffern

Der POS-Ziffernblock akzeptiert genau vier Stellen (Auto-Submit bei der
vierten). Die Cloud-Admin-UI erlaubte bis dahin 4–6 — ein 5- oder 6-stelliger
PIN ließ sich am Terminal **nie** eingeben und sperrte den Mitarbeiter
dauerhaft aus. Die Cloud-Validierung ist deshalb auf `/^[0-9]{4}$/` reduziert
(`POS_PIN_PATTERN` in `change-pin-policy.ts`).

Das Speicher-Schema (`posPin`) bleibt bei 4–6 Zeichen Klartext-Input, damit
Bestands-Hashes früher vergebener längerer PINs gültig bleiben.

### Brute-Force-Schutz

`verifyPin` war unlimitiert über den Geräte-Socket erreichbar: 4-stellige PIN
= 10.000 Kombinationen, bcrypt mit Cost 6 → der Vollraum in etwa einer Minute.
Beide Methoden nutzen jetzt `pin-attempt-limiter` aus `@panary/shared-backend`.

Bewusst **selbstauflösend** (10 Fehlversuche / 5 min → 60 s Sperre, danach
automatisch frei): eine dauerhafte PIN-Sperre am Kassenterminal ist ein echtes
Betriebsrisiko. Ein Angreifer wird auf wenige Versuche pro Minute gedrosselt,
ein vertippter Mitarbeiter wartet schlimmstenfalls eine Minute — kein
Manager-Override nötig. Der Store ist prozesslokal (wie der Pairing-Limiter);
am Single-Prozess-Edge exakt, in der Multi-Instanz-Cloud Best-Effort.

`changePin` allein zu limitieren wäre wirkungslos gewesen — ein Angreifer hätte
weiter über `verifyPin` gesucht und `changePin` erst mit dem gefundenen PIN
aufgerufen. Zusätzlich waren „Kein PIN gesetzt" und „PIN ungültig"
unterscheidbar und damit ein Existenz-Oracle; jetzt einheitliche Meldung.

## Konsequenzen

**Sync-Kette — alle vier Glieder sind Pflicht.** Fehlt eines, bricht nicht nur
das Feld, sondern die gesamte User-Synchronisation des Tenants:

| Glied | Ort | Bricht ohne |
|---|---|---|
| Edge-Migration | `apps/api-edge/migrations/…_users_add_must_change_pos_pin.ts` | Pull-Apply patcht den kompletten Cloud-Record → `no such column` → Record REJECTED |
| Schema + Data-Pick | `libs/domains/users/domain/src/lib/user.schema.ts` | `additionalProperties: false` → Record abgewiesen (beide Richtungen) |
| Boolean-Coercion | `panary-cloud` `USER_BOOLEAN_FIELDS` | Edge pusht `0`/`1` → AJV „must be boolean" → User-Push dauerhaft rejected |
| Pull-Projektion | `panary-cloud` `MEMBERSHIP_FIELDS` | Flag erreicht den Edge nie, das Feature tut nichts |

**Push läuft automatisch.** Der `sync-outbox-recorder` prüft `params.fromSync`,
**nicht** `params.provider`, und ist ein App-Level-around-Hook — der interne
Patch aus `changePin` erzeugt also einen Outbox-Eintrag mit dem neuen Hash.

> **Nie `fromSync: true` an diesen Patch hängen.** Das würde den bcrypt-Resolver
> überspringen (**Klartext-PIN in der Datenbank**) *und* den Outbox-Eintrag
> unterdrücken. Der Integrationstest pinnt beides.

**…seit #220 auch für `tenant:owner`.** Bis dahin galt der Satz oben für ihn
nicht: `SYNC_PUSH_BLOCKED_USER_ROLES` enthält `tenant:owner`, der Cloud-Pull-Filter
schließt aber nur `platform:*` aus. Der Inhaber wurde also zum Edge **gepullt**
(er steht selbst an der Kasse), sein PIN-Wechsel aber nie zurückgepusht — Badge
blieb stehen, und beim nächsten cloudseitigen Anfassen des Records holte der Pull
den alten Hash samt Flag zurück. Der neu gesetzte PIN war tot.

Der Skip greift jetzt nur noch bei `create`. Ein `patch` geht mit dem **vollen**
Record raus; die Cloud verengt ihn auf `posPin` + `mustChangePosPin` und patcht
ausschließlich einen bereits existierenden Record — kein `create` aus zwei
Feldern. Die Feldliste lebt bewusst in `panary-cloud`
(`sync-allowlist.ts` → `USER_SELF_SERVICE_SYNC_FIELDS`), nicht in der geteilten
Domain: Eine Prüfung auf dem Edge schützt niemanden vor einem kompromittierten
Edge und wäre eine zweite Definition derselben Sache. Entscheidung und Alternativen:
`panary-cloud/docs/adr/0055-selbstbedienungsfelder-push-gesperrter-rollen.md`.

> ⚠️ **Die Reihenfolge zwischen den Repos ist nicht beliebig.** Ein Edge, der
> gegen eine Cloud **ohne** diesen Pfad pusht, bekommt `TERMINAL` zurück — kein
> Retry, die Op ist weg. panary-cloud#284 muss vor diesem Stand deployt sein, und
> core hat keinen Staging-Kanal, der das abfangen würde.

> **Bestandsdaten heilt der Fix nicht.** Owner, die seit dem Release (2026-07-29)
> einen PIN gesetzt haben, der nie ankam, tragen in der Cloud weiterhin den alten
> Hash — ohne erneuten Patch entsteht kein Outbox-Eintrag. Entschieden am
> 2026-08-14: kein automatischer Backfill, die betroffenen Owner setzen den PIN
> einmal neu. Ein Backfill müsste raten, welche Seite die neuere ist.

**Kein Last-Write-Wins beim Pull.** Push läuft vor Pull, und `changePin`
triggert zusätzlich einen Sofort-Zyklus (`triggerImmediateCycle`) — das deckt
den Normalfall. Verbleibendes Fenster: schlägt der Push fehl **und** wird der
Cloud-Record danach unabhängig angefasst, holt der nächste Pull den alten Hash
samt gesetztem Flag zurück. Der Mitarbeiter landet dann erneut im
Wechsel-Dialog (recoverbar, er kennt den Admin-PIN).

Gleiches gilt für Cursor-Resets: ein Pull-Cursor-Reset auf `cloud:users` ist —
anders als bei Master-Daten — **nicht** gefahrlos, weil er edge-lokale,
noch nicht gepushte PIN-Änderungen verwirft. Der Hinweis steht im Kopf der
Migration.

**Cloud→Edge-Verzögerung.** Ein in der Cloud gesetztes Flag wird erst mit dem
nächsten Sync auf den Terminals aktiv (Default 300 s, bei `SyncMode.MANUAL`
beliebig lang). Die Admin-UI weist darauf hin.

**Offline unkritisch.** Der Edge ist LAN-lokal; `verifyPin` und `changePin`
laufen vollständig ohne Cloud. Der Outbox-Eintrag läuft beim nächsten Zyklus
nach.

**Audit.** `AuditAction.PIN_CHANGE`, gemappt in `AUDIT_RESOURCE_MAP`. Actor ist
das Gerät (`device:<deviceId>`), der betroffene Mitarbeiter steht in
`target.entityId` — für die Forensik ausreichend.

## Nebenbefund: Personalnummern-Leak am Login-Screen

Der Login-`find` holte alle POS-User **ohne `$select`**. Da der
`userExternalResolver` nur `password`/`posPin` strippt, bekam jedes Terminal
die `employeeNumber` **aller** Mitarbeiter — und die ist das alleinige
Credential für Zeiterfassungs-Aktionen (`time-clock-panel`). Der Find fragt
jetzt nur die benötigten Spalten an.

Beim `$select` gilt: nur echte Spalten auflisten (virtuelle Felder wie
`hasPosPin` quittiert Knex mit „no such column"), und `tenantId` drin lassen,
damit das Sicherheitsnetz `ensureTenantIsolation()` weiter greift — es
überspringt Records ohne `tenantId`.

## Verwandt

* [Edge-authorize — Hybrid-RBAC](edge-authorize-hybrid-rbac.md)
* [Effektive Berechtigungen — hasEffectivePermission + Capability-Bundles](granulare-berechtigungen-helper.md)
* [Sicherheitshärtung — Sensible Daten in der Datenbank](sensitive-data-hardening.md)
* [Tenant-Audit-Events (Edge)](audit-events.md)
