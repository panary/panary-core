---
type: Architecture
title: 'POS-Logdatei — was hineinkommt, wie Fehler genau einmal landen, Rust-Panics'
description: 'Der Tauri-POS schreibt Konsole, unbehandelte Webview-Fehler (ab dem ersten Modul, jeden genau einmal) und Rust-Panics ab dem setup-Closure in panary-pos.log.'
tags: [pos-client, logging, tauri, diagnose]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-07T21:30:00Z }
sources:
  - { id: adr-0069, resource: docs/adr/0069-pos-fehlerberichte-bleiben-lokal.md, title: 'ADR 0069 — POS-Fehlerberichte bleiben lokal' }
  - { id: issue-1343, resource: 'https://github.com/panary/panary-core/issues/1343', title: 'panary/panary-core#1343' }
---

# POS-Logdatei

Der Tauri-POS führt eine Logdatei auf dem Gerät. Sie wird nicht hochgeladen ([ADR 0069](../adr/0069-pos-fehlerberichte-bleiben-lokal.md)),
der Betreiber schickt sie über **Einstellungen → Logs exportieren** an den Support. Was darin nie stehen
darf, regelt `.claude/rules/pos-logging.md`.

## Datei

| Eigenschaft | Wert                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| Name, Ort   | `panary-pos.log` im App-Log-Verzeichnis des Betriebssystems                                  |
| Schreiber   | `tauri-plugin-log`, Level `Info`, registriert als erstes Plugin in `run()` (`src-tauri/src/lib.rs`) |
| Deckel      | 5 MB je Datei, eine rotierte Datei (`KeepOne`), zusammen etwa 10 MB                          |
| Einsehen    | Einstellungen → Logs einsehen (letzte 200 KB, Kommando `read_logs`)                          |

## Quellen

Alles aus dem Webview läuft über das Kommando `js_log` und steht mit dem Präfix `[webview]` in der Datei.
`debug` fällt am Level `Info` weg.

| Quelle                                   | Weg                                                                | Text nach dem Präfix                                 |
| ---------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `console.error/warn/info` im Webview     | Console-Patch                                                      | die Argumente, Fehler als `Name: Meldung` + Stack    |
| unbehandelter Fehler nach dem Bootstrap  | Angulars Listener → `ErrorHandler` → `console.error('ERROR', err)` | `ERROR Error: …` mit Stack                           |
| unbehandelte Ablehnung nach dem Bootstrap | ebenso                                                             | `ERROR …`                                            |
| unbehandelter Fehler vor dem Bootstrap   | eigener `error`-Listener                                           | `window.onerror: Error: …` mit Stack, `@ Datei:Zeile` |
| unbehandelte Ablehnung vor dem Bootstrap | eigener `unhandledrejection`-Listener                              | `unhandledrejection: …`                              |
| `LogService.error/warn/info`             | direkt                                                             | Text                                                 |

Aus dem Rust-Prozess, ohne Präfix `[webview]`:

| Quelle                             | Zeile                                                |
| ---------------------------------- | ---------------------------------------------------- |
| Rust-Panic ab dem `.setup`-Closure | `[panic] Thread '…' bei Datei:Zeile:Spalte: Meldung` |
| Rust-Code (`log::info!` usw.)      | z. B. `[kiosk] …`                                    |

## Webview: ab dem ersten Modul, jeder Fehler genau einmal

`installGlobalLogCapture()` (`libs/shared/data-access-updater/src/lib/services/log.service.ts`) läuft in
`apps/pos-client/src/log-capture.ts`, das `main.ts` als **erstes** importiert. ES-Importe werden vor dem
Rumpf von `main.ts` ausgewertet; stünde der Aufruf dort, liefe ein Fehler beim Laden von `app.config` am
Mitschnitt vorbei. So landet auch das `.catch` von `bootstrapApplication` in der Datei.

Bis panary/panary-core#1343 stand ein Fehler nach dem Bootstrap **zweimal** in der Datei, und
unbehandelte Ablehnungen ebenso: `provideBrowserGlobalErrorListeners()` reicht `error` und
`unhandledrejection` an den Angular-`ErrorHandler`, der `console.error('ERROR', err)` ruft, und der
Console-Patch schrieb das mit Stack. Zusätzlich schrieben die eigenen Listener eine zweite Zeile. Der
Mechanismus steht im Angular-Quelltext (`@angular/core`, `globalErrorListeners`): Beide Listener rufen
nach der Übergabe `e.preventDefault()`, auch für ein `error`-Event ohne `e.error`.

Daran entscheiden die eigenen Listener jetzt: Sie lesen `event.defaultPrevented` **nach** dem Dispatch
(`setTimeout(…, 0)`) und schreiben nur, wenn kein anderer Listener das Event übernommen hat. Das deckt
ohne eigenes Flag die Zeit vor dem Bootstrap, einen gescheiterten Bootstrap und einen zerstörten
Injector ab. Ein Microtask reicht für das Nachlesen nicht: Der eigene Listener hängt vor dem von Angular
und läuft zuerst, und der Browser arbeitet Microtasks schon nach jedem einzelnen Listener ab.

Der Mitschnitt ist **modulweit** idempotent. Ein Flag je `LogService`-Instanz hätte den Console-Patch
verkettet, sobald der Root-Injector neben dem frühen Aufruf eine eigene Instanz baut.

## Rust: Panic-Hook

`panic_log::install()` (`apps/pos-client/src-tauri/src/panic_log.rs`) ist die erste Anweisung im
`.setup`-Closure. Dann ist das Log-Plugin schon registriert, und auch ein Panic in
`kiosk::create_main_window` erreicht die Datei. Der Hook schreibt Thread, Ort und Meldung und ruft danach
den bisherigen Hook, damit stderr erhalten bleibt. Windows-Release-Builds haben kein Konsolenfenster
(`windows_subsystem = "windows"`), dort war ein Panic vorher unsichtbar.

## Grenzen

- Ein Panic **vor** dem `.setup`-Closure (Plugin-Initialisierung, `.build(…)`) erreicht die Datei nicht,
  der Hook hängt dann noch nicht.
- Ob die Panic-Zeile vor dem Prozessende auf der Platte steht, zeigt nur ein echter Panic. Die Tests
  prüfen die Formatierung, nicht das Schreiben.
- Ein Absturz des Webview-Prozesses selbst (WebKit/WebView2) und ein Kill durch das Betriebssystem
  erzeugen weder ein JS-Event noch einen Panic.
- Außerhalb von Tauri (Browser, Sunmi-Wrapper) ist der Mitschnitt ein No-Op; Sunmi bekommt ein Log mit
  panary/panary-core#1344.
