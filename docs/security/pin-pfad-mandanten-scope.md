---
type: Architecture
title: Mandanten-Scope des PIN-Pfads am Edge
description: users.verifyPin lud den Ziel-User intern und verglich nur den bcrypt-Hash — der Mandant des Aufrufers blieb ungeprüft, anders als im benachbarten changePin; nachgezogen als Defense-in-Depth, mit einem klaren 403 statt der PIN-Tarnung, die zwei Absätze tiefer den Kontostatus verdeckt.
tags: [users, pos, devices, sync, security]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-18T04:20:00Z }
---

# Mandanten-Scope des PIN-Pfads am Edge (panary/panary-core#332)

`users.verifyPin` ist eine Custom-Method am `users`-Service. Sie bekommt eine `userId`
herein, lädt den Datensatz intern (`provider: undefined`, also ohne `multiTenancy`-Scoping)
und verglich bis #332 nur den bcrypt-Hash. **Wer fragt, wurde nicht geprüft.**
[`changePin`](../../apps/api-edge/src/services/users/users.ts) zehn Zeilen darunter machte
die Prüfung bereits und begründete sie: `multiTenancy` ist bei Custom-Methods ein No-Op.

Derselbe Mechanismus wie bei den vier Stempel-Methoden in
[Aufrufer-Scope der POS-Zeiterfassung](zeiterfassung-aufrufer-scope.md) — dort ist die
Tabelle, welcher Schutz bei Custom-Methods warum ausfällt. `verifyPin` blieb bei jener
Runde aus, obwohl es unmittelbar daneben liegt.

Gefunden bei der Umsetzung von [#325](../adr/0043-re-verifikation-nach-langer-offline-phase.md);
`releaseDeviceReverification` trägt deshalb seit damals eine eigene Tenant-Prüfung.

## Wie weit die Lücke am Edge trug

Die Frage ist nicht, ob `verifyPin` prüft, sondern ob am Edge überhaupt ein fremder Mandant
in der `users`-Tabelle liegen kann. Gemessen statt angenommen:

| Weg | Ergebnis |
|---|---|
| Cloud-Sync-Pull | **ausgeschlossen.** Basisfilter ist `{ tenantId: user.tenantId }`, gesetzt aus dem Edge-Token; die `users`-Strategie überschreibt ihn nicht (`panary-cloud/apps/api-cloud/src/services/sync/sync-pull-strategies.ts`) |
| Re-Pairing auf einen anderen Mandanten | **ausgeschlossen.** `applyCloudTenantId` stempelt in einer Transaktion jede Tabelle mit `tenantId`-Spalte um; `users` steht **nicht** in `RESTAMP_SKIP_TABLES` ([`utils/apply-cloud-tenant-id.ts`](../../apps/api-edge/src/utils/apply-cloud-tenant-id.ts)) |
| Seeds, Migrationen | **ausgeschlossen.** Keine `insert()` mit fremder `tenantId` |
| Unvollständiger oder ausgefallener Restamp | **nicht ausgeschlossen.** Genau diesen Zustand meldet `runConsistencyCheck` als `ERROR` („Records haben tenantId != cloudTenantId", [`bootstrap-report.helper.ts`](../../apps/api-edge/src/services/bootstrap-reports/bootstrap-report.helper.ts)) — einmalig nach dem Bootstrap, rein diagnostisch, ohne den Verbindungsstatus zu blockieren |

Dazu ein struktureller Punkt: Der Edge prüft die `tenantId` **eingehender Sync-Records beim
Apply nicht** (`applyPulledRecords` in [`workers/sync-apply.ts`](../../apps/api-edge/src/workers/sync-apply.ts)
übernimmt `record.tenantId` unverändert; `multiTenancy` ist bei `provider: undefined` ein
No-Op). Er verlässt sich vollständig auf die Filterung der Cloud. Das ist ein eigener
Befund, nicht Teil von #332.

**Einstufung: Defense-in-Depth, kein Vorfall.** Im Normalbetrieb ist die Lücke am Edge nicht
erreichbar — wohl aber in dem Zustand, den das Repo selbst als Fehlerfall diagnostiziert.
Das Gewicht liegt darin, wofür `verifyPin` einsteht: nicht nur der POS-Login, sondern auch
die Manager-Freigabe der Kassensitzung, der Storno und die Re-Verifikation nach langer
Offline-Phase — vier Entscheidungsstellen.

> Das **Cloud-Gegenstück ist eine andere Lage** und liegt als `panary/panary-cloud#469`:
> Dort hält eine Collection alle Mandanten, und `verifyPosPin` nimmt `params` gar nicht
> erst entgegen — sie *kann* den Aufrufer nicht prüfen.

## Warum ein klares 403 und keine PIN-Tarnung

`verifyPin` tarnt an zwei Stellen bewusst: Ein inaktives Konto bekommt wortgleich
`NotAuthenticated('PIN ungueltig')` wie eine falsche PIN, mitsamt `recordPinFailure` (#187),
und
[`restrict-device-access-mode.hook.ts`](../../apps/api-edge/src/hooks/restrict-device-access-mode.hook.ts)
tut dasselbe für die Geräte-Zuweisung. `changePin` antwortet auf den fremden Mandanten
dagegen mit einem klaren 403. Die beiden Stellen widersprachen sich; aufgelöst zugunsten
von **403**:

1. **Was die Tarnung schützt, steht hier nicht auf dem Spiel.** Beide getarnten Fälle
   beantworten eine Frage über den *eigenen* Betrieb, die jemand am Terminal sonst nicht
   stellen könnte („ist Kollege X noch aktiv?", „wem ist dieses Gerät zugewiesen?"). Eine
   `userId` aus einem fremden Mandanten gehört zu niemandem, den der Bediener hier sehen kann.
2. **Die Tarnung hätte hier einen Preis, den sie anderswo nicht hat.** Sie verlangt
   `recordPinFailure(userId)` — der PIN-Lockout einer Person eines *anderen* Mandanten
   würde gespannt. Vor derselben Klasse warnt bereits die Regel, `restrictDeviceAccessMode`
   nicht auf Nicht-PIN-Pfade zu ziehen.
3. **Das Existenz-Oracle besteht an dieser Stelle ohnehin.** Eine unbekannte `userId` läuft
   in ein `NotFound` (404) aus dem internen `get`, eine bekannte mit falscher PIN in 401 —
   unterscheidbar, ohne dass ein 403 hinzukäme.
4. **Der Fall ist kein Bedienfehler, sondern ein Datenintegritäts-Fehlerzustand.** Eine
   getarnte Ablehnung kostet die Diagnose genau dort, wo der Konsistenz-Check schon `ERROR`
   meldet. Der Klartext-Grund steht zusätzlich als `security.pin_login_foreign_tenant` im Log.

Die Prüfung steht **vor** dem Konto-Status-Check und vor `bcrypt.compare`. Stünde sie
dahinter, unterschieden Antwortzeit und Fehlversuchs-Zähler wieder Zustände fremder
Datensätze — dieselbe Reihenfolge-Begründung wie bei `assertTimeClockScope`.

## Warum die Prüfung in `releaseDeviceReverification` bleibt

Für den einzigen heutigen Aufrufer ist sie nach #332 redundant: `allowApiKey` bildet
`params.user.tenantId` aus genau der `conn.tenantId`, gegen die die Freigabe prüft. Sie
bleibt trotzdem stehen, weil

- die Fallback-Bedingungen nicht dieselben sind — der Guard in `verifyPin` lautet
  `if (actorTenantId && …)` und fällt aus, wenn `params.user` fehlt; die Freigabe liest
  stattdessen die Connection;
- `releaseDeviceReverification` exportiert ist und ihre Sicherheit nicht davon abhängen
  soll, dass ihr jeweiliger Aufrufer vorher geprüft hat.

Ein Test kann belegen, dass ein Pfad heute nicht erreichbar ist — nicht, dass er es bleibt.
Abgedeckt ist sie unabhängig durch „verweigert einem fremden Mandanten die Freigabe" in
`utils/device-reverification.spec.ts`, das direkt gegen die Funktion läuft. Nachgezogen
wurde nur ihr Kommentar: Er begründete sich damit, dass `verifyPin` nicht prüfe.

## Absicherung

`apps/api-edge/src/services/users/pin-tenant-scope.spec.ts` ruft die registrierte
Service-Instanz echt auf (Muster
[`time-clock-wiring.spec.ts`](../../apps/api-edge/src/services/users/time-clock-wiring.spec.ts)),
weil eine reine Policy-Spec grün bliebe, wenn jemand den Guard aus der Methode entfernt.
Geprüft werden Ablehnung, **Reihenfolge** (fremder Mandant *und* archiviert → 403, nicht
401), das Ausbleiben von `bcrypt.compare` und `recordPinFailure`, sowie als Gegenproben der
legitime Terminal-Pfad, die unveränderte PIN-Tarnung im eigenen Mandanten und der interne
Aufruf ohne `params`. Per Mutationsprobe gegengeprüft: Ohne den Guard fallen genau die drei
Guard-Tests, die vier Gegenproben bleiben grün.

---

## Nachtrag 2026-09-22 — die Prüfung liegt jetzt zentral

Seit [#357](https://github.com/panary/panary-core/issues/357) steht die
Mandanten-Eigentumsprüfung **nicht mehr in dieser Datei**, sondern als
`checkCallerOwnsRecord` in `@panary/shared-backend`
(`util-security/caller-owns-record.ts`). Anlass war das vierte Auftreten
derselben Lücke — in `pre-orders.convert()`, wo sie ganz fehlte, während es hier
und an zwei weiteren Stellen drei verschiedene Fassungen derselben vier Zeilen
gab.

Begründung, gemessene Erreichbarkeit und die Regel für neue Custom Methods:
[ADR 0046](../adr/0046-eigentums-check-fuer-custom-methods.md).

⚠️ **Hier wurde mit #357 bewusst NICHTS verschärft.** `verifyPin` und `changePin`
rufen jetzt den geteilten Helfer auf, setzen aber `allowMissingTenantContext` und
verhalten sich damit exakt wie vorher. Ob ein Aufrufer **ohne** Mandantenkontext
diese Methoden überhaupt erreichen kann, ist **ungemessen** — kein Test deckt den
Fall ab. Ihn blind zu schließen hieße, den PIN-Login am POS gegen eine Vermutung
zu tauschen; er gehört gemessen, bevor er verschärft wird.
