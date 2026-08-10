---
type: Domain Concept
title: Zugewiesene POS-Geräte — Personenkreis, Durchsetzungskette, Notfallpfade
description: Wie ein Gerät auf einzelne Mitarbeiter eingeschränkt wird, an welchen vier Stellen am Edge das durchgesetzt wird und warum die Freigabe-Rollen immer sichtbar bleiben müssen.
tags: [devices, users, security, pos]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-10T21:20:00.000Z }
---

Ein Gerät ist entweder **`shared`** — jeder POS-Benutzer des Standorts kann sich anmelden,
das heutige Verhalten für rotierende Theken-Terminals — oder **`assigned`**: nur die in
`assignedUserIds` gelisteten 1–5 Mitarbeiter. Der Anlass ist das Diensthandy, das einer
Person gehört.

Die Entscheidungen dahinter (explizites Enum statt abgeleitetem Modus, kein DB-Default,
Biometrie vertagt) stehen in [ADR 0023](../adr/0023-zugewiesene-pos-geraete.md). Diese Seite
beschreibt, **wie** die Einschränkung wirkt.

## Der erlaubte Personenkreis

```
erlaubt = assignedUserIds  ∪  { alle Benutzer mit einer DEVICE_ACCESS_EXEMPT_ROLE }
```

Die zweite Menge ist nicht Bequemlichkeit, sondern Voraussetzung dafür, dass das Gerät
bedienbar bleibt. Drei Pfade fragen `users` per `role: { $in: [...] }` ab und wären sonst tot:

| Pfad | Rollen | Folge ohne Ausnahme |
| --- | --- | --- |
| Storno-Freigabe | Inhaber, Filialleiter | Kein Storno am Diensthandy möglich |
| Kassenabschluss-Freigabe | Platform-Rollen, Inhaber, Filialleiter, Techniker | Kasse lässt sich nicht freigeben |
| **Entkoppeln** | Inhaber, Filialleiter, Techniker | Gerät **unwiderruflich** an den Tenant gebunden |

Die drei Rollenkreise liegen zentral in `@panary/users/domain`
(`pos-authorization-roles.ts`), ihre Vereinigung ist `POS_AUTHORIZING_ROLES`.
`DEVICE_ACCESS_EXEMPT_ROLES` (`@panary/devices/domain`) muss diese Menge enthalten — gelockt
vom Invarianten-Test `apps/api-edge/src/hooks/device-access-exempt-roles.spec.ts`. Er kann nur
in `api-edge` stehen, weil die devices-Domain die users-Domain nicht importieren darf
(Publish-Build-Zyklus).

## Durchsetzungskette am Edge

Aufgelöst wird der Personenkreis **einmal pro Request** im `before.all`-Hook
`resolveDeviceAccessScope` (`hooks/device-access-mode.util.ts`); das Ergebnis liegt auf
`context.params` und wird von allen Konsumenten gelesen.

| Stelle | Wirkung |
| --- | --- |
| `resolveDeviceAccessScope` (`users`, `before.all`) | Lädt Geräte-Datensatz + Exempt-Benutzer, wirft fail-closed |
| `userQueryResolver._id` | Verengt die Query auf den Personenkreis — greift für `find` **und** `get` |
| `restrictDeviceAccessMode` (`verifyPin`, `changePin`) | Lehnt fremde `userId`s ab, vor dem bcrypt-Vergleich |
| `validateDeviceAssignment` (`devices.create`/`patch`) | Prüft den Schreibpfad, bevor eine kaputte Zuweisung entsteht |

### Warum der Hook und nicht nur der Resolver

Naheliegend wäre, alles im `userQueryResolver` zu erledigen. Feathers verpackt aber **jeden**
Fehler aus `resolveQuery` in ein `BadRequest('Error resolving data')` und schiebt das Original
nach `error.data.<feld>`. Die fail-closed-Ablehnung eines unbekannten Geräts käme damit als
**400 mit unbrauchbarer Meldung** beim Client an statt als 403 — im Integrationstest
nachgewiesen. Der Hook wirft sauber durch; der Resolver liest nur noch das Ergebnis und wirft
selbst nie.

### Warum `verifyPin` eine eigene Prüfung braucht

Das `users.find`-Scoping bestimmt, was der **Login-Screen anzeigt**. `verifyPin` braucht aber
nur eine `userId` und ist über den Geräte-Socket direkt erreichbar. Ohne die eigene Prüfung
könnte ein manipulierter Client am Diensthandy die PIN jedes Mitarbeiters durchprobieren.

Die Ablehnung ist **wortgleich** mit der eines falschen PINs (`PIN ungueltig` bzw.
`Aktuelle PIN ist falsch`) und zählt einen Fehlversuch mit. Beides gehört zusammen: Ein eigener
Text wäre ein Oracle für die Zuweisung jedes Geräts, und ein stehenbleibender Fehlversuchs-
Zähler wäre dasselbe Oracle über die Hintertür („zehn Versuche ohne Sperre = fremder Benutzer").

## Zuweisung beim Pairing

Ein Gerät kann schon beim Pairing zugewiesen werden. Die Werte reisen im
**Code-Record**, nicht im Request-Body des Redeem:

```
POST /device-pairing/request-code   (authentifiziert: Inhaber/Filialleiter)
  Body:     { locationId?, deviceAccessMode?, assignedUserIds? }
  →         validiert, legt sie im Code-Record ab
  Response: { code, expiresAt, ttlSeconds, deviceAccessMode, assignedUserIds }

POST /device-pairing/redeem          (öffentlich, rate-limited)
  Body:     { code, deviceName, deviceType }        ← unverändert
  →         Zuweisung kommt AUS DEM CODE-RECORD
  Response: { …, deviceAccessMode, assignedUsers }
```

Der Redeem ist **unauthentifiziert**. Wäre die Zuweisung dort ein Body-Feld, könnte sich jeder
mit einem gültigen Code ein Gerät auf einen beliebigen Mitarbeiter ausstellen — dieselbe
Begründung, aus der `tenantId`/`locationId` seit jeher nur aus dem Code-Record kommen. Die
Route liest aus dem Redeem-Body ausschließlich `code`, `deviceName` und `deviceType`; beide
Richtungen (Zuweisung hineinschmuggeln, Zuweisung abwählen) sind mit HTTP-Tests abgesichert.

Zwei Details, die leicht andersherum gebaut würden:

- **Geprüft wird beim Ausstellen, nicht beim Einlösen.** Sonst stünde am Terminal jemand vor
  einem Code, der aus einem Grund scheitert, den er weder sieht noch beheben kann. Es gelten
  exakt dieselben Regeln wie am `devices`-Schreibpfad — die Prüfung ist dieselbe Funktion
  (`assertUsersAssignable`), nicht eine zweite Implementierung.
- **`shared` wird nicht materialisiert.** Ist keine Zuweisung gewünscht, bleibt die Spalte
  leer statt ein explizites `'shared'` zu tragen: Ein frisch gepairtes Gerät sieht in der
  Datenbank aus wie ein Bestandsgerät. Die Response echot trotzdem `deviceAccessMode: 'shared'`.

Das **Echo im `request-code`-Response** hat einen zweiten Zweck neben der Bestätigung: Ein
älterer Edge kennt die Felder nicht und echot sie folglich nicht. Daran erkennt eine neuere
Admin-UI, dass dieser Edge die Zuweisung nicht unterstützt — statt sie anzubieten und
stillschweigend zu verlieren.

## Pflege im Edge-Admin

Die Zuweisung wird dort gepflegt, wo das Gerät gepairt wurde. Für POS-Terminals ist das der
**Edge-Admin** (`apps/admin-client`, Geräteliste) — gepairte Geräte leben in der Edge-SQLite und
werden nicht in die Cloud gesynct, im lokalen Hub-Betrieb gibt es also gar keinen zweiten Ort.

Zwei Einstiege, beide über dieselbe Auswahl-Komponente
(`device-assignment-picker.ts`):

- **Zeilen-Aktion „Zuweisung"** an einem bestehenden Gerät → Overlay im Stil des Pairing-Modals.
- **Im Pairing-Dialog**, bevor der Code erzeugt wird. Weil die Zuweisung im Code-Record reist,
  erzeugt eine Änderung dort einen **neuen** Code — der alte trägt noch die alte Zuweisung.
  Die QR-Payload bleibt unverändert `{url, code}`; das Terminal muss davon nichts wissen.

Drei Dinge, die die UI absichtlich tut:

- **Warnung vor dem letzten geteilten Terminal.** Das Personalnummer-Stempel-Panel erscheint nur
  auf `shared`-Geräten. Wird das letzte davon zugewiesen, hat der Standort keine Stempel-Station
  mehr. Die Warnung ist **beratend, keine Sperre** — es gibt legitime Aufstellungen ohne
  Stempel-Station, und das Dashboard-Statusmenü bleibt als Stempelpfad erhalten.
- **Beim Zurückschalten auf `shared` wird die Liste geleert.** Eine stehengebliebene Liste sähe
  beim nächsten Blick in die Datenbank wie eine aktive Zuweisung aus.
- **Fähigkeits-Sonde statt Versionsabfrage.** Echot der Edge in der `request-code`-Antwort kein
  `deviceAccessMode`, blendet die UI die Zuweisung aus. Ein älterer Edge würde die Auswahl beim
  Redeem stillschweigend verlieren — sie gar nicht erst anzubieten ist das ehrlichere Verhalten.

## Fail-closed — und was das kostet

Lässt sich die Geräte-Identität nicht auflösen oder gibt es keinen `devices`-Datensatz zur
authentifizierten `deviceId`, wird mit **403** abgelehnt statt die volle Liste auszuliefern.
Beide Fälle sind Anomalien: `allowApiKey` und die Print-Server-Middleware setzen bei jeder
Geräte-Rolle sowohl `deviceId` als auch `tenantId`.

Die Kehrseite: Eine vertippte oder ungültige `userId` in der Zuweisung erzeugt kein „etwas
fehlt", sondern ein Terminal, an das nur noch die Freigabe-Rollen herankommen. Deshalb prüft
`validateDeviceAssignment` jede ID gegen Mandant, `isPosUser` und `status: ACTIVE`, und deshalb
lehnt der Schreibpfad `assigned` mit leerer Liste ab — auch dann, wenn ein PATCH nur die Liste
leert und der Modus aus dem Bestand kommt.

## Die Multi-Tenancy-Falle

Der Exempt-Lookup läuft intern (`provider: undefined`). Dort stempelt `multiTenancy`
**nicht** — der Aufruf muss die `tenantId` selbst mitgeben. Ohne diesen Filter stünden die
Inhaber und Filialleiter **aller Mandanten** auf dem Login-Screen. Dasselbe gilt für den
Geräte-Lookup. Beides ist im Integrationstest mit einem zweiten Mandanten abgesichert
(`test/services/devices/device-assignment.test.ts`).

## Was die Zuweisung *nicht* leistet

- **Kein Schutz der Aktionen.** `verifyPin` stellt kein Token aus; `order.userId` ist
  client-behauptet. Die Zuweisung schützt den *Login*, nicht die *Aktionen* — dafür bräuchte es
  ein an `{userId, deviceId}` gebundenes Employee-Token.
- **Kein Zeiterfassungs-Nachweis.** `users.checkin` prüft die Personalnummer serverseitig nie.
  Auf zugewiesenen Geräten schließt das `users.find`-Scoping den bequemen Weg mit; der Endpunkt
  bleibt offen.
- **Kein Offboarding.** Wird ein zugewiesener Mitarbeiter *nachträglich* archiviert, bleibt die
  Zuweisung stehen und das Gerät sperrt sich aus. Beim Zuweisen wird der Status geprüft,
  danach nicht mehr.

Alle drei sind eigene Tickets, siehe ADR 0023.

## Verwandt

* [ADR 0023 — Zugewiesene POS-Geräte](../adr/0023-zugewiesene-pos-geraete.md)
* [POS-Pairing-Wizard](pos-pairing-wizard.md)
* [Geräte-Online-Tracking](geraete-online-tracking.md)
