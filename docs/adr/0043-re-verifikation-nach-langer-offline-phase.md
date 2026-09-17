---
type: ADR
title: Re-Verifikation nach langer Offline-Phase — getrennt vom Schlüsselablauf
description: Ein Gerät, das länger als die Schwelle des Standorts (Default 7 Tage) nicht gesprochen hat, wird beim Handshake nicht abgewiesen, sondern markiert; Schreibzugriffe sperrt der Server, bis eine Person per PIN freigibt — Leitung regulär, jede andere PIN als protokollierte Notfreigabe.
tags: [api-edge, devices, apikeys, security, pos-client, audit-events, locations]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-17T18:40:00.000Z }
---

# Re-Verifikation nach langer Offline-Phase

## Problem

Die Schlüsselhygiene aus [ADR 0042](0042-geraete-schluessel-rotation-mit-karenz.md) löst
eine Frage nicht: *Wenn ein Gerät mehrere Tage nicht online war, sollte es sich erneut kurz
verifizieren.* Über den Schlüsselablauf ist das nicht erreichbar — und zwar grundsätzlich
nicht. ADR 0042 ist mit dem ausdrücklichen Grundsatz gebaut, dass `validUntil` **nie**
abweist, solange die Karenz läuft, weil ein abgelehnter Handshake das Terminal
**unbedienbar und unreparierbar** macht: Der Weg zurück (Entkoppeln) braucht selbst einen
Server-Roundtrip (`login.component.ts`, Zweig `DEVICE_KEY_EXPIRED`). Einen Ablehnungsgrund
hinzuzufügen, den der Bediener nicht auflösen kann, wäre der genau falsche Hebel.

Der Anknüpfungspunkt existierte dagegen schon: `apikeys.lastUsedAt` wird bei jedem
erfolgreichen Handshake gestempelt (gedrosselt, `utils/apikey-last-used.ts`). Der Server
weiß also, wann ein Gerät zuletzt gesprochen hat.

Zum Umfeld gehört, dass ein POS-Gerät **kein Keepalive** hat — anders als der Edge mit
seinen 4 h (`cloud-sync-scheduler.worker.ts`). Ein ausgeschaltetes Terminal funkt gar
nicht. Realistische Pausen im Alltag: Nacht (~16 h), Wochenende (~60 h), Ruhetag plus
Wochenende (~84 h).

## Entscheidung

Ein eigener, leichter Mechanismus **neben** dem Schlüsselablauf. Beide fassen dieselbe
Tabelle an und dürfen sich nicht gegenseitig zurücksetzen; sie sind deshalb an getrennten
Feldern aufgehängt — Rotation an `validUntil`/`pendingApikey`, Re-Verifikation an
`lastUsedAt`. Keine der Rotations-Patches schreibt `lastUsedAt`, und der Handshake bewertet
die Pause **vor** dem Stempel. Eine Rotation im selben Handshake ändert das Urteil deshalb
nicht.

### Der Handshake markiert, er weist nicht ab

`channels.ts` bewertet nach erfolgreicher Authentifizierung
`now - apikeys.lastUsedAt` gegen die Schwelle und stempelt bei Überschreitung
`requiresReverification` auf die Socket-Connection. Der Client erfährt es als zusätzliches
Feld in `device:authenticated` (`success: true`) — die Verbindung steht, Lesen
funktioniert. Das ist der ganze Unterschied zu ADR 0042: dort ein `success: false` mit
Fehlercode, hier ein Merkmal auf einer lebenden Verbindung.

**Fail-open ohne Stempel.** Ein Schlüssel ohne `lastUsedAt` hat nie behauptet, lange weg
gewesen zu sein. Ihn auf Verdacht zu sperren hieße, beim Deploy die halbe Flotte
gleichzeitig vor den Bestätigungsbildschirm zu schicken, ohne dass irgendetwas vorgefallen
wäre. Derselbe Handshake stempelt; ab dann misst die Regel echte Daten. Dieselbe Richtung
wie `stampInitialValidUntil` in ADR 0042.

### Durchsetzung serverseitig, mit Allowlist

`hooks/require-device-reverification.hook.ts` läuft als App-Level-Hook direkt hinter
`allowApiKey` und lehnt ab, solange das Merkmal steht. Erlaubt bleiben genau drei Methoden:

| Methode           | Warum erlaubt                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- |
| `find`            | Ohne Lesen zeigt das Terminal einen leeren Bildschirm — die freigebende Person wäre nicht auswählbar. |
| `get`             | dito                                                                                   |
| `users.verifyPin` | **Ist** der Freigabe-Pfad. Ohne ihn wäre der Zustand nicht auflösbar.                  |

**Allowlist statt Verbotsliste**, obwohl das Issue nur `orders.create/patch` als Minimum
nannte. Eine Liste gesperrter Pfade müsste bei jeder neuen Custom-Method nachgezogen
werden, und die vergessene Zeile fällt erst auf, wenn sie jemand ausnutzt. So ist eine neue
Methode ohne Zutun gesperrt. Interne Aufrufe (`provider: undefined` — Sync-Apply, Worker,
Bootstrap) und JWT-Sessions im Admin sind nicht betroffen: Das Merkmal hängt an der
Socket-Connection, die der Geräte-Handshake gestempelt hat.

Der Bildschirm am Terminal ist Bedienerführung, **keine** Sicherheitsgrenze. Wer den
Schlüssel hat, spricht direkt mit dem Socket und sieht kein Angular.

### 🚨 Der Ablehnungscode ist 503, nicht 403

`classifyOutboxError` (`libs/shared/offline-cache/src/lib/outbox.ts`) stuft
**400/401/403/422 als `terminal`** ein → `markRejected` verwirft den Outbox-Eintrag. Ein
403 hätte jede offline erfasste Bestellung eines wartenden Terminals nicht verzögert,
sondern **gelöscht**. `Unavailable` (503) fällt in den `transient`-Zweig: Die Bestellung
bleibt liegen und läuft nach der Freigabe durch. Gelockt in
`libs/shared/offline-cache/src/lib/outbox.classify.spec.ts` — dort, wo der Klassifizierer
lebt, weil der Hook-Test dessen Barrel (Angular) nicht importieren kann.

Der stabile Diskriminator für den Client ist `data.code === 'DEVICE_REVERIFICATION_REQUIRED'`.

### Freigabe über `users.verifyPin`, nicht über eine neue Methode

Die Freigabe hängt sich an den bestehenden PIN-Pfad
(`services/users/users.ts` → `releaseDeviceReverification`). Damit gelten der
PIN-Brute-Force-Schutz (10 Fehlversuche / 5 min → 60 s Sperre,
`pin-attempt-limiter.ts`), die Konto-Status-Sperre (`isLoginBlockedByStatus`) und der
Geräte-Zuweisungs-Hook (`restrictDeviceAccessMode`) unverändert. Ein zweiter PIN-Endpunkt
wäre ein zweiter Ort, an dem genau das vergessen werden kann.

Zwei Dinge, die die Freigabe zusätzlich tut und `verifyPin` selbst nicht kennt:

- **Mandanten-Prüfung.** `verifyPin` lädt den User mit `provider: undefined` und prüft den
  Tenant **nicht** (anders als `changePin`). Für eine Freigabe wäre das die falsche Stelle,
  darüber hinwegzusehen.
- **Erzwungener Stempel.** `stampApiKeyLastUsed(..., { force: true })` umgeht die
  5-Minuten-Drossel. Ohne das träfe ein Reconnect in den nächsten fünf Minuten noch auf den
  alten `lastUsedAt`, und der Bediener stünde wieder vor dem Bildschirm, den er gerade
  quittiert hat.

### Wer freigeben darf: Leitung regulär, jede andere PIN als Notfreigabe

`DEVICE_REVERIFY_AUTHORIZING_ROLES` (`@panary/users/domain`) = `tenant:owner`,
`tenant:manager`, `tenant:technician` — deckungsgleich mit `UNPAIR_ALLOWED_ROLES`, aber
bewusst ein eigener Name, damit sich beide Kreise später unabhängig bewegen können.

**Der Kreis ist nicht die einzige Tür.** Jedes andere gültige Konto gibt ebenfalls frei — als
**Notfreigabe** mit `AuditSeverity.ALERT`. Begründung: Nach Betriebsferien steht morgens um
sechs jemand vor dem Terminal, der keine Leitungs-PIN hat. Das ist der teuerste denkbare
Moment, und ein Terminal, das dann stehen bleibt, kostet einen Betriebstag. Der Schutzwert
der harten Variante ist zugleich gering: Gegen jemanden, der Gerät **und** eine gültige PIN
hat, schützt die Abfrage ohnehin nicht — dafür ist `active: false` der Weg. Sichtbar bleibt
der Sonderfall trotzdem, und genau das ist der Gegenwert.

Verworfen: eine Freigabe aus der Cloud-Admin-Oberfläche („der Inhaber gibt vom Handy frei").
Sie bräuchte einen eigenen Cloud→Edge-Pfad samt Allowlist-Eintrag
(`EDGE_TOKEN_SCOPED_PATHS`) und passt nicht mehr in eine PR-Größe. Bleibt als Option, wenn
sich die Notfreigabe im Betrieb als zu weich erweist.

### Schwelle: 7 Tage, konfigurierbar je Standort, Untergrenze 4 Tage

`location.settings.deviceSecuritySettings.offlineReverifyDays`, Vorbild
`genericUserSettings.autoLogOffTime` ([ADR 0016](0016-pos-auto-logout-inaktivitaet.md)).
Optional und **ohne** Eintrag in `defaultSettings`: „nicht gesetzt" ist der Regelfall und
bedeutet 7 Tage.

Die Auflösung liegt in `resolveDeviceReverifyThresholdMs` (`@panary/devices/domain`) und
**klammert** statt abzulehnen — Untergrenze 4 Tage, Obergrenze 90. Das Schema lässt das Feld
bewusst als freies `Type.Number()` stehen: Eine Inline-Constraint in einem geteilten
Domain-Schema würde einen Bestands-Standort beim Cloud→Edge-Sync terminal ablehnen und den
ganzen Datensatz verlieren — dieselbe Klasse wie `autoLogOffTimeUnit` und wie die
Härtung vom 2026-05-22.

Die Untergrenze ist Betriebsschutz, kein Geschmack: Sie liegt über Ruhetag-plus-Wochenende
(~3,5 Tage). Eine Abfrage, die jeden Montag kommt, wird weggetippt wie jede Gewohnheit — dann
ist sie wertlos, wenn sie einmal zählt. Dieselbe Klasse wie die Warnungs-Ermüdung in
`.claude/rules/workflow-plan-issue-worktree.md` §4.

Eine Schwelle „nie" gibt es nicht; sie wäre ein stiller Aus-Schalter, den im Betrieb niemand
als solchen erkennt.

### 🚨 Audit: bestehende `AuditAction`-Werte, kein neuer Enum-Eintrag

`audit-events` werden Edge→Cloud gepusht und dort gegen **dasselbe, aber älter gepinnte**
`@panary/audit-events`-Enum validiert. Ein unbekannter Wert ergibt `BadRequest` →
`classifyAcceptError` → `TERMINAL`: Der Eintrag wird ohne Retry und **ohne**
`sync-conflicts`-Eintrag verworfen, es gibt nur eine `sync.push.op_rejected`-Warnzeile.
Präzedenzfall im Repo: `recordOrphanDiscardAudit` in `services/business-days/`.

Deshalb:

| Vorgang    | `action`       | `outcome` | `severity`               | `metadata.reason`                          |
| ---------- | -------------- | --------- | ------------------------ | ------------------------------------------ |
| Auslösung  | `LOGIN_FAILED` | `FAILURE` | `WARNING`                | `device-reverification-required`           |
| Freigabe   | `PIN_VERIFY`   | `SUCCESS` | `NOTICE`                 | `device-reverification-granted`            |
| Notfreigabe| `PIN_VERIFY`   | `SUCCESS` | `ALERT`                  | `device-reverification-emergency-granted`  |

`LOGIN_FAILED` ist der einzige `ACCESS`-Wert mit `FAILURE`-Semantik im gepinnten Enum;
zutreffend ist er trotzdem — der betriebliche Zugriff des Geräts *wurde* verweigert. In der
Cloud-UI liest er als „Login fehlgeschlagen", was gröber ist als der Vorgang. Der präzise
Sachverhalt steht in `metadata.reason`, zusammen mit `offlineForHours`, `thresholdHours` und
`emergency`. Sobald der Cloud-Pin auf eine Core-Version nach diesem ADR steht, kann ein
eigener `DEVICE_REVERIFY`-Wert nachgezogen werden — vorher nicht.

Der Actor der **Auslösung** ist das Gerät (`device:<uuid>`, Format wie in
`allow-apikey.hook.ts`); genau dafür trägt `auditActorSchema.userId` kein `format: 'uuid'`.

### Offline-Fall bleibt unberührt

Die Re-Verifikation braucht den Server (`verifyPin` ist serverseitig) und löst nur aus, wenn
das Gerät **verbunden** ist — das Merkmal stammt aus dem Handshake. Offline steht es nie, der
bestehende Offline-Modus gilt unverändert. Ein Terminal darf nicht zwischen „offline" und
„muss sich verifizieren" eingeklemmt werden.

## Konsequenzen

**Was besser wird**

- Ein Gerät, das über eine Woche verschwunden war (Betriebsferien, vergessenes Zweitgerät,
  entwendetes Terminal), verlangt einmal eine Person, bevor es kassiert.
- Der Alltagsbetrieb merkt nichts: Nacht, Wochenende und Ruhetag plus Wochenende liegen
  unter der Untergrenze, geschweige denn unter dem Default.
- Der Trail beantwortet im Nachhinein, welches Gerät wie lange weg war und wer es
  zurückgeholt hat — inklusive der Frage, ob das eine Leitung war.

**Was der Mechanismus nicht leistet**

- Er schützt **nicht** gegen jemanden, der das Gerät im laufenden Betrieb entwendet und
  binnen der Schwelle verwendet. Dafür ist die Sperrung über `active: false` der Weg.
- Die Notfreigabe ist per Konstruktion weich: Wer Gerät und irgendeine gültige PIN hat, kommt
  durch. Der Gegenwert ist Sichtbarkeit (`ALERT`), nicht Verhinderung.
- Ob die Schwelle im echten Gastronomiebetrieb richtig liegt, ist eine **Setzung, keine
  Messung** — im Repo existiert keine dokumentierte Annahme über zulässige Offline-Dauern
  eines POS-Geräts. Betriebsferien lösen die Abfrage planmäßig aus.

**Offene Folgearbeiten**

- **Cloud-UI für die Schwelle.** Core liest `offlineReverifyDays`; editierbar wird sie erst,
  wenn `panary-cloud` den `@panary/locations`-Pin auf eine Version nach diesem ADR hebt und
  ein Feld in den Standort-Einstellungen anbietet. Bis dahin gilt flottenweit der Default.
- **Eigener `DEVICE_REVERIFY`-Audit-Wert** nach demselben Pin-Bump (siehe oben).
- **Cloud-Tier („cloud-direct", `panary-cloud/apps/api-cloud/src/channels.ts`)** hat dieselbe
  Ausgangslage. Ob der Mechanismus dort gespiegelt wird, ist eine eigene Entscheidung und
  bewusst nicht Teil dieses ADR.
- **Print-Server-Pfad** ist nicht erfasst: Er authentifiziert pro HTTP-Request über eine
  Middleware, nicht über die Feathers-Hook-Kette. Ein wartendes Terminal kann also weiter
  drucken. Bewusst so — ein Bon ist kein Umsatz, und der Pfad hat keinen Kanal, über den eine
  Bestätigung erteilt werden könnte.

## Verwandt

- [ADR 0042 — Geräte-Schlüssel: Rotation mit Karenz](0042-geraete-schluessel-rotation-mit-karenz.md)
- [ADR 0016 — POS-Auto-Logout bei Inaktivität](0016-pos-auto-logout-inaktivitaet.md)
- Geräte-Zuweisung: `libs/domains/devices/domain/src/lib/device-access-mode.ts`
