---
type: ADR
title: Datenabgleich und Erreichbarkeit trennen — lastSyncAt, lastHeartbeatOk und eine modusabhängige Sync-Erwartung
description: lastSyncAt trägt künftig ausschließlich echte Datenübertragungen, Erreichbarkeit lebt in lastHeartbeatOk/lastCloudContactAt, und das Sync-Alter-Badge misst Überfälligkeit gegenüber dem eingestellten Sync-Modus statt eines festen Alters.
tags: [sync, cloud-connection, api-edge, admin-client, pos-client]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-04T13:10:00.000Z }
---

# Datenabgleich und Erreichbarkeit trennen

## Problem

Ein Betreiber stellte den Sync-Modus seines Edge auf `scheduled` mit einem Slot um 22:00 und
meldete zwei Beobachtungen, die sich zu widersprechen schienen: Erstens zeigte der Edge-Admin
oben dauerhaft das Banner „Letzter Cloud-Sync vor 21 min", obwohl der geplante Abgleich erst
für den Abend vorgesehen war. Zweitens standen in der Sync-Historie trotzdem Vorgänge vom
selben Nachmittag. Direkt darunter behauptete dieselbe Seite „Mit Cloud verbunden — Online,
letzter Kontakt gerade eben".

Beide Beobachtungen waren korrekt, und beide Anzeigen waren irreführend.

**Erstens: `lastSyncAt` bedeutete nicht, was es sagte.** Das Feld hatte im gesamten Repo genau
eine Schreibstelle — `runHeartbeat` in
`apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts`. Ein Heartbeat trägt aber keine
Geschäftsdaten; er beweist Erreichbarkeit und transportiert die Token-Rotation. Das Feld hieß
also faktisch „letzter erfolgreicher Cloud-Kontakt", wurde in POS und Admin aber als „Letzter
Sync" beschriftet. Besonders schädlich ist das seit [ADR 0015](0015-modusunabhaengiger-sync-keepalive.md):
der Keepalive-Heartbeat läuft **bewusst modusunabhängig** alle vier Stunden. Ein Edge im Modus
`disabled` — der per Definition nichts synchronisiert — schrieb damit alle vier Stunden einen
„Sync" fort.

**Zweitens: die Frische-Schwellen kannten den Betriebsmodus nicht.** `ConnectionService`
verglich das Alter von `lastSyncAt` gegen 5 Minuten (warn) und 30 Minuten (crit). Diese Werte
stammen aus der Annahme „Modus `auto` mit Default-Intervall 300 s" und sind in jeder anderen
Konfiguration ein struktureller Dauer-Fehlalarm:

| Konfiguration | Erwartete Abstände | Verhalten des alten Badges |
|---|---|---|
| `auto`, Intervall 300 s | 5 min | korrekt |
| `auto`, Intervall 3600 s (erlaubtes Maximum) | 60 min | dauerhaft „veraltet" |
| `scheduled`, ein Slot/Tag | 24 h | dauerhaft „veraltet" |
| `manual` | nur auf Knopfdruck | dauerhaft „veraltet" |
| `disabled` | nie | dauerhaft „veraltet" |

Dass es in `scheduled` und `disabled` bisher nicht durchgehend rot leuchtete, lag ausgerechnet
am ersten Problem: der Keepalive-Heartbeat setzte das Feld alle vier Stunden zurück. Ein Fehler
maskierte den anderen — wer nur einen von beiden behebt, macht die Anzeige schlechter statt
besser.

**Drittens: die Sync-Historie beantwortete das „warum" nicht.** Der eingestellte `syncMode`
steuert ausschließlich den periodischen Voll-Cycle des Schedulers. Vier Pfade laufen bewusst
daran vorbei — Keepalive-Heartbeat, realtime-getriggerte Stammdaten-Pulls (die Cloud pusht
`changed` bei **jeder** Stammdaten-Mutation), der businessdays-Safety-Poll und der
cloud-getriggerte force-sync. Die Historie zeigte weder den Auslöser (`triggeredBy` lag im
Datensatz, wurde aber nicht gerendert) noch die realtime-getriggerten Pulls überhaupt
(`pullMasterDataServiceOnce` rief `runPullForService` unter Umgehung der protokollierenden
Phasen-Hülle auf). Der Betreiber sah Vorgänge, die sein Zeitplan nicht erklärte, und hatte
keine Möglichkeit, die Ursache zu bestimmen.

## Entscheidung

**1. `lastSyncAt` bedeutet ausschließlich „letzter Datenabgleich".** Der Heartbeat stempelt es
nicht mehr; er schreibt nur noch `lastHeartbeatOk` (Erreichbarkeit + Rotationsnachweis, wie
bisher). Geschrieben wird `lastSyncAt` künftig nur von `stampLastSyncAt`, und zwar an genau zwei
Stellen:

* am Ende eines durchgelaufenen `runSyncOnce` — Push- und Pull-Phasen ohne Fehler, kein 401
  unterwegs. Auch ein Lauf ohne zu übertragende Datensätze zählt: nichts zu tun ist ein
  gültiges Ergebnis, kein ausgefallener Sync.
* nach einem realtime-getriggerten Stammdaten-Pull mit tatsächlich angewandten Records.

Damit gilt die Invariante: **`lastSyncAt` bewegt sich genau dann, wenn auch ein
`sync-runs`-Eintrag entstehen konnte.** Die Kopfzeile „Letzter Datenabgleich" und die
Sync-Historie können sich nicht mehr widersprechen. Der businessdays-Safety-Poll stempelt
bewusst nicht — er führt seinen eigenen Cursor (`lastBusinessDaysPullAt`) und taucht nicht in
der Historie auf.

**2. Erreichbarkeits-Konsumenten wechseln auf `lastHeartbeatOk`.** Betroffen ist der
Cloud-Reachability-Vorabcheck des Audit-Cleanups
(`apps/api-edge/src/workers/audit-cleanup.worker.ts`), der den nächtlichen Lauf aussetzt, wenn
die Cloud länger als `cloudReachableMaxAgeDays` (Default 7) nicht erreichbar war. Ohne diesen
Wechsel wäre die Umdeutung von `lastSyncAt` ein stiller Datenschaden: ein Edge im Modus
`scheduled` mit wenig Bewegung hätte den Cleanup dauerhaft ausgesetzt und die Edge-Datenbank
unbegrenzt wachsen lassen. Der Keepalive-Heartbeat läuft in jedem Modus und ist damit der
belastbare Erreichbarkeits-Beleg.

**3. Die Frische-Bewertung misst Überfälligkeit, nicht Alter.** Der Edge rechnet in
`apps/api-edge/src/utils/sync-expectation.ts` aus, wann er den nächsten automatischen Abgleich
fahren will, und liefert das Ergebnis als absoluten Zeitpunkt (`nextExpectedSyncAt`) zusammen
mit dem effektiven `syncMode` über `/health`:

| Modus | `nextExpectedSyncAt` |
|---|---|
| `auto` | `lastSyncAt + syncIntervalSec` (ohne bekannten Abgleich: ab jetzt) |
| `scheduled`, brauchbarer Zeitplan | nächster Slot; ein fälliger Slot gilt als „jetzt" |
| `scheduled`, unbrauchbarer Zeitplan | wie `auto` — identisch zum Fallback des Workers |
| `manual`, `disabled` | `null` = keine Erwartung |

`ConnectionService.syncStaleness()` bewertet daraufhin nur noch die Überfälligkeit gegenüber
diesem Termin (warn ab 5 min, crit ab 30 min). `null` heißt ausdrücklich: kein Banner — wo kein
Abgleich eingeplant ist, kann auch keiner ausbleiben. Das angezeigte Alter (`ageSec`) bleibt
davon entkoppelt: es beantwortet „wie alt ist der Stand", nicht „ist das ein Problem".

Die Rechnung liegt bewusst auf dem Edge. Ein Client, der Slots und IANA-Zeitzonen selbst
auswertet, wäre eine zweite Quelle der Wahrheit neben `computeScheduledSlot` — und würde
zwangsläufig vom Worker abdriften.

**4. Beschriftungen benennen den Unterschied.** „Letzter Sync" heißt überall „Letzter
Datenabgleich"; der Banner trägt die Subline „Der eingeplante Abgleich ist überfällig — die
Cloud-Verbindung selbst ist davon unberührt." Der Edge-Admin zeigt zusätzlich „Nächster
geplanter Abgleich". Die Sync-Historie bekommt die Spalte „Ausgelöst von" (Zeitplan bzw.
`Automatisch`, `Cloud`, `Manuell`, `Edge-Start`, `Erstabgleich`), und realtime-getriggerte
Pulls laufen jetzt durch die protokollierende Phasen-Hülle, erscheinen also als `Cloud` in der
Liste.

## Konsequenzen

* **Der Modus wird sichtbar respektiert.** Ein Edge im Zeitplan-Modus zeigt tagsüber kein
  Warnbanner mehr und nennt stattdessen den nächsten Termin. `auto` mit langem Intervall und
  `manual`/`disabled` sind vom Fehlalarm ebenfalls befreit.
* **Bestandsdaten sind unkritisch.** `lastHeartbeatOk` wurde schon bisher im selben Patch wie
  `lastSyncAt` geschrieben; bestehende Zeilen tragen den Wert. Es gibt keine Migration.
* **`lastSyncAt` altert jetzt sichtbar.** Wer den Wert als „ist die Cloud da?" gelesen hat,
  liest ab jetzt falsch — dafür ist `lastCloudContactAt` (Socket, 30 s) bzw. `lastHeartbeatOk`
  zuständig. Der Audit-Cleanup war der einzige Codepfad mit dieser Verwechslung.
* **Die Historie wird länger.** Realtime-getriggerte Pulls erzeugen jetzt `sync-runs`-Einträge.
  Der bestehende Filter greift weiterhin (protokolliert wird nur bei `recordCount > 0` oder
  Fehler), und `sync-runs-cleanup.worker.ts` räumt wie gehabt auf.
* **Offen bleibt die Cloud-Seite.** `cloud-edges.lastSyncAt` wird in
  `panary-cloud/apps/api-cloud/src/services/sync/sync.ts` bei jedem `/sync-heartbeat` gestempelt
  und trägt dieselbe Doppeldeutigkeit in den Cloud-Admin (Popover „Letzter Sync"). Die
  Erreichbarkeits-Konsumenten dort sind bereits auf `lastSeenAt` umgestellt (Alert-Engine, seit
  2026-08-02), die Umdeutung ist also vorbereitet.

Verwandt: [ADR 0015 — Modusunabhängiger Sync-Keepalive](0015-modusunabhaengiger-sync-keepalive.md)
(der Keepalive, dessen Stempel diese Verwechslung sichtbar machte).
