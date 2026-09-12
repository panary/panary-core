---
type: Architecture
title: Administrationsfähiger Zugang am Edge — Boot-Check und /health-Flag
description: Ein Edge kann sich durch die Kombination aus Cloud-Reconciliation und Login-Guard unbemerkt in einen Zustand ohne administrationsfähigen Zugang bringen; der Boot-Check meldet diesen Zustand laut und stellt ihn RBAC-frei über /health bereit.
tags: [security, authentication, users, edge, observability]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-12T00:00:00Z }
---

# Administrationsfähiger Zugang am Edge

## Warum das überhaupt nötig ist

Ein Edge konnte sich **unbemerkt** aussperren. Am 2026-09-12 am Kunden-Edge gemessen
(panary/panary-core#275): Das einzige `tenant:owner`-Konto stand seit dem Merge-Bootstrap vom
2026-07-27 auf `ARCHIVED` — gesetzt vom Initial-Pull nach dem Pairing, nicht von einem Menschen.

Vier Glieder, jedes für sich harmlos:

| # | Glied | Wirkung |
|---|---|---|
| 1 | Der Initial-Pull archiviert das Owner-Konto | seit [#187](https://github.com/panary/panary-core/issues/187) für **neue** Pairings verhindert |
| 2 | Bereits archivierte Owner werden nicht geheilt | Bestand blieb betroffen |
| 3 | Das Benutzerformular hatte kein `status`-Feld | Sichtbarkeit ohne Schaltfläche |
| 4 | Die letzte Rolle, die noch hereinkam, sah keine anderen Nutzer | Notzugang wirkungslos |

Der Zustand war **drei Wochen folgenlos**, weil das Gerät auf `v26.8.6` lief. Mit dem Update auf
`26.9.2` wurde der Login-Guard aus [ADR 0028](../adr/0028-archived-sperrt-am-edge.md) scharf, und
seither antwortete jeder Anmeldeversuch mit `401 — „Dieses Benutzerkonto ist nicht aktiv."`. Die
laufende Sitzung starb erst mit dem `jwt expired` — das Fehlerbild lautete deshalb „ging bis eben
noch", während die Ursache drei Wochen alt war.

> 🚨 Kein Test und kein Gate hätte das gefunden. Der Zustand entsteht **in den Daten**, nicht im
> Code, und er wird erst durch ein Update wirksam, das Monate später kommt.

## Was geprüft wird

`apps/api-edge/src/utils/admin-access-health.ts` beantwortet eine Frage:

> Existiert mindestens ein Konto, das sich **anmelden** *und* **Nutzer verwalten** kann?

Beide Hälften kommen aus der jeweils bestehenden Wahrheit, nicht aus einer Kopie:

- **anmelden** — `!isLoginBlockedByStatus(user)` (`utils/user-login-status.ts`), also genau der
  Guard, der am Login entscheidet. Inklusive seiner Regel, dass ein **fehlender** Status
  durchlässt (der virtuelle Geräte-User aus `allowApiKey` hat keinen).
- **verwalten** — `canManageUsers(role)` aus `@panary/users/domain`. `USER_MANAGE_ROLES` ist aus
  der `RolePermissions`-Matrix **abgeleitet** (`users: MANAGE`), nicht gelistet: `platform:owner`,
  `tenant:owner`, `tenant:technician`. Eine vierte handgepflegte Rollenliste wäre genau der
  Fehler, den #275 behoben hat (siehe [Rollenlisten](#rollenlisten-sehen-vs-ändern)).

`tenant:manager` zählt bewusst **nicht** — die Rolle hat `users: [READ, UPDATE]` für den
Self-Service, kann aber kein fremdes Konto reaktivieren.

## Wo es sichtbar wird

**Beim Start** (`main.ts`, nach dem Admin-/Location-Bootstrap): Fehlt der Zugang, schreibt
`assertAdminAccessAvailable` einen `logger.error` mit `event: bootstrap.admin_access_missing` —
inklusive der gesperrten Verwaltungskonten (Loginname, Rolle, Status), damit ein Techniker weiß,
was zu reaktivieren ist, und mit dem Reparatur-Aufruf als `hint`.

**Im Betrieb** über `/health`, RBAC-frei:

| Feld | Bedeutung |
|---|---|
| `adminAccessHealthy: true` | mindestens ein anmeldefähiges Verwaltungskonto |
| `adminAccessHealthy: false` | **kein** administrationsfähiger Zugang mehr |
| Feld fehlt (`undefined`) | nicht ermittelbar (Lesefehler) — **nicht** „in Ordnung" |
| `blockedAdminCount` | Anzahl Verwaltungskonten, die der Status-Guard sperrt |

Drei Entscheidungen dahinter:

- **RBAC-frei.** Ein Flag hinter dem Login wäre in genau dem Fall unerreichbar, den es meldet.
- **Live gelesen, nicht beim Boot gemerkt.** Nach dem Reaktivieren eines Kontos ist das Flag
  ohne Neustart wieder grün. Kosten: ein `SELECT` auf `users` pro Aufruf — dieselbe
  Größenordnung wie der `locations`-Read, der `setupComplete` speist.
- **Nur Zahlen, keine Loginnamen.** `/health` ist öffentlich; die Namen stehen im Boot-Log.

## Was es ausdrücklich nicht tut

🚨 **Es heilt nicht.** Wer beim Start automatisch Zugang vergibt, macht `ARCHIVED` für die
mächtigste Rolle dauerhaft wirkungslos — auch bei bewusster Archivierung. Abgestimmt am
2026-09-12: erst melden, nicht selbsttätig Zugang vergeben. Die einmalige Heilung von
Bestandsdaten läuft als Migration, an eine Bedingung gebunden.

🚨 **Es wirft nicht.** Ein Boot-Abbruch nimmt dem Betrieb die Kasse und ändert am Zugangsproblem
nichts. Ein Lesefehler liefert `null` („nicht ermittelbar") statt `healthy: false` — ein
Fehlalarm an dieser Stelle ist teurer als eine Lücke in der Meldung.

⚠️ **Es erreicht kein Gerät, das nicht aktualisiert wird.** Der ursprüngliche Vorfall entstand auf
einem Edge, der 38 Tage zurückhing; bei defektem Watchtower (vor
[#268](https://github.com/panary/panary-core/issues/268)) auf unbestimmte Zeit.

## Einmalige Heilung von Bestandsdaten

`apps/api-edge/migrations/20260912160000_reactivate_locked_out_owner.ts` schaltet ein
archiviertes Owner-Konto wieder auf `ACTIVE` — **nur** unter einer Bedingung:

> Es existiert **kein** anmeldefähiges Konto mit `users: MANAGE` mehr.

🚨 **Die Bedingung ist der Kern, nicht die Aktion.** Ein bewusst stillgelegter Owner bleibt
stillgelegt, solange irgendein anderer Zugang besteht — sonst wäre `ARCHIVED` für die mächtigste
Rolle wertlos.

Geheilt werden nur Rollen der Push-Blockliste (`SYNC_PUSH_BLOCKED_USER_ROLES` ∩
`USER_MANAGE_ROLES`), also `tenant:owner` und `platform:owner`. Ein archivierter
`tenant:technician` bleibt archiviert: Die Rolle **kann** gepusht werden, ihr Fehlen im
Visibility-Snapshot ist ein echtes Signal (ADR 0028, Konsequenzen). Beim Owner ist es eine
Tautologie — er wird nie gepusht, kann also nie im Snapshot stehen.

Ebenfalls unberührt: `REJECTED` (eine menschliche Entscheidung, kein Reconciliation-Artefakt)
und jedes Konto ohne Verwaltungsrolle.

Drei Eigenschaften, die im Code festgehalten sind:

- **`updatedAt` wird mitgesetzt** — das ist eine echte Änderung und soll im Datensatz stehen.
  Sync-neutral, weil ausschließlich Konten der Push-Blockliste betroffen sind.
- **`down()` ist ein No-op.** Ein Rollback müsste wissen, *welche* Konten diese Migration
  reaktiviert hat; `status` trägt keine Herkunft. Pauschales Zurück-Archivieren würde genau den
  Totalausschluss wiederherstellen.
- **Sie schreibt eine Zeile ins Boot-Log** (`console.warn`, kein `logger` — siehe unten). Ein
  stillschweigend wieder freigeschalteter Zugang ist eine sicherheitsrelevante Änderung.

⚠️ **Warum Rollen-Literale statt Import.** Migrationen werden als Assets kopiert und einzeln mit
`--bundle=false` transpiliert (`tools/docker/Dockerfile.edge`). Keine Migration in diesem Repo
importiert einen Laufzeitwert aus einer Domain-Lib, und ein Auflösungsfehler würde in
`sqlite.ts` nur geloggt, nicht geworfen — die Migration fiele **still** aus. Die Literale sind
deshalb per Test gegen `USER_MANAGE_ROLES` und `SYNC_PUSH_BLOCKED_USER_ROLES` gelockt
(`apps/api-edge/test/migrations/reactivate-locked-out-owner.spec.ts`), dasselbe Muster wie bei
`DEVICE_PRIVILEGED_ROLES`.

⚠️ **Eine Migration läuft genau einmal pro Datenbank.** Wird das letzte Verwaltungskonto *später*
archiviert, heilt nichts mehr — dann greift der Boot-Check als Meldung, und die Reparatur läuft
über das Status-Feld im Benutzerformular.

🚨 **Bis einschließlich `v26.9.3` war dieser Reparaturweg für Konten ohne E-Mail versperrt**
([#288](https://github.com/panary/panary-core/issues/288)). Das Formular lud `email: NULL` als
Leerstring und schickte ihn ungefiltert mit; AJV prüft `format: 'email'` auf jedem
nicht-undefined-Wert, also endete *jeder* Patch in `400 — must match format "email"`. Getroffen
hat es genau den typischen POS-Mitarbeiter (Personalnummer + PIN, keine E-Mail) — in der Dev-DB
zwei von fünf Konten. Die Meldung zeigte dabei auf ein Feld, das der Bediener nie angefasst
hatte. Behoben, indem der Save-Block ein leeres `email` strippt wie `password`, `posPin`,
`staffRole` und `employeeNumber`; bewusste Folge ist, dass eine gesetzte E-Mail sich hier nur
überschreiben, nicht entfernen lässt. **Auf einem Gerät, das noch `v26.9.3` oder älter fährt,
besteht die Sperre fort** — dort bleibt nur der Weg über die Cloud oder ein Konto mit E-Mail.

## Rollenlisten: sehen vs. ändern

„Privilegierte Rolle" war dreimal definiert und lief auseinander —
`libs/domains/users/domain/src/lib/user-access-policy.ts` ist seit #275 die einzige Quelle für
beide Dimensionen:

| Rolle | sieht alle Nutzer | ändert fremde Nutzer |
|---|---|---|
| `platform:owner` | ja | ja |
| `platform:admin`, `platform:support` | ja | ja (Matrix begrenzt auf READ) |
| `tenant:owner` | ja | ja |
| `tenant:technician` | ja (**neu** mit #275) | ja |
| `tenant:manager` | ja | nein — nur den eigenen Datensatz |
| `tenant:staff` | nein | nein |
| `device:*` | Zuweisungs-Scope | nein |

🚨 **Das Sichtbarkeits-Scoping sitzt auf der Query und wirkt damit auch bei `get` und `patch` by
id.** Vor #275 sah `tenant:technician` nur sich selbst, obwohl die Patch-Policy ihn durchließ —
ein `PATCH /users/<fremde-id>` endete in **404**, nicht in 403. Ein 404 liest sich wie „gibt es
nicht" und schickt die Diagnose in die falsche Richtung. Die Invariante *wer ändern darf, muss
sehen dürfen* ist als Test in `user-access-policy.spec.ts` gelockt.

## Reparatur über die Oberfläche

`apps/admin-client/.../users/user-form.ts` hat ein Feld **Kontostatus** (`ACTIVE` /
`ARCHIVED`). Erst damit stimmt die Begründung aus ADR 0028, die den sichtbaren
`ARCHIVED`-Eintrag in der Nutzerliste genau mit der Reaktivierbarkeit rechtfertigt — vorher
zeigte die Liste archivierte Konten, und es gab keine Schaltfläche, sie zurückzuholen.

Drei Regeln, alle mit Grund:

- **Nur an fremden Konten.** Wer sich selbst archiviert, sperrt sich im Speichern-Klick aus:
  Die JWT-Strategy lädt das Entity pro Request frisch (ADR 0028), die eigene Sitzung stirbt
  sofort. Das Feld erscheint deshalb nicht am eigenen Datensatz.
- **Nicht beim Anlegen.** Ein neuer Nutzer ist immer `ACTIVE`; ein Auswahlfeld dafür wäre eine
  Falle.
- 🚨 **`status` wird nur mitgesendet, wenn das Feld angeboten wurde.** `status` steht nicht in
  `SELF_PATCHABLE_FIELDS` — ein blind mitgeschicktes Feld quittiert der Server mit 403, und zwar
  im Self-Service-Fall (Mitarbeiter ändert sein eigenes Passwort), der mit dem Status nichts zu
  tun hat.

`REJECTED` wird **nicht** aktiv angeboten (das ist eine Registrierungs-Ablehnung, keine
Betriebsentscheidung), erscheint aber als Option, wenn das Konto den Status trägt: Ein `select`
ohne passende `option` würde das Modell still leerräumen.

Eine Statusänderung läuft über `PATCH /users/<id>` und erzeugt damit ein Audit-Event
(`users.patch` ist in `AUDIT_RESOURCE_MAP` als `CONFIGURATION`/`WARNING` geführt, mit Diff).

## Diagnose-Reihenfolge, die getragen hat

1. `/health` abrufen — auf `adminAccessHealthy` und die Version schauen. ⚠️ Content-Type prüfen:
   Ein Edge im SETUP MODE liefert HTML mit Status 200.
2. `docker logs --since 20m <container> | grep -iE "admin_access|unauthoriz|not.*aktiv"` — erst
   die Logzeile nannte damals die Ursache. Container-Status, Disk und RAM waren alle unauffällig.
3. Erst dann die DB ansehen: `SELECT loginname, role, status FROM users WHERE status != 'ACTIVE'`.

Verwandt: [ADR 0028](../adr/0028-archived-sperrt-am-edge.md) (Guard und Owner-Ausnahme),
[ADR 0027](../adr/0027-merge-bootstrap-nur-mit-externalid.md) (verwaiste Owner-Konten nach
Merge-Bootstrap), [Aufrufer-Scope der POS-Zeiterfassung](zeiterfassung-aufrufer-scope.md)
(derselbe `PRIVILEGED_ROLES`-Konsument).
