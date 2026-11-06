---
type: ADR
title: 'POS-Fehlerberichte bleiben lokal — kein Crash-Upload, stattdessen Fristen für Socket-Aufrufe und geschlossene Lücken im lokalen Log'
description: 'Der POS lädt keine Absturz- oder Fehlerberichte hoch (weder Sentry noch eigener Cloud-Endpunkt), die Logdatei geht weiter manuell an den Support. Statt eines Crash-Reportings bekommen Socket-Aufrufe eine Frist mit Logzeile, der vorhandene Webview-Mitschnitt Fehler ab dem Bootstrap ohne Doppelzeilen, der Rust-Prozess einen Panic-Hook und der Sunmi-Wrapper überhaupt ein Log.'
tags: [pos-client, logging, tauri, capacitor, diagnose, datenschutz]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-11-06T15:30:00Z }
---

# ADR 0069 — POS-Fehlerberichte bleiben lokal

## Problem

Am 2026-10-30 blieb am POS (macOS, Tier cloud-direct) „Bestellen" nach der Wahl der Fertigungszeit
gesperrt (panary/panary-core#1216). Die native Logdatei enthielt zum Zeitpunkt nichts. Daraus entstand
die Frage, ob der POS Abstürze und Hänger selbst festhalten oder sogar melden soll
(panary/panary-core#1220).

Die Bestandsaufnahme ergab mehr, als das Issue annahm:

| Baustein                                             | Stand                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Logdatei (Tauri)                              | `tauri-plugin-log`, `panary-pos.log` im App-Log-Verzeichnis, Level `Info`, 5 MB je Datei, eine rotierte Datei (`apps/pos-client/src-tauri/src/lib.rs`, `run()`)                                                                                               |
| Webview → Logdatei                                   | Kommando `js_log` schreibt `[webview] …`. `LogService.installGlobalCapture()` (`libs/shared/data-access-updater`, aufgerufen in `apps/pos-client/src/app/app.ts`) spiegelt `window`-`error`, `unhandledrejection` und `console.error/warn/info` dorthin       |
| Einsehen und Übergeben                               | Einstellungen → „Logs einsehen" (letzte 200 KB, `read_logs`) und „Logs exportieren" (öffnet den Ordner, `open_log_dir`). Der Betreiber schickt die Datei von Hand                                                                                             |
| Rust-Panic                                           | Kein Hook. Ein Panic erreicht die Logdatei nicht, Windows-Release-Builds haben kein Konsolenfenster (`windows_subsystem = "windows"`)                                                                                                                         |
| Fehler im Webview                                    | Nach dem Bootstrap doppelt: über `provideBrowserGlobalErrorListeners()` → Angular-`ErrorHandler` → `console.error` mit Stack, dazu die eigene Zeile `window.onerror: … @ file:line`. Vor dem Konstruktor der App-Komponente (`app.ts:54`) wird nichts erfasst, auch nichts aus `main.ts` |
| Sunmi (Capacitor-Wrapper, panary/panary-core#818)    | Kein Log. Alle `LogService`-Aufrufe sind außerhalb von Tauri No-Ops                                                                                                                                                                                           |
| Logging-Regel                                        | `.claude/rules/logging.md` gilt per `paths:` nur für `apps/api-edge/**` und `libs/shared/backend/**`. Für den POS, der jede `console.*`-Zeile auf die Platte schreibt, gibt es keine Regel                                                                    |

Die Ursache von #1216 war ein Promise, das nie endete: `getClosedDayStatus` wartete auf eine Antwort, die
die Cloud nie schickte (behoben mit #1215). Es gab keinen Fehler, keine Ablehnung, keinen Absturz und
keinen blockierten Hauptthread. Wenige Tage später zeigte #1314 dieselbe Klasse beim Bezahldialog. Der
gemeinsame Grund liegt im Feathers-Socket-Client (`@feathersjs/transport-commons` 5.0.50,
`lib/client.js`): Ohne `ackTimeout` am socket.io-Client wartet jeder Aufruf ohne Frist auf das Ack, und
`createSocket()` in `libs/shared/data-access/src/lib/services/connection.service.ts` setzt keins.

Bewertet wurden:

| Option                                                       | Hätte #1216 gezeigt? | Bewertung                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Rust-Panic-Hook in die Logdatei                          | nein                 | Billig. Außerhalb der Tests steht im Rust-Code nur das `.expect` beim Start, der Nutzen ist klein, schließt aber eine stille Stelle                                                                                         |
| (b) Globaler Fehler-Hook im Webview                          | nein                 | **Besteht bereits** (`installGlobalCapture`). Lücken: Doppelzeilen, nichts vor dem Bootstrap                                                                                                                                               |
| (c) Watchdog/Heartbeat für blockierte Oberfläche             | nein                 | Der Hauptthread war frei, ein UI-Watchdog hätte nichts gemessen. Ein Watchdog je Ablauf ist dasselbe wie eine Frist, nur später gesetzt                                                                                    |
| (d1) Upload an einen eigenen Cloud-Endpunkt                  | nein                 | Neuer Datenfluss mit Mandantenbindung, Scrubbing, Offline-Puffer und einem Endpunkt in api-cloud. Ohne Fehler gibt es nichts hochzuladen                                                                                    |
| (d2) Sentry im POS                                           | nein                 | Cloud nutzt Sentry bereits (api-cloud, admin-dashboard). Im POS kämen PIN-Eingabe, Kunden- und Bestelldaten in die Nähe von Breadcrumbs, die Konsole und Fetch standardmäßig mitschneiden. Offline nur gepuffert            |
| (e) nichts tun                                               | nein                 | Lässt die Klasse aus #1216/#1314 offen                                                                                                                                                                                       |
| (f) Frist für jeden Socket-Aufruf, Logzeile beim Ablauf      | **ja**               | Aus dem stummen Hänger wird ein Fehler, den der Aufrufer behandelt und den der bestehende Mitschnitt aufschreibt                                                                                                             |

## Entscheidung

1. **Kein Upload.** Der POS meldet Fehler weder an Sentry noch an einen eigenen Cloud-Endpunkt. Die
   Logdatei bleibt auf dem Gerät und geht wie bisher über „Logs exportieren" an den Support
   (Entscheidung Michael, 2026-11-06).
2. **Fristen statt Crash-Reporting.** Jeder Socket-Aufruf des POS (Device-Strategie, nicht der
   Admin-Client) bekommt eine Frist. Ob als globale `ackTimeout` (harte Obergrenze über dem längsten
   gemessenen Aufruf) oder als Feathers-Client-Hook mit Frist je Pfad und Methode, entscheidet die
   Umsetzung nach der Messung. Beim Ablauf steht eine Zeile mit Service und Methode, ohne Nutzdaten, in
   der Logdatei. Die Einzelfristen aus #1215, #1314 und weiteren Stellen bleiben, wo sie kürzer sein
   müssen. Umsetzung: panary/panary-core#1342.
3. **Lücken im lokalen Log schließen:** Webview-Fehler genau einmal und schon vor dem Bootstrap, Rust-Panic-Hook als
   erste Anweisung im `.setup`-Closure (dann hängt das Log-Plugin schon), und eine Logging-Regel für den POS (keine PINs, Tokens, API-Keys,
   Kunden- und Bestelldaten in `console.*` und `LogService`). Umsetzung: panary/panary-core#1343.
4. **Sunmi bekommt ein Log** mit derselben Formatierung und demselben Deckel wie Tauri. Der Weg
   (`@capacitor/filesystem` oder eigenes Plugin) ist dort abzustimmen, weil er eine Abhängigkeit
   bringen kann. Umsetzung: panary/panary-core#1344.

## Konsequenzen

- Es entsteht kein neuer Datenfluss aus dem POS heraus und damit kein neues Datenschutzthema. Der Preis:
  Ein Fehler im Feld wird erst bekannt, wenn jemand ihn meldet und die Datei schickt. Eine Häufigkeit
  über alle Geräte gibt es nicht.
- Die Frist ändert das Verhalten aller Socket-Aufrufe. Eine zu kurze Frist bricht legitime lange
  Operationen am POS ab, die auf der Edge weiterlaufen. Deshalb wird vor dem Setzen gemessen
  (`duration_ms` der Edge-Wide-Events), und automatische Wiederholungen (`retries`) bleiben aus: Eine
  doppelt angelegte Bestellung wäre schlimmer als der Hänger.
- Ob die Edge eine Anfrage trotz ausbleibendem Ack verbucht hat, sagt die Frist nicht. Das bleibt Sache
  des Aufrufers, wie in #1314 mit dem Nachlesen des Status.
- Unsichtbar bleiben weiterhin: ein Absturz des Webview-Prozesses selbst, ein Kill durch das
  Betriebssystem, HTTP-Aufrufe per `fetch`/`HttpClient` (Health, Druck, Auth, Gerätekonfiguration), die
  nicht über den Socket laufen.
- Wird der Upload später doch gebraucht (mehr Geräte im Feld, Support ohne Gerätezugang), ist dieses ADR
  durch ein neues abzulösen. Die Logging-Regel aus Punkt 3 ist dann die Grundlage für das Scrubbing.
