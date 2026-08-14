---
type: Architecture
title: Aufrufer-Scope der POS-Zeiterfassung am Edge
description: Die vier Stempel-Custom-Methods nahmen eine beliebige userId entgegen und liefen an allen Hooks vorbei, die den patch-Pfad absichern — jeder Mitarbeiter konnte jeden Kollegen bestempeln, archivierte Konten eingeschlossen, und ein zugewiesenes Gerät stempelte Leute, die ihm nie zugewiesen waren.
tags: [security, users, pos, time-clock, devices]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-13T18:50:00Z }
---

# Aufrufer-Scope der POS-Zeiterfassung (panary/panary-core#189)

`users.checkin`, `users.checkout`, `users.startBreak` und `users.endBreak` sind
Custom-Methods am `users`-Service. Sie bekommen eine `userId` herein und laden den
Datensatz intern (`provider: undefined`). Bis #189 prüften sie **nicht, wer da eigentlich
fragt** — ihre Signatur nahm `params` gar nicht erst entgegen, obwohl das
`UserService`-Interface sie längst vorsah.

Gegenstück zu [panary/panary-cloud#225](https://github.com/panary/panary-cloud/issues/225).
Der Edge war schärfer betroffen: Dort sind alle vier Methoden echte Schreibpfade (in der
Cloud enden drei in einem unbedingten `Conflict`, weil `working-times` fehlt), und die
Geräte-Zuweisung ist am Edge tatsächlich aktiv umgehbar gewesen.

## Der Befund

Custom-Methods laufen an genau den Hooks vorbei, die den `patch`-Pfad absichern:

| Schutz | Warum er nicht greift |
|---|---|
| `multiTenancy` | stempelt/filtert Query und Data der Standard-Methoden, nicht die Argumente einer Custom-Method |
| `restrictUserSelfPatch` | ist ausschließlich am `patch`-Hook registriert |
| `restrictDeviceAccessMode` | war nur auf `verifyPin`/`changePin` gesetzt |
| `ensureTenantIsolation` | ist ein App-Level-***after***-Hook: prüft das *Result*, also **nach** dem Schreibvorgang |

Der Verstärker ist eine Fehleinschätzung von `users:UPDATE`. Das klingt nach Privileg, ist
aber **Self-Service-Grundausstattung**: `TENANT_STAFF` und `TENANT_MANAGER` tragen es laut
`roles.matrix.ts`, damit sie ihren *eigenen* Datensatz patchen können — den Self-Scope
erzwingt `restrictUserSelfPatch`. `authorize()` mappt die vier Stempel-Methoden auf
ebendieses `users:UPDATE` und ließ sie damit für jeden Mitarbeiter auf jeden Kollegen durch.
Geräte kommen über den `CAN_CLOCK_IN`-Fallback dran
([`authorize.hook.ts`](../../libs/shared/backend/src/hooks/authorize.hook.ts),
`TIME_CLOCK_METHODS`) — beabsichtigt, aber eben ohne Zuweisungs-Prüfung.

## Was gemessen wurde

Am laufenden Edge (Dev-Datenbank, echte HTTP-/Socket-Aufrufe), Stand vor dem Fix:

| Fall | vorher | nachher |
|---|---|---|
| `tenant:staff` → `checkin` auf einen Kollegen (`tenant:owner`) | **HTTP 200**, `working-times`-Eintrag angelegt, `stampingId` gepatcht | **403** „Zeiterfassung ist nur fuer den eigenen Benutzer moeglich.", kein Write |
| `tenant:staff` → `startBreak` auf einen Kollegen | **HTTP 200**, `startBreakAt` geschrieben | **403**, kein Write |
| `tenant:staff` → `checkin` auf ein `ARCHIVED`-Konto | **HTTP 200**, geschrieben | **403**, kein Write |
| Geräte-JWT, Gerät `assigned` an jemand anderen → `checkin` auf einen **nicht** zugewiesenen Mitarbeiter | **erfolgreich**, `stampingId` geschrieben | **403** „Benutzer ist fuer dieses Geraet nicht freigegeben." |
| Geräte-JWT → `checkin` auf ein `ARCHIVED`-Konto (Exempt-Rolle, also im Scope) | — | **403** „Benutzerkonto ist nicht aktiv." |
| `tenant:staff` → `checkin` auf **sich selbst** | 200 | **200** (unverändert) |
| Theken-Terminal (`shared`) → `checkin` auf einen Mitarbeiter | 200 | **200** (unverändert) |

Ein Detail, das man dem Code nicht ansieht und das den Befund einordnet: Derselbe
`tenant:staff`-Aufrufer bekommt auf `GET /users/<kollege>` ein **404** — der Lesepfad ist
über den `userQueryResolver` gescoped. Der Schreibpfad war es nicht, und die Antwort des
`checkin` lieferte den kompletten Kollegen-Datensatz zurück, den der reguläre `get`
verweigert. Die Lücke war also nicht nur ein Integritäts-, sondern auch ein
Vertraulichkeitsproblem.

## Die Lösung

`assertTimeClockAccess`
([`apps/api-edge/src/services/users/time-clock-scope.ts`](../../apps/api-edge/src/services/users/time-clock-scope.ts))
läuft in jeder der vier Methoden unmittelbar nach dem `get` — also **vor** jedem
Schreibvorgang und vor jeder Zustands-Meldung. Vier Prüfungen in dieser Reihenfolge:

1. **Mandant** — `params.user.tenantId` gegen `user.tenantId`, wortgleich zu `changePin`.
   Am Edge Tiefenstaffelung statt Hauptlinie (ein Edge gehört zu genau einem Mandanten),
   aber Bestand aus der Zeit vor einem `tenantId`-Restamp ist nicht ausgeschlossen.
   Bewusst zuerst: Käme der Self-Check davor, wäre die Ablehnung für „fremder Tenant" und
   „fremder Kollege" dieselbe und damit ein Oracle darüber, ob eine geratene UUID im
   eigenen Mandanten liegt.
2. **Datensatz** — Geräte-Rollen und `PRIVILEGED_ROLES` dürfen für jeden stempeln (ein
   Terminal bedient die ganze Schicht), alle übrigen nur für sich selbst. Spiegelt
   `checkChangePinRequest`.
3. **Geräte-Zuweisung** — an einem zugewiesenen Gerät nur der freigegebene Personenkreis
   (`params.deviceAccessScope`, den `resolveDeviceAccessScope` in `before.all` ablegt —
   der Hook läuft auch für Custom-Methods). Siehe
   [ADR 0023](../adr/0023-zugewiesene-pos-geraete.md).
4. **Kontostatus** — `isLoginBlockedByStatus`, gleiche Sperre wie `verifyPin`/`changePin`
   ([ADR 0028](../adr/0028-archived-sperrt-am-edge.md)).

### Warum nicht `restrictDeviceAccessMode` als Hook

Naheliegend wäre gewesen, den vorhandenen Hook einfach auf die vier Methoden zu ziehen. Er
trägt aber eine **PIN-spezifische Tarnung**: Er antwortet wortgleich mit „PIN ungültig" und
zählt den Versuch über `recordPinFailure` mit, damit die Geräte-Zuweisung nicht über
Antworttext oder Sperrverhalten auslesbar wird. An einem Stempel-Aufruf wäre beides falsch —
es würde den **PIN-Lockout eines Kollegen auslösen, ohne dass je eine PIN im Spiel war**, und
damit einen DoS-Vektor öffnen, den es vorher nicht gab. Die Geräte-Prüfung sitzt deshalb in
der gebündelten Policy.

### Zwei Specs, nicht eine

`time-clock-scope.spec.ts` prüft die Entscheidung, `time-clock-wiring.spec.ts` die
**Verdrahtung** — ruft jede der vier Methoden die Prüfung überhaupt auf? Die zweite ist der
eigentliche Schutz: Der Fehler war ja nicht „die Policy entscheidet falsch", sondern „es gibt
gar keine", und ein Umbau, der `assertTimeClockScope` aus einer Methode entfernt, ließe eine
reine Policy-Spec unverändert grün. Gegengeprobt: Jede der vier Mutationen (Check aus genau
einer Methode entfernt) lässt die Verdrahtungs-Spec mit fünf Tests fallen.

## Bewusste Entscheidungen

- **`TENANT_MANAGER` bleibt außen vor** (mit dem Nutzer abgestimmt). Er ist nicht in
  `PRIVILEGED_ROLES` und darf damit nicht mehr für Mitarbeiter stempeln. Praktisch folgenlos:
  Der POS stempelt ausschließlich unter dem Geräte-JWT — Login-Screen
  (`time-clock-panel.component.ts`) und Dashboard (`dashboard.component.ts`) laufen beide
  über die Geräte-Verbindung, ein zweiter Aufrufer existiert im Repo nicht. Stempel-*Korrekturen*
  laufen fachlich über `working-times`. Konsistent zu `changePin` und zur Cloud.
- **Die Policy bleibt app-lokal**, obwohl panary-cloud seit #225 dieselbe Prüfung trägt. Ein
  gemeinsamer Umzug nach `@panary/users/domain` ist eine Kette über beide Repos
  (Domain-Änderung → Core-Release → Cloud-Pin-Bump → Cloud-Umbau) und gehört nicht in einen
  Sicherheitsfix; dieselbe Abwägung wie bei
  [`user-login-status.ts`](../../apps/api-edge/src/utils/user-login-status.ts). Geteilt ist
  das, was sich ändern könnte: die Rollen-Wahrheit `PRIVILEGED_ROLES` kommt aus der Domain.
  Beide Dateien sind absichtlich strukturgleich, damit ein späterer Umzug ein Verschieben
  bleibt und kein Neuschreiben.

## Bekannte Grenze

`stampingId` und `startBreakAt` stehen in `USER_EDGE_LOCAL_FIELDS` und werden in *beide*
Richtungen gestrippt — ein Fehlstempel blieb also lokal. Die fachliche Historie in
`working-times` dagegen nicht: Sie synchronisiert in die Cloud. Wer prüfen will, ob der Pfad
in Bestandsdaten getroffen wurde, sucht dort nach Einträgen ohne passenden Schichtplan, nicht
in `users`.
