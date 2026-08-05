---
type: ADR
title: HTTP 429 ist ein Rückstau-Signal, kein Fehlversuch — wie der Edge Drosselung der Cloud behandelt
description: Ein Cloud-429 zählt am Edge nicht mehr als Heartbeat-Fehlversuch und kann damit den Notfall-Modus nicht mehr auslösen; Retry-After ist bindend, die Outbox bleibt pending ohne attempts++, und der laufende Sync-Cycle bricht ab statt gegen ein leeres Kontingent weiterzuschlagen.
tags: [sync, cloud-connection, api-edge, admin-client]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-05T17:10:00.000Z }
---

# HTTP 429 ist ein Rückstau-Signal, kein Fehlversuch

## Problem

`apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts` prüfte auf **allen**
Cloud-Aufrufen ausschließlich `response.ok`. Ein `429 Too Many Requests` war damit von
einem Serverfehler nicht zu unterscheiden — und lief in drei Konsequenzen, die sich in
ihrer Wirkung steigern.

**Der Heartbeat konnte die Filiale lahmlegen.** `runHeartbeat` warf bei jedem Nicht-2xx;
`runHeartbeatPhase` zählte das auf `consecutiveHeartbeatFailures`, und
`shouldActivateEmergencyOverride` (`EMERGENCY_OVERRIDE_FAILURE_THRESHOLD = 3` bzw.
`EMERGENCY_OVERRIDE_AFTER_MS = 5 min`, siehe [ADR 0001](0001-emergency-override.md))
aktiviert daraufhin den **Notfall-Modus der gesamten Edge**. Drei gedrosselte Heartbeats
in Folge — bei einem 60-s-Tick also gut zwei Minuten — genügten. Ein Schutzmechanismus der
Cloud konnte damit den Kunden umlegen, den er schützen soll.

**Der Push konnte aus Rückstau Datenkonflikte erzeugen.** Der `catch` in `runPushBatch`
rief `markOutboxRetry`, das `attempts` hochzählt. Da `shouldEscalateAfterRetry` bei
`MAX_RETRY_ATTEMPTS = 10` terminal wird, hätte anhaltende Drosselung die betroffenen
Outbox-Einträge über zehn Ticks auf `rejected` gesetzt und `sync-conflicts`-Einträge
erzeugt — für Datensätze, die die Cloud nie angesehen hat. Der Betreiber hätte
Datenkonflikte aufzulösen versucht, wo nur ein volles Kontingent war.

**`Retry-After` wurde nirgends gelesen.** Der Edge hatte keine Möglichkeit, die Antwort
der Cloud auf die einzige Frage zu nutzen, die ein 429 beantwortet: *wann wieder*.

Die Cloud-Seite ist seit
[panary-cloud ADR 0033](../../../panary-cloud/docs/adr/0033-edge-sync-rate-limiting.md)
gehärtet — `/sync-heartbeat` hat einen eigenen Bucket (30/min), die Datenpfade wurden auf
900/min angehoben, und ein Backlog-Drain-Test am 2026-08-04 (1200 Outbox-Einträge, 12
`/sync-push` in einer Sekunde) erzeugte keinen einzigen 429. Das macht den Fall
unwahrscheinlich; es beseitigt ihn nicht. Die Fensterlängen sind per ENV konfigurierbar,
ein vorgelagerter Proxy kann eigenständig drosseln, und ein zwischen Edges geteiltes Token
träfe beide Buckets. Solange die Kette `429 → Fehlversuch → Notfall-Modus` im Edge-Code
steht, ist sie nur schwer auszulösen — nicht durchtrennt.

## Entscheidung

Ein 429 ist ein eigener Zustand: **die Cloud hat den Vorgang nicht bewertet, sie hat ihn
vertagt.** Vier Festlegungen, die künftige Arbeit binden.

### 1. Ein 429 zählt nie als Fehlversuch

`runHeartbeatPhase` schließt Cloud-Drosselung aus dem Failure-Tracking aus — kein
`consecutiveHeartbeatFailures++`, keine Override-Aktivierung, kein Patch auf der
`cloud-connection`. Die Kette zum Notfall-Modus ist damit **im Edge** durchtrennt und nicht
nur cloud-seitig unwahrscheinlich gemacht.

Der Notfall-Modus bleibt ausschließlich das, wofür er gebaut wurde: Antwort auf eine Cloud,
die **nicht antwortet**. Eine Cloud, die „später" sagt, ist erreichbar.

### 2. `Retry-After` ist bindend

Beide Formen aus RFC 9110 §10.2.3 werden gelesen — Delta-Sekunden (was `koa-ratelimit` in
der Cloud sendet) und HTTP-Datum (was ein Proxy senden kann). Der Wert wird auf
`[5 s, 15 min]` geklemmt: die Untergrenze, weil `koa-ratelimit` am Fensterende legitim `0`
liefert und der Edge daraus keinen Hot-Loop machen darf; die Obergrenze, weil ein Header
von außen kommt und den Sync nie über Stunden stilllegen dürfte.

Ohne verwertbaren Header gilt eine Minute — die Fensterlänge der Cloud-Buckets, nach der
das Kontingent in jedem Fall zurückgesetzt ist.

Die Auswertung lebt als pure function in `libs/domains/sync/domain/src/lib/rate-limit.ts`,
neben dem bestehenden `backoff-schedule.ts` und aus demselben Grund: hermetisch testbar,
ohne App- oder DB-Kontext.

### 3. Der Push wird nie terminal — und bucht keinen Versuch

Outbox-Einträge gehen auf `pending` zurück mit `nextAttemptAt = now + Retry-After`
(`markOutboxRateLimited`). `attempts` bleibt **unverändert**.

Das ist der Kern und keine Nachlässigkeit: `attempts` zählt bewertete Zustellversuche. Ein
429 ist keiner. Würde er mitzählen, träfe anhaltender Rückstau nach zehn Runden exakt die
terminale Ablehnung, gegen die diese Entscheidung existiert. Als Nebeneffekt ist der Weg
in `sync-conflicts` für gedrosselte Einträge strukturell versperrt statt nur unwahrscheinlich.

Die Wartezeit kommt bewusst **nicht** aus `backoffMs(attempts)`: bei eingefrorenem `attempts`
wäre der Wert über alle Wiederholungen konstant und obendrein pro Eintrag verschieden
(30 s für frische, Stunden für alte Einträge derselben Batch). Rückstau betrifft die
Verbindung, nicht den einzelnen Datensatz.

### 4. Ein 429 beendet den laufenden Cycle

Sieht der Heartbeat eine Drosselung, setzt `runSyncOnce` die Folgephasen aus — analog zum
bestehenden `cloudUnreachable`-Ausstieg. Sieht der Push eine, entfällt die Pull-Schleife;
sieht ein Pull eine, bricht die Schleife ab. Der Scheduler dehnt seine Tick-Wartezeit bis
zum `Retry-After`-Zeitpunkt (`retryAfterDelaySec`), damit ein Wert oberhalb der
Tick-Untergrenze von 60 s überhaupt wirken kann.

Begründung: Der Heartbeat ist der billigste Call des Cycles und hat cloud-seitig ein
eigenes Kontingent. Wird ausgerechnet er abgewiesen, wäre es die falsche Antwort, danach
neun weitere Requests gegen denselben Token zu schicken.

### Erkennung an einer Stelle, Protokoll an einer Stelle

`throwIfRateLimited` in `apps/api-edge/src/workers/sync-apply.ts` — dem Modul, das
[bereits `cloudFetch` trägt](../architecture/sync-apply-shared-modul.md) — wird an **jeder**
Edge→Cloud-Call-Site aufgerufen, jeweils **vor** der bestehenden
`!response.ok`-Behandlung: Heartbeat, Push, Pull, `sync-reconcile-overrides`,
`printer-commands`, `pullMasterDataPage` (BusinessDays-Poll + Bootstrap) und
Bootstrap-Push. Alle anderen Statuscodes bleiben dadurch unangetastet.

Dort entsteht auch die einzige Logzeile: `sync.rate_limited` mit Phase, Roh-Header und
ausgewerteter Wartezeit. Die Phasen-Wrapper unterdrücken für diesen Error-Typ ihre
generischen `*.worker_exception`-Warns — sonst stünde derselbe Vorgang dreifach im Terminal.

In der Sync-Historie erscheint ein gedrosselter Lauf als eigenes Outcome `throttled`
(blau, „Gedrosselt"), nicht als `failure`. Rückstau ist der Normalfall eines aufholenden
Edge; wer sich an rote Zeilen gewöhnt, übersieht die echten.

### Verworfene Alternativen

1. **429 wie 5xx behandeln und nur den Notfall-Modus-Zähler ausnehmen.** Löst den
   teuersten Fall, lässt aber die Outbox-Drift Richtung `rejected` und die
   `Retry-After`-Blindheit stehen — die Aufgabe wäre nur zur Hälfte erledigt.
2. **`attempts` weiter hochzählen, aber die Eskalationsgrenze für 429 anheben.** Verschiebt
   den Defekt, statt ihn zu entfernen: jede spätere Änderung an `MAX_RETRY_ATTEMPTS` müsste
   diese Sonderregel mitdenken.
3. **In-Memory-Cooldown-Gate statt persistentem `nextAttemptAt`.** Ein Modul-globaler
   „blockiert bis"-Zeitstempel wäre weniger Code, überlebt aber keinen Neustart und
   erzeugt einen neuen Ausfallmodus: ein hängendes Gate legt den Sync still, ohne dass es
   in der DB sichtbar wäre. `nextAttemptAt` existiert bereits, ist persistent und im
   Sync-Status-UI ablesbar.
4. **Ein neuer `SyncOutboxStatus` für gedrosselte Einträge.** Der Zustand ist exakt
   `pending mit späterem Termin` — dafür gibt es `nextAttemptAt`. Ein weiterer Status
   hätte jede Query und jede UI-Verzweigung über die Outbox angefasst.

## Konsequenzen

**Gewonnen**

- Cloud-Drosselung kann den Notfall-Modus nicht mehr auslösen — belegt durch
  `apps/api-edge/test/workers/cloud-sync-rate-limit.test.ts`, das den Fall mit einem
  Zählerstand direkt unter der Schwelle prüft und mit einer 500er-Gegenprobe absichert,
  dass ausschließlich 429 ausgenommen ist.
- Gedrosselte Outbox-Einträge bleiben `pending`, auch an der `MAX_RETRY_ATTEMPTS`-Grenze.
- Ein 429 fasst den `pairingStatus` nicht an. Das galt schon vorher (`handleCloudAuthError`
  hängt an `status === 401`), war aber nirgends festgeschrieben — jetzt ist es getestet.
- Der Edge folgt dem Takt, den die Cloud vorgibt, statt seinem eigenen.
- Rückstau ist in Log (`sync.rate_limited`) und Sync-Historie (`throttled`) als solcher
  erkennbar, statt als Fehler getarnt.

**Erkauft**

- **`SyncRunOutcome` hat einen vierten Wert.** Jeder Konsument muss ihn kennen; der
  Admin-Client tut es. Kein DB-Migrationsbedarf (`outcome` ist eine `table.string()`-Spalte
  ohne CHECK-Constraint), keine Cloud-Auswirkung (`sync-runs` wird nicht gesynct).
- **Ein gedrosselter Heartbeat kostet einen ganzen Tick.** Push und Pull hätten ihr eigenes
  Cloud-Kontingent und liefen möglicherweise durch. Bewusst in Kauf genommen: eine
  Verzögerung von ≥ 60 s wiegt leichter als neun Requests gegen einen gedrosselten Token.
- **Der Bootstrap bekommt keinen Auto-Retry.** Er scheitert bei 429 weiterhin sichtbar mit
  `outcome: failure` und muss vom Betreiber neu angestoßen werden — ein
  operator-getriebener Einmalvorgang mit eigener Statusmaschine soll nicht still im
  Hintergrund gegen ein Kontingent laufen. Gewonnen ist nur die eindeutige Ursache im Log.
- **Der `PATCH`-Claim einzelner `printer-commands` bleibt unbehandelt.** Ein 429 dort
  überspringt still einen Testdruck (`continue` im bestehenden Claim-Race-Pfad). Bewusst
  unverändert gelassen; der Fall ist folgenlos und wiederholt sich beim nächsten Pull.
