---
type: Domain Concept
title: POS-Kiosk-Modus — Vollbild ohne Rahmen, Notausgang per PIN
description: Wie das Panary Terminal (Tauri) auf gekoppelten Windows- und macOS-Geräten im Vollbild ohne Fensterrahmen startet, warum Alt+F4, Schließen und Cmd+Q wirkungslos bleiben, wie Inhaber und Techniker per PIN beenden oder in den Fenstermodus wechseln, und wo die Grenzen liegen.
tags: [pos-client, devices, users, tauri]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-28T20:40:00.000Z }
sources:
  - { id: issue-1188, resource: 'https://github.com/panary/panary-core/issues/1188', title: 'panary/panary-core#1188' }
---

Mitarbeiter haben das Terminal am Kassenplatz versehentlich über die Titelleiste geschlossen, und die
Kasse stand, bis jemand sie neu startete (panary/panary-core#1188). Seitdem startet ein **Release-Build
auf einem gekoppelten Gerät** im Vollbild ohne Fensterrahmen, und schließen lässt er sich nur über die
POS-Einstellungen nach PIN.

## Wann der Kiosk aktiv ist

Kiosk aktiv = **Release-Build** und **Geräte-Schalter an** und **gekoppelt** und **nicht im Fenstermodus**.
Die Entscheidung ist eine reine Funktion (`kiosk_active` in
[`kiosk.rs`](../../apps/pos-client/src-tauri/src/kiosk.rs)) mit Tests für jede Kombination.

| Fall                                 | Verhalten                       | Warum                                                             |
| ------------------------------------ | ------------------------------- | ----------------------------------------------------------------- |
| `pnpm tauri:dev`, Debug-Build        | normales Fenster                | `cfg!(debug_assertions)`; zur Laufzeit abgefragt, damit Tests und clippy den Zweig sehen |
| Ungekoppelt (Setup-Wizard)           | normales Fenster                | Ohne Edge keine PIN-Prüfung, ein Kiosk ließe sich nicht beenden   |
| Gekoppelt, Schalter aus (Büro-PC)    | normales Fenster                | Geräte-Schalter in den Einstellungen                              |
| Gekoppelt, Schalter an               | Vollbild, kein Rahmen, gesperrt | Regelfall am Kassenplatz                                          |
| Fenstermodus gewählt                 | normales Fenster bis Neustart   | Notausgang für Wartung, ohne den Schalter zu ändern               |

### Kopplung kommt aus dem Webview

Die Kopplung liegt im `localStorage` des Webviews (`panary_device_config`), den Rust beim Start nicht
lesen kann. Der POS meldet sie deshalb in `AppComponent` per `kiosk_report_paired(hasConfig())`, und
die Shell speichert sie in `kiosk.json`, damit der **nächste** Start schon vor dem Webview richtig
entscheidet. Pairing (`window.location.href = '/'`) und Entkoppeln (`location.reload()`) laden die App
neu und melden damit erneut.

⚠️ **Fehlt der Wert, gilt das Gerät als ungekoppelt.** Folge: Der erste Start nach dem Update auf eine
Version mit Kiosk, und der erste Start nach dem Pairing, öffnen ein normales Fenster, das nach dem
Laden des Webviews ins Vollbild wechselt. Erst ab dem zweiten Start erscheint das Fenster direkt im
Vollbild.

### Geräte-Schalter `kiosk.json`

`{ "enabled": true, "paired": true }` im App-Data-Dir (`app.path().app_data_dir()`, unter Windows
`%APPDATA%\de.panary.pos`). Fehlt die Datei oder ist sie unlesbar, gilt `enabled: true, paired: false`.
Lese- und Parse-Fehler brechen den Start nie ab: Das Fenster muss in jedem Fall entstehen.

Das App-Data-Dir gilt **je Windows-Benutzer**, nicht je Gerät, obwohl die Installation `perMachine` ist.
Ein Schalter gilt damit für die Windows-Anmeldung. Kassenplätze laufen in der Regel unter einem festen
Benutzer; ein geräteweiter Ort (ProgramData) bräuchte Schreibrechte, die die App nicht hat.

⚠️ **Bestandsgeräte:** „Schalter fehlt → an" schaltet mit dem ersten `pos-v*` mit Kiosk jedes gekoppelte
Gerät in den Kiosk, auch Büro-PCs und Entwickler-Macs mit Release-Artefakten aus `build-pos.yml` oder
lokalem `pnpm tauri:build`. Gewollt, sonst griffe der Schutz nur auf neu eingerichteten Geräten. Der
Schalter in den Einstellungen nimmt es je Gerät zurück. Gehört in die Release-Notiz.

## Was gesperrt ist

| Weg                                     | Abgefangen über                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Alt+F4, Schließen-Schaltfläche, Cmd+W   | `WindowEvent::CloseRequested` → `prevent_close()`                               |
| Benutzer-Exit (letztes Fenster zu u. a.) | `RunEvent::ExitRequested` mit `code == None` → `prevent_exit()`                 |
| macOS Cmd+Q                              | eigenes App-Menü ohne Quit-Eintrag (siehe unten)                                |
| Fensterrahmen, Minimieren, Maximieren   | `fullscreen(true)` und `decorations(false)` beim Erzeugen des Fensters          |

**Exits mit Code laufen durch.** `kiosk_exit` ruft `app.exit(0)`, der Updater `relaunch()`
(`RESTART_EXIT_CODE`); beides trägt einen Code und wird nie verhindert. Unter Windows beendet der
Updater die App in `downloadAndInstall` ohnehin per `std::process::exit`.

**macOS Cmd+Q:** Der Quit-Eintrag des Standard-App-Menüs löst `terminate:` aus, das in tao ohne
`ExitRequested` direkt zu `RunEvent::Exit` wird und sich nicht aufhalten lässt. Im Kiosk setzt die Shell
deshalb ein Menü aus App-Untermenü (nur „Über") und Bearbeiten-Menü. Das Bearbeiten-Menü bleibt, sonst
funktionieren Cmd+C/V im Webview nicht mehr. Windows und Linux bekommen kein Menü; dort hängte
`set_menu` eine Menüleiste ans Fenster.

**Kein verstecktes Fenster.** Das Fenster `main` steht in `tauri.conf.json` mit `create: false` und
entsteht im `setup()` per `WebviewWindowBuilder::from_config(...)` mit Vollbild und Rahmen schon gesetzt.
So erscheint es nicht kurz mit Rahmen, und anders als bei `visible: false` + `show()` kann kein Fehler
vor dem `show()` ein unsichtbares Fenster hinterlassen.

## Notausgang

Einstellungen → Info → Karte **Kiosk-Modus** (nur im Tauri-Client):

| Aktion                          | Command              | Wirkung                                               |
| ------------------------------- | -------------------- | ----------------------------------------------------- |
| Terminal beenden                | `kiosk_exit`         | setzt die Freigabe, beendet die App                   |
| Fenstermodus (nur bei aktivem Kiosk) | `kiosk_window_mode` | Rahmen zurück, Schließen erlaubt, bis zum nächsten Start |
| Kiosk-Modus aus- / einschalten  | `kiosk_set_enabled`  | schreibt `kiosk.json`, wirkt sofort                   |

Jede Aktion öffnet zuerst [`KioskPinDialogComponent`](../../libs/domains/devices/feature-pos-settings/src/lib/kiosk-pin-dialog/kiosk-pin-dialog.component.ts)
(Muster: Entkoppeln-Dialog). Kandidaten kommen per `users.find` mit `role: { $in: KIOSK_EXIT_ALLOWED_ROLES }`,
die Rolle des von `users.verifyPin` zurückgegebenen Users wird nochmals gegengeprüft. Erst danach ruft
der Dialog den Command. Ins native Log (`[kiosk] <aktion> freigegeben von <id> (<Rolle>)`)
gehen Aktion, Bediener-ID und Rolle, nie PIN und nie der Klarname (PII, `logging.md`).

**Personenkreis** `KIOSK_EXIT_ALLOWED_ROLES` = `tenant:owner`, `tenant:technician`
([`pos-authorization-roles.ts`](../../libs/domains/users/domain/src/lib/pos-authorization-roles.ts)).
Bewusst ohne `tenant:manager`, ohne Plattform-Rollen. Der Kreis steckt in `POS_AUTHORIZING_ROLES`, damit
er auf einem zugewiesenen Gerät sichtbar bleibt ([Geräte-Zuweisung](pos-geraete-zuweisung.md)).

## Grenzen

- **Kein Schutz gegen Absicht.** Task-Manager, Strg+Alt+Entf, Abmelden, Herunterfahren und auf macOS
  „Beenden" im Dock-Kontextmenü beenden die App weiter. Alt+Tab und die Windows-Taste wechseln zu
  anderen Apps.
- **Echter Windows-Kiosk:** Soll am Kassenplatz nur diese App laufen, ist das Gerätekonfiguration:
  Windows „Zugewiesener Zugriff" (Assigned Access) bzw. Kioskmodus unter *Einstellungen → Konten →
  Andere Benutzer*. Das liegt außerhalb dieses Codes.
- **Commands ohne PIN.** `kiosk_exit`, `kiosk_window_mode`, `kiosk_set_enabled` und
  `kiosk_report_paired` prüfen selbst keine PIN, der Schutz liegt in der UI. Der Webview lädt nur
  eigenen Code (CSP in `tauri.conf.json`). Gegen Bediener reicht das, gegen jemanden mit Gerätezugriff
  ist der Kiosk ohnehin keine Grenze.
- **Seitentür Entkoppeln.** Ein Manager darf das Gerät entkoppeln (`UNPAIR_ALLOWED_ROLES`). Danach ist
  es ungekoppelt und damit kein Kiosk mehr. Der Weg kostet aber die Kopplung und alle lokalen Daten.
- **Offline.** `users.verifyPin` läuft gegen den Edge. Ist er nicht erreichbar, ist der Notausgang zu;
  dann bleiben Task-Manager oder Neustart des Geräts. Eine Offline-PIN-Prüfung wäre eine eigene
  Sicherheitsfrage.
- **Nur das Fenster `main`.** Ein zweites Fenster (Kundendisplay) gibt es heute nicht.
- **Android (Capacitor, Sunmi)** ist nicht betroffen.

## Prüfbarkeit

Die PR-CI baut Linux mit `--debug` (Kiosk-Zweig inaktiv) und den Windows-Release-Job nur bei
Änderungen an Cargo-Dateien, `tauri*.conf.json`, `build.rs` oder Workflows. Beides beweist das
Kompilieren, nicht das Verhalten. `cargo test` in `pos-build-check.yml` deckt die
Entscheidungsfunktionen ab. Das Verhalten selbst ist erst mit einem `pos-v*` am Gerät sichtbar.
