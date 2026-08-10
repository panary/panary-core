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
