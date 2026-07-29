---
type: ADR
title: POS-Build-Plattformen — macOS-Bundle über plattformspezifische Tauri-Config statt Änderung am Windows-Pfad
description: Der Tauri-POS baut zusätzlich ein Apple-Silicon-Bundle; die Zielplattform wird über eine automatisch gemergte tauri.macos.conf.json gesteuert, Testbuilds laufen bewusst über workflow_dispatch statt über den produktiven pos-v-Tag.
tags: [pos-client, ci, infra, devices]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-07-29T12:40:00Z }
---

# ADR 0014 — POS-Build-Plattformen (macOS)

## Problem

Der POS-Client wurde ausschließlich als Windows-NSIS-Installer gebaut und ausgeliefert. Ein
Test der App auf einem Mac war damit nur möglich, indem man sie lokal selbst übersetzt —
und der `README.md` behauptete fälschlich bereits „Tauri-based builds for Windows and macOS".

Technisch stand dem wenig im Weg: der Rust-Anteil ist plattformneutral. Es gibt keine
`[target.'cfg(windows)']`-Dependencies, kein `windows-rs`/`winapi`, keinen COM- oder
Registry-Zugriff, keinen seriellen Port und keinen USB-Code. Das einzige Windows-Artefakt
im Rust-Code ist die Boilerplate-Zeile `#![cfg_attr(not(debug_assertions),
windows_subsystem = "windows")]` in `apps/pos-client/src-tauri/src/main.rs`. Peripherie ist
durchgängig netzwerkbasiert: ESC/POS geht über TCP 9100 aus der `api-edge`, nicht aus dem
Client.

Die Windows-Bindung saß an drei Stellen: `bundle.targets` ohne `app`/`dmg`, beide Workflows
auf `windows-latest`, und das handgebaute `latest.json` mit fest verdrahtetem
`windows-x86_64`.

## Entscheidung

**1. Zielplattform über `tauri.macos.conf.json`, nicht über `tauri.conf.json`.**
Tauri v2 merged plattformspezifische Configs per JSON Merge Patch (RFC 7396) und **nur** auf
der jeweiligen Plattform; Arrays werden dabei ersetzt. Damit lässt sich `bundle.targets` auf
`["app", "dmg"]` umstellen, ohne dass der Windows-Pfad die Datei je zu Gesicht bekommt. Die
Alternative — `targets` in der Haupt-Config erweitern — hätte eine gemeinsame, für alle
Plattformen gültige Liste erzeugt und den erprobten NSIS-Pfad angefasst.

**2. `Info.plist` als eigene Datei neben der Config.**
`bundle.macOS.infoPlist` erwartet einen **Pfad**, kein Inline-Objekt (ein Inline-Objekt
bricht den Build mit `is not of types "null", "string"`). Tauri liest zusätzlich automatisch
eine `Info.plist` im Verzeichnis der Tauri-Config. Genutzt wird dieser implizite Weg, weil
ein expliziter Pfad-Key in diesem Repo bereits Pfadauflösungs-Probleme verursacht hat
(`--config` mit relativem Pfad, `os error 3`). Inhalt sind `NSLocalNetworkUsageDescription`
und `NSBonjourServices` — seit macOS 15 verlangt das System eine Local-Network-Berechtigung
für Multicast; ohne diese Keys liefert `discover_panary_hubs` still eine leere Liste, statt
den Berechtigungsdialog auszulösen.

**2b. App Transport Security abschalten (`NSAllowsArbitraryLoads`).**
macOS blockiert in Apps standardmäßig **jede Klartext-HTTP-Verbindung**. Browser und
`curl` sind davon ausgenommen, eine Tauri-App nicht — der Edge-Hub ist damit im gepackten
Build unerreichbar, obwohl er im Browser derselben Maschine antwortet. Das Fehlerbild ist
irreführend: der Fetch scheitert mit `TypeError: Load failed`, **ohne** dass eine
CSP-Verletzung ausgelöst wird (nachgewiesen über einen `securitypolicyviolation`-Listener:
für die Edge-URL feuert kein Event). Es betrifft LAN-IPs und Tailnet-Adressen gleichermaßen
und ist nicht mit CSP-Einträgen oder einer IP-Allowlist zu beheben.

`NSAllowsLocalNetworking` reicht nicht: es deckt nur RFC-1918-, link-local- und
`.local`-Adressen ab, nicht den CGNAT-Bereich `100.64.0.0/10`, den Tailscale verwendet.
Da der Edge per Design ohne TLS unter einer freien Adresse läuft, ist
`NSAllowsArbitraryLoads` die einzige Option, die alle Betriebsformen abdeckt. Der Preis:
die App akzeptiert Klartext-HTTP zu beliebigen Hosts — die Eingrenzung leistet weiterhin
die CSP (`connect-src` erlaubt nur Port 3030 plus die bekannten Panary-Domains).

**2c. IPC-Kanal in die CSP aufnehmen.**
Auf macOS/Linux läuft Tauris IPC über `ipc://localhost`, auf Windows über
`http://ipc.localhost`. Die bestehende `connect-src`-Liste enthielt keines von beiden, was
auf macOS bei jedem Start zu `violated=connect-src blocked=ipc://localhost/js_log` führte;
Tauri fiel still auf die langsamere `postMessage`-Schnittstelle zurück. Beide Quellen sind
jetzt in der gemeinsamen CSP eingetragen — additiv und damit ohne Wirkung auf den
Windows-Pfad.

**3. Ad-hoc-Signierung (`signingIdentity: "-"`) als Zwischenstand.**
Es existiert kein Apple-Developer-Zertifikat. Ad-hoc ist auf Apple Silicon der richtige
Zwischenschritt: das Bundle wird vollständig gesiegelt (`codesign --verify --deep --strict`
läuft durch), Hardened Runtime ist per Tauri-Default aktiv. Gatekeeper bewertet das Ergebnis
trotzdem als `rejected` — heruntergeladene Builds brauchen einmalig
`xattr -dr com.apple.quarantine` oder Rechtsklick → Öffnen.

**4. Testbuilds über `workflow_dispatch`, nicht über den Release-Tag.**
Ein `pos-v*`-Tag ist ein Produktiv-Release, das alle Windows-Kassen über den Updater
erreicht. Ein Testbuild für den Mac darf das nicht auslösen. Der Dispatch-Workflow
(`build-pos.yml`) ist deshalb das primäre Vehikel: beliebiger Branch, kein Tag, kein
Versions-Bump. `release-pos.yml` hängt das Bundle zusätzlich ans reguläre Release.

**5. Kein Updater-Pfad auf macOS (vorerst).**
`createUpdaterArtifacts` ist in der macOS-Config `false`. Damit braucht der macOS-Job keinen
Signing-Key — der bleibt dem Windows-Release-Job vorbehalten (Least-Privilege), und
`latest.json` bleibt unverändert Windows-only. Der Update-Check der App fängt den fehlenden
`darwin-aarch64`-Key im `try/catch` des `UpdateService` ab; es entsteht nur eine
Konsolenmeldung.

**6. `.dmg` statt `.app` als Artefakt.**
`actions/upload-artifact` zippt ohne Executable-Bits und ohne Symlinks — ein so übertragenes
`.app`-Bundle startet auf dem Zielrechner nicht. Das Disk-Image übersteht die Runde.

**7. `release-macos` mit `needs: release-windows`.**
Das GitHub-Release wird von `tauri-action` im Windows-Job angelegt. Ohne die Abhängigkeit
würden zwei Jobs dasselbe Release erzeugen wollen; so hängt der macOS-Job nur noch an
(`gh release upload`) und braucht `tauri-action` gar nicht.

**8. Der Workspace-Materialisierungs-Step wird dupliziert, nicht extrahiert.**
Der Release-Workflow bereitet `pnpm-workspace.yaml` und `.npmrc` in einem `pwsh`-Step vor.
Der macOS-Job bekommt einen inhaltsgleichen bash-Port statt eines gemeinsamen Skripts. Der
Windows-Release-Pfad ist historisch fragil (Em-Dash im `productName`, Auflösung des
`--config`-Pfads, Symlink-Lockfile, Bitwarden-Tag-Pinning) und darf durch die macOS-Erweiterung
nicht berührbar sein. Der Preis ist eine Sync-Pflicht, die als Kommentar in beiden Fassungen
steht.

**Zielarchitektur ist `aarch64-apple-darwin`**, explizit gesetzt statt auf die
Runner-Architektur von `macos-latest` zu vertrauen. Intel- und Universal-Builds sind bewusst
nicht abgedeckt.

## Konsequenzen

- Das macOS-Bundle **aktualisiert sich nicht selbst**. Updates laufen über einen neuen
  Download, bis der Signing-Pfad steht.
- Heruntergeladene Builds lösen eine Gatekeeper-Warnung aus. Das ist erwartetes Verhalten,
  kein Fehler.
- **Offen (eigene Phase):** Apple Developer Program (99 €/Jahr) → Developer-ID-Zertifikat und
  Notarisierung. Dann entfallen `signingIdentity: "-"` (kollidiert sonst mit
  `APPLE_SIGNING_IDENTITY`) und die Gatekeeper-Warnung; die nötigen Secrets
  (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` und die App-Store-Connect-API-Trias
  `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH`) gehören nach BWS, analog zu den
  Tauri-Updater-Keys.
- Soll später auch macOS Auto-Updates bekommen, muss der `latest.json`-Step die
  `platforms`-Map **mergen** statt überschreiben — sonst löscht der zweite Job den Eintrag
  des ersten. Schlüssel wäre `darwin-aarch64`, die URL zeigt auf das `.app.tar.gz`, nicht
  auf das `.dmg`.
- Zwei Fassungen des Materialisierungs-Steps sind synchron zu halten.
- Auto-Discovery per mDNS funktioniert auf einem Mac nicht, wenn die `api-edge` dort in
  Docker Desktop läuft: die Linux-VM leitet kein Multicast weiter (siehe
  [POS-Pairing-Wizard](../domains/pos-pairing-wizard.md)). Pairing läuft dann über QR oder
  manuelle IP.
- `deb`/`appimage` stehen weiterhin in `bundle.targets`, werden aber von keinem Workflow
  gebaut — Linux bleibt konfiguriert, aber unverifiziert.
