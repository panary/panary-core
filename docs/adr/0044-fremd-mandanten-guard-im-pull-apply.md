---
type: ADR
title: Fremd-Mandanten-Guard im Pull-Apply — erkennen und melden statt ablehnen
description: Ein gepullter Record mit fremder `tenantId` wird am Edge erkannt, protokolliert und als Raste auf `cloud-connection` festgehalten — aber trotzdem angewandt, weil der Pull-Cursor unabhängig vom Apply-Ergebnis vorrückt; gemeldet wird der Befund über den Heartbeat, den einzigen Kanal, der den Edge in Richtung Support verlässt.
tags: [api-edge, sync, security, cloud-connection, multi-tenancy, heartbeat]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-18T13:05:00.000Z }
---

# Fremd-Mandanten-Guard im Pull-Apply

## Problem

`applyPulledRecords` nahm die `tenantId` eines aus der Cloud gepullten Records
unverändert und schrieb sie über die Adapter-API weiter. Drei gezielte Strips gab es
(`_deletedAt`, Legacy-`order.discount`, `USER_EDGE_LOCAL_FIELDS` bei `users`) — aber
keinen Abgleich gegen den Mandanten, auf den der Edge gepairt ist. `multiTenancy` greift
dort nicht: Der Aufruf läuft mit `provider: undefined` und ohne `params.user`, der Hook
lässt interne Aufrufe durch.

Cloud-seitig ist der Pull hart gescopet (Basisfilter `{ tenantId: user.tenantId }`,
`sync-pull-strategies.ts`). Der Befund war also keine offene Tür, sondern eine fehlende
zweite Linie: Ein Fehler in der Cloud-Filterung, ein falsch ausgestelltes Edge-Token oder
ein Bug in einer künftigen `applyScope`-Strategie landete ungebremst als Fremdzeile in der
Edge-DB. Dass der Zustand vorkommen *kann*, nimmt das Repo selbst an — `runConsistencyCheck`
prüft nach jedem Bootstrap `tenantId != cloudTenantId` je Tabelle und meldet Treffer als
`ERROR`. Diese Prüfung ist allerdings einmalig, rein diagnostisch und läuft im laufenden
Sync-Betrieb gar nicht.

Gefunden bei [#332](../security/pin-pfad-mandanten-scope.md): Dort war die Leitfrage, ob am
Edge überhaupt ein fremder Mandant in `users` liegen kann. Die Antwort war „im Normalbetrieb
nein" — aber die Begründung stützte sich vollständig darauf, dass die Cloud richtig filtert.

## Entscheidung

### 1. Erkennen, nicht ablehnen

Ein Record mit fremder `tenantId` wird **trotzdem angewandt**. Er zählt in `applied`, nicht
in `rejected`.

Das ist keine Nachlässigkeit, sondern die Bedingung dafür, dass der Guard überhaupt gebaut
werden durfte. `upsertCursor` (`cloud-sync-scheduler.worker.ts`) rückt **unabhängig vom
Ergebnis** des Apply vor. Ein hier abgelehnter Record käme deshalb nie wieder — der nächste
Pull liefert nur Neueres. Das ist kein verzögerter Retry, sondern stiller Totalverlust; die
beiden bestehenden Strips existieren ausschließlich deswegen.

Ein naiv eingebauter „fremder Tenant → reject"-Guard wäre damit **gefährlicher als die
Lücke, die er schließt**: In jeder Lage, in der er fälschlich anschlägt — Re-Pairing mit
noch nicht gelaufenem Restamp, Bootstrap-Reihenfolge, ein Edge ohne gesetzte
`connection.tenantId` — ließe er eine ganze Pull-Seite dauerhaft verschwinden.

Ob schärfer abgelehnt werden darf, entscheidet die Messung, nicht die Intuition: Taucht
`sync.pull.foreign_tenant_record` im Betrieb nie auf, ist der Fall ausgeschlossen. Dieselbe
Logik, mit der `sync.pull.legacy_discount_stripped` eingeführt wurde.

### 2. Drei bewusste Nicht-Treffer

`detectForeignTenantId` liefert `null`, wenn

* **kein erwarteter Mandant bekannt ist** (fail-open) — Erstinstallation und Pairing vor dem
  Restamp sind legitime Zustände ohne Referenz;
* **der Record keine `tenantId` führt** — `tenants` trägt seine Identität in `_id`, und die
  Edge-Replica hat gar keine `tenantId`-Spalte. Cloud-seitig ist das dieselbe
  Fallunterscheidung (`{ _id: user.tenantId }` statt `{ tenantId: … }`);
* **der Wert ein Leerstring ist** — ein Datenfehler, kein Mandantenwechsel.

### 3. Verdichtung pro Pull-Seite

Eine gebrochene Cloud-Filterung liefert nicht einen Fremdrecord, sondern eine ganze Seite.
Es gibt deshalb **eine** Logzeile und **einen** Rasten-Patch je Apply-Aufruf, nicht je
Record; die Stichprobe der Entity-IDs ist auf fünf gedeckelt. Dieselbe Lehre wie bei der
Alarm-Verdichtung der Cloud (`panary-cloud` ADR 0058): N Vorfälle sind eine Meldung, nicht N.

### 4. Der Heartbeat ist der Meldeweg — mangels Alternative

Ein `logger.warn` allein wäre ein Alarm in einer Datei, die niemand öffnet. Der Mandant hat
keine technischen Kenntnisse, und der Befund tritt genau dann auf, wenn niemand hinsieht.
Gemessen wurde, welche Kanäle den Edge überhaupt in Richtung Support verlassen:

| Kanal | Erreicht den Support? |
|---|---|
| `sync-runs`, `bootstrap-reports` | **Nein** — reine Edge-SQLite ohne jeden Cloud-Push |
| Sentry o. ä. im `api-edge` | **Nein** — existiert nicht, Winston mit lokaler Rotationsdatei |
| `platform-alerts` | **Nein** — `platformOnlyHook` wirft, sobald `params.provider` gesetzt ist |
| `audit-events` | Ja, aber neue `AuditAction` → Cloud lehnt den Push ab, bis das gepinnte Paket gebaut ist |
| **Heartbeat** | **Ja, ohne Reihenfolge-Kopplung** |

Der Heartbeat gewinnt aus einem Grund, der nach Detail aussieht und keiner ist: `api-cloud`
registriert `sync-heartbeat` bewusst **ohne** `validateData` und liest Zusatzfelder per
Coercion aus dem rohen Body. Eine Cloud, die `foreignTenantRecords` noch nicht kennt,
ignoriert es — statt den Push abzulehnen. Beim Audit-Event-Weg dagegen ginge ausgerechnet
die Meldung verloren, um die es geht, wenn die Cloud noch nicht nachgezogen hat.

🚫 Daraus folgt die harte Grenze für die Cloud-Hälfte: Das Feld darf dort **niemals** über
einen `validateData`-Hook geprüft werden. Ein 400 auf diesem Pfad zählt am Edge
`consecutiveHeartbeatFailures` hoch und kippt die Kundenflotte binnen fünf Minuten in den
Notfall-Modus — eine Schema-Verschärfung würde nicht einen Wert ablehnen, sondern den
Betrieb umlegen.

### 5. Die Raste ist persistent und klebrig

Die Sichtung wird auf `cloud-connection` festgehalten
(`foreignTenantRecordsAt`, `foreignTenantRecordsCount`, `foreignTenantRecordsLastTenantId`),
nicht im RAM. Der Record ist nach dem Apply geschrieben und der Cursor vorgerückt — ginge
die Sichtung beim nächsten Neustart verloren, wäre sie für immer weg. Dieselbe Klasse wie
der In-Memory-Breach-State, der die Cloud-AlertEngine schon einmal blind gemacht hat
(`panary-cloud` ADR 0057).

Geleert wird sie an genau einer Stelle: beim Restamp im Bootstrap-Runner, also beim
Re-Pairing auf einen anderen Mandanten. Ohne das meldete ein Edge nach einem völlig
legitimen Mandantenwechsel dauerhaft einen Fehlalarm.

## Konsequenzen

* Der Guard ist eine **zweite Linie**, keine Sperre. Er verhindert nichts; er macht sichtbar.
* **Bestandszeilen findet er grundsätzlich nicht.** Er sieht nur, was neu hereinkommt.
  Rückwirkend sagt das nur der letzte Bootstrap-Report je Gerät — und der beschreibt den
  Stand beim Bootstrap, nicht heute.
* Ein Treffer ist **kein Sync-Problem**. Er ist ein Hinweis auf die Cloud-Filterung oder das
  Edge-Token; der Edge ist nur der Zeuge.
* `applyPulledRecords` hat eine erweiterte Signatur und einen zusätzlichen Rückgabewert
  (`foreignTenant`). Das Modul ist geteilter Code dreier Worker — alle drei reichen den
  erwarteten Mandanten durch. Im Bootstrap ist das die **neue** `cloudTenantId`: Der Restamp
  läuft nachweislich vor dem Pull (`applyCloudTenantId`, dann Connection-`_patch`, dann erst
  `runPullCloudToEdge` mit der frisch nachgeladenen Connection).
* Die Meldung bleibt **unvollständig, bis die Cloud-Hälfte steht**: Bis dahin trägt der
  Heartbeat den Befund zwar, aber niemand wertet ihn aus. Die Raste geht dabei nicht
  verloren — sie ist klebrig und wird bei jedem Heartbeat erneut gemeldet.
* `runConsistencyCheck` bleibt unverändert. Ob derselbe Abgleich auch außerhalb des
  Bootstraps laufen sollte, ist bewusst offen und nicht Teil dieser Entscheidung.
