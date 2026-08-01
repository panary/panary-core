---
type: ADR
title: Modusunabhängiger Sync-Keepalive — der Heartbeat wird vom syncMode entkoppelt
description: Der Cloud-Heartbeat trägt die Token-Rotation und läuft deshalb künftig in jedem Sync-Modus, weil ihn die bisherige Kopplung an syncMode in scheduled und disabled aussetzte und die Kopplung nach 24 h erlosch.
tags: [sync, cloud-connection, api-edge, edge-pairing]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-01T07:00:00.000Z }
---

# Modusunabhängiger Sync-Keepalive

## Problem

Der Cloud-Heartbeat (`runHeartbeat` in `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts`)
ist nicht nur Telemetrie, sondern der Träger der **Cloud-Token-Rotation**. Die Cloud liefert
einen Nachfolge-Token ausschließlich in der Heartbeat-Antwort
(`panary-cloud/apps/api-cloud/src/services/sync/sync.ts` — die einzige Schreibstelle von
`tokenExpiresAt` außerhalb des Pairings), und zwar erst, wenn die Restlaufzeit unter den
Rotationsvorlauf fällt. Defaults: Lebensdauer 24 h, Vorlauf 12 h.

Der Heartbeat hing jedoch vollständig am eingestellten `syncMode`:

| Modus | Heartbeat |
|---|---|
| `auto` | ja, mit jedem Cycle (60–3600 s) |
| `manual` | ja, alle 30 min |
| `scheduled` | nur im Moment eines Slots |
| `disabled` | **nie** |
| unbekannter Wert | **nie** (kein `default:`-Zweig) |

Ein Edge ohne Heartbeat rotiert nie und wird nach Ablauf der Lebensdauer bei jedem Handshake
abgelehnt — Re-Pairing von Hand ist die Folge. Drei Wege konnten das verzögern, aber nicht
verhindern (`syncNow`, cloud-getriggerter force-sync, POS-PIN-Wechsel laufen alle modus-blind
über `runSyncOnce`).

Verschärfend kam hinzu, dass `scheduled` überhaupt nicht funktionierte:

1. `syncSchedule` hatte repo-weit **keine** Schreibstelle — der Modus war wählbar, aber nicht
   konfigurierbar.
2. Ohne Zeitplan fiel der Tick durch den `case`-Zweig hindurch: kein Sync, kein Heartbeat, nur
   ein 5-Minuten-Leerlauf.
3. Auch **mit** Zeitplan feuerte er nie. Die Slot-Funktion signalisierte „jetzt feuern"
   ausschließlich über einen Catch-up-Zweig, der `lastScheduledSyncAt` voraussetzte —
   geschrieben wurde das Feld aber nur *innerhalb* genau dieses Zweigs. Bootstrap-Deadlock.

Zu 3. wurde die Originalfunktion verbatim gegen eine simulierte Tick-Schleife mit
kontrollierter Uhr gefahren:

| Szenario (frischer Edge, `lastScheduledSyncAt` leer) | Ergebnis |
|---|---|
| 1 Slot/Tag (02:00), 48 h | **feuert nie** (2 Ticks) |
| 3 Slots/Tag (02:00/10:00/18:00), 48 h | **feuert nie** (6 Ticks) |
| Start 1 min vor dem Slot, 26 h | **feuert nie** (3 Ticks) |
| Gegenprobe: `lastScheduledSyncAt` vorbelegt | feuert sofort |

Die Gegenprobe isoliert die Bootstrap-Abhängigkeit exakt. Über 10 Tage feuerte sie zudem nur
9× statt 10× — die `>24 h`-Heuristik driftet, weil der Nachhol-Lauf später stempelt als der
Slot liegt, und überspringt dadurch Tage.

Am laufenden Edge bestätigt: nach dem Umschalten auf `scheduled` stand `lastHeartbeatOk`
still, inklusive eines Ticks, der im AUTO-Takt gefunkt hätte.

**Die entscheidende Folgerung:** Ein bloß reparierter `scheduled`-Modus bliebe unsicher. Bei
einem Slot pro Tag rotiert der Token exakt an der 24-h-Grenze, und die Timer-Drift schiebt
immer nach hinten. Bei zwei Slots im 12-h-Abstand ist die Rotationsbedingung
(`Restlaufzeit < Vorlauf`) strikt und greift gar nicht. Erst ab drei Slots pro Tag wäre die
Kette aus sich heraus stabil — eine Zahl, die kein Betreiber kennen kann und die keine UI
erzwingen sollte.

## Entscheidung

**Der Heartbeat wird vom `syncMode` entkoppelt.** Vor dem Modus-Zweig läuft in *jedem* Tick ein
Keepalive: liegt der letzte erfolgreiche Heartbeat länger als `KEEPALIVE_HEARTBEAT_INTERVAL_SEC`
(4 h) zurück, wird einer erzwungen — auch bei `disabled` und bei unbekanntem Modus-Wert.

4 h liegen komfortabel unter dem 12-h-Rotationsvorlauf (zwei Fehlschläge in Folge sind
verkraftbar) und kollidieren nicht mit `auto` (max. 1 h) oder `manual` (30 min), wo ohnehin
häufiger gefunkt wird. Der Keepalive ist fehlerisoliert: er darf den Tick nie abbrechen, sonst
käme der eigentliche Modus-Zweig nicht mehr dran.

`disabled` bedeutet damit ausdrücklich **„keine Datenübertragung", nicht „keine Verbindung"**.
Die Alternative — den Modus dunkel zu lassen und im UI vor dem Verfall zu warnen — wurde
verworfen: „Deaktiviert" impliziert einen umkehrbaren Zustand, und ein Modus, dessen Preis ein
manuelles Re-Pairing ist, ist eine Falle, keine Einstellung.

Flankierend:

* **`SCHEDULER_MAX_TICK_SEC` (30 min)** deckelt die Wartezeit im Modus `scheduled` — und nur
  dort. Ohne Deckel schlief der Scheduler bis zu 24 h bis zum nächsten Slot; da es keinen
  Re-Arm-Pfad gibt, war ein Moduswechsel im Admin so lange wirkungslos. Der Deckel sichert
  zugleich, dass der Keepalive überhaupt zur Auswertung kommt.

  Bewusst **nicht** global auf jeden Tick: `auto` wählt seine Wartezeit aus `syncIntervalSec`
  (60–3600 s). Ein globaler Deckel würde einen bewusst gesetzten Stundentakt auf 30 Minuten
  verkürzen und die Sync-Last dieser Installationen verdoppeln — eine stille Verhaltensänderung
  bei Kunden, die nie darum gebeten haben. `manual` (30 min) und `disabled` (5 min) liegen
  ohnehin darunter.
* **Sichere Auslegung statt Stillstand:** `scheduled` ohne brauchbaren Zeitplan und jeder
  unbekannte Modus-Wert fahren `auto`-Verhalten mit Warn-Log. Der gespeicherte Modus bleibt
  unangetastet — Nutzerkonfiguration wird nicht hinter dem Rücken umgeschrieben.
* **Slot-Berechnung** als pure function `apps/api-edge/src/workers/scheduled-slot.ts`
  (Präzedenz: `libs/domains/sync/domain/src/lib/backoff-schedule.ts`): absolute Zeitpunkte über
  echte Zonen-Offset-Rechnung, 12-h-Nachholfenster, `lastRunAt` nur noch als Doppelfeuer-Sperre.
  Gestempelt wird der **Slot-Zeitpunkt**, nicht `Date.now()` — sonst wandert die Sperre mit
  jeder Laufzeitverzögerung nach hinten (genau der Drift, der oben Tage übersprang).

## Konsequenzen

* Ein Edge verliert seine Kopplung nicht mehr durch eine UI-Einstellung. Das galt bisher
  deterministisch für `disabled` und praktisch für `scheduled`.
* Jeder Edge funkt mindestens alle 4 h. Die Tick-Frequenz bleibt modusabhängig
  (`auto`: `syncIntervalSec`, `manual`: 30 min, `disabled`: 5 min, `scheduled`: bis zum
  nächsten Slot, gedeckelt auf 30 min); der Tick selbst ist ein einzelner DB-Read, der
  Heartbeat läuft nur bei Fälligkeit.
* Bestands-Edges mit `scheduled` ohne Zeitplan brauchen keine Migration: der Fallback greift
  beim ersten Tick nach dem Update. Bereits ausgesperrte Edges — Token abgelaufen — brauchen
  weiterhin ein Re-Pairing; das kann kein Code-Fix heilen.
* Die Cloud kennt `syncMode` nicht (kein Feld im `cloudEdge`-Schema). Sie kann riskante
  Einstellungen deshalb weder erkennen noch warnen. Ein optionales Feld im Heartbeat-Payload
  wäre der Weg, ist aber heikel: lehnte das Cloud-Schema es mit `additionalProperties: false`
  ab, kippte die gesamte Flotte binnen Minuten in den Notfall-Modus. Bewusst vertagt.
* `SLOT_CATCHUP_WINDOW_MS` (12 h) ist eine Auslegungsentscheidung: eine über Nacht
  ausgeschaltete Kasse holt ihren Slot nach, ein tagelang stillstehendes Gerät holt genau
  einen Lauf nach statt einen pro verpasstem Tag.

## Verwandt

* [Cloud-Pairing-Wizard — Edge-Seite](../architecture/cloud-pairing-wizard.md)
* [Notfall-Modus](0001-emergency-override.md) — drei fehlgeschlagene Heartbeats aktivieren ihn;
  ohne Heartbeat gab es keinen Failure-Zähler und damit keine Auto-Aktivierung.
