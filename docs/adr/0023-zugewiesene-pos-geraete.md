---
type: ADR
title: Zugewiesene POS-Geräte — explizites Enum statt abgeleitetem Modus, Durchsetzung im Query-Resolver
description: Ein Gerät kann optional auf 1–5 Mitarbeiter eingeschränkt werden; der Modus ist ein eigenes Feld statt aus der Listenlänge abgeleitet, und durchgesetzt wird er serverseitig im userQueryResolver, nicht im POS-Client.
tags: [devices, users, security, pos]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-10T20:45:00.000Z }
---

## Problem

Ein POS-Client wird per Pairing-Code an einen Edge oder direkt an die Cloud gekoppelt; danach
zeigt der Login-Screen **alle** POS-Benutzer des Standorts. Für rotierende Theken-Terminals ist
das richtig. Für das mobile Szenario ist es falsch: Ein Kellner nimmt mit dem Diensthandy
Bestellungen auf und kassiert per Tap-to-Pay — dieses Gerät gehört einer Person, und die
Belegschaftsliste auf dem Login-Screen ist dort weder nötig noch gewollt.

Aus der Anforderung „ein Gerät kann einem Mitarbeiter gehören" folgen drei Entscheidungen, die
sich später nur teuer korrigieren lassen: **wo** die Einschränkung durchgesetzt wird, **wie** der
Zustand „eingeschränkt" repräsentiert wird, und **wer** trotz Einschränkung sichtbar bleiben muss.

## Entscheidung

### 1. Durchsetzung im `userQueryResolver`, nicht im Client

Die Einschränkung sitzt in `apps/api-edge/src/services/users/users.schema.ts` im
`userQueryResolver`. Dort steht bereits die Ausnahme „Device-Rollen brauchen die volle User-Liste
für den Login-Screen" — genau diese wird konditioniert. Weil der Resolver auf der Query wirkt,
greift er für `find` **und** `get`; get-by-id ist damit kein Umweg. Der POS-Umbau (direkter
Sprung in die PIN-Eingabe, ausgeblendetes Stempel-Panel) ist reine UX und **keine
Sicherheitsgrenze** — die Zuweisung wirkt auch gegen einen alten oder manipulierten Client.

Die *Auflösung* des Personenkreises liegt allerdings nicht im Resolver, sondern in einem
`before.all`-Hook (`resolveDeviceAccessScope`), der das Ergebnis auf `context.params` legt.
Grund: Feathers verpackt jeden Fehler aus `resolveQuery` in ein
`BadRequest('Error resolving data')`. Die fail-closed-Ablehnung eines unbekannten Geräts käme
sonst als 400 mit unbrauchbarer Meldung an statt als 403. Nebeneffekt: Resolver und
`verifyPin`-Hook teilen sich dieselbe Auflösung, statt sie nacheinander zweimal zu machen.
Details: [Domain-Konzept](../domains/pos-geraete-zuweisung.md).

Ergänzend lehnt `verifyPin` fremde `userId`s mit **derselben Meldung** wie einen falschen PIN ab.
Ein eigener Text wäre ein Oracle, an dem sich die Zuweisung eines Geräts abfragen ließe.

### 2. Explizites Enum statt abgeleitetem Modus

`deviceAccessMode: 'shared' | 'assigned'` ist ein eigenes Feld, **nicht** aus der Länge von
`assignedUserIds` abgeleitet. Der Unterschied wird genau einmal sichtbar, dann aber teuer: Würde
der Modus aus der Listenlänge folgen, fiele ein Gerät beim Archivieren des letzten zugewiesenen
Mitarbeiters still auf `shared` zurück — auf dem Diensthandy erschiene plötzlich die gesamte
Belegschaft. `assigned` mit leerer Liste bedeutet deshalb **niemand**, nicht „alle"; der
Schreibpfad lehnt diesen Zustand ab (`EMPTY_ASSIGNMENT`), statt ihn stillschweigend umzudeuten.

Beide Felder sind optional und die Migration setzt **keinen DB-Default und macht keinen
Backfill**: `NULL → shared` ist die Abwärtskompatibilitäts-Garantie für Bestandsgeräte und lebt
an genau einer Stelle (`resolveDeviceAccessMode` in `@panary/devices/domain`). Ein DB-Default
wäre die zweite Wahrheit, die beim nächsten Modus-Wert auseinanderläuft.

Auf der **Lese**seite ist die Auflösung bewusst nachsichtig — alles außer dem exakten Literal
`assigned` gilt als `shared`, auch Tippfehler und unbekannte Zukunftswerte eines neueren
Clients. Ein unlesbarer Modus darf ein Terminal nie aussperren. Streng ist ausschließlich der
**Schreib**pfad.

### 3. Freigabe-Rollen bleiben immer sichtbar

Der erlaubte Personenkreis eines zugewiesenen Geräts ist
`assignedUserIds ∪ DEVICE_ACCESS_EXEMPT_ROLES`. Ohne diese Vereinigung wären drei Notfallpfade
tot, die alle `users` per `role: { $in: [...] }` abfragen: Storno-Freigabe,
Kassenabschluss-Freigabe und — am schlimmsten — das **Entkoppeln** des Geräts, das damit
unwiderruflich blockiert wäre.

Die drei Rollenkreise lagen vorher als lokale Kopien in ihren Dialogen und liegen jetzt zentral
in `@panary/users/domain` (`pos-authorization-roles.ts`). `DEVICE_ACCESS_EXEMPT_ROLES` selbst
hält String-Literale, weil die devices-Domain die users-Domain nicht importieren darf
(Publish-Build-Zyklus, CLAUDE.md §2.1); die Übereinstimmung lockt ein Invarianten-Test in
`apps/api-edge` — der wertvollste Test des Features.

### 4. Gepflegt wird dort, wo gepairt wurde

`devices` wird nicht zwischen Edge und Cloud gesynct. Für die Korrektheit ist das irrelevant:
Die Bindung wird immer in dem Prozess ausgewertet, der das Gerät auch per API-Key
authentifiziert hat. Die Zuweisung wird deshalb dort gepflegt, wo das Gerät gepairt wurde —
im lokalen Hub-Betrieb ist der Edge-Admin der einzige Ort. Das entspricht dem heutigen Zustand
für `name`, `active` und `uiScale`.

### 5. Biometrie vertagt

Ein biometrischer Login wäre die naheliegende Fortsetzung, ist aber heute nicht baubar: Der POS
baut nur Tauri Windows+macOS ohne Biometrie-Plugin, und der Edge läuft im LAN ohne TLS — kein
Secure Context für WebAuthn. Auslösekriterium ist ein Capacitor-Client mit Sensor auf der
Zielhardware **oder** POS über HTTPS. Dann als „gerätegebundener Schlüssel + Server-Challenge",
**nicht** als `if (bio) skipPin` — das wäre serverseitig unsichtbar. Der PIN bleibt in jedem
Fall Pflicht-Fallback.

## Konsequenzen

- **Point of no Return.** Sobald das erste Gerät auf `assigned` steht, öffnet ein Rollback der
  Server-Hälfte dieses Gerät still für die gesamte Belegschaft — die Spalte bliebe stehen, aber
  niemand würde sie mehr auswerten. Ein Rollback verlangt deshalb, vorher alle Geräte auf
  `shared` zurückzustellen.
- **Release-Reihenfolge: Server vor Client, immer.** `additionalProperties: false` bedeutet, dass
  ein alter Server einem neuen Client mit 400 antwortet; umgekehrt ist harmlos. `core` hat
  keinen Staging-Kanal — ein `v*`-Tag rollt binnen einer Stunde auf alle Kunden aus.
- **Ein zugewiesenes Gerät kann sich per Fehlbedienung aussperren.** Eine vertippte `userId`
  ergäbe fail-closed ein totes Terminal. Deshalb validiert der Schreibpfad jede ID gegen
  Tenant/Standort und `isPosUser`, und die Zuweisungs-Felder sind **niemals** self-patchable —
  sie *sind* die Zugriffsentscheidung.
- **Offboarding bleibt offen.** Wird ein zugewiesener Mitarbeiter archiviert, bleibt die
  Zuweisung stehen und das Gerät sperrt sich aus. Mindestens eine Admin-Warnung („ist an N
  Geräten zugewiesen"), besser ein Hook, der die ID entfernt — eigenes Ticket.
- **Ein zugewiesenes Gerät ist per PIN-Fehlversuch blockierbar.** Zehn Fehlversuche sperren den
  bekannten Ziel-User, ohne dass ein Manager ausweichen kann. Die PIN-Härtung (exponentielles
  Backoff, zweiter Zähler pro `deviceId`) ist ein eigenes Ticket und wird durch dieses Feature
  dringlicher.
- **Das Stempel-Panel auszublenden ist bewusst UI-Kosmetik.** `users.checkin` prüft die
  Personalnummer serverseitig nicht. Auf zugewiesenen Geräten schließt das `users.find`-Scoping
  den bequemen Weg mit; der Endpunkt bleibt offen (eigenes Ticket).

## Verweise

- Umsetzung: `libs/domains/devices/domain/src/lib/device-access-mode.ts`,
  `apps/api-edge/migrations/20260810203000_devices_add_access_mode.ts`
- Rollenkreise: `libs/domains/users/domain/src/lib/pos-authorization-roles.ts`
- Cloud-Gegenstück (Spiegel-Enforcement, Admin-Zuweisung): `panary/panary-cloud#130`
- Verwandt: [Geräte-Self-Patch-Policy](../security/edge-authorize-hybrid-rbac.md)
