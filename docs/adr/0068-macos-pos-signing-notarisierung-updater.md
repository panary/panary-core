---
type: ADR
title: 'macOS-POS — Developer-ID-Signatur, Notarisierung und Auto-Update über latest.json'
description: 'Das Apple-Silicon-Bundle des POS wird mit Developer-ID signiert, notarisiert und als darwin-aarch64 in das Updater-Manifest des Windows-Jobs eingefügt; ohne Apple-Signing bricht der macOS-Job ab, statt ad-hoc zu bauen. Löst die Punkte 3 und 5 von ADR 0014 ab.'
tags: [pos-client, ci, infra, updater, release]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-11-02T09:30:00Z }
---

# ADR 0068 — macOS-POS: Signatur, Notarisierung und Auto-Update

## Problem

Das macOS-POS (`aarch64`) aktualisierte sich nicht selbst. [ADR 0014](0014-pos-build-plattformen.md)
hatte das bewusst so entschieden (Punkte 3 und 5): ad-hoc signiert, `createUpdaterArtifacts: false`,
`latest.json` nur mit `windows-x86_64`. Die Folge im Betrieb: Der Updater meldete alle 30 Minuten
`None of the fallback platforms ["darwin-aarch64-app", "darwin-aarch64"] were found`, und bei
`pos-v26.10.48` musste das `.dmg` von Hand installiert werden, um drei Fixes zu bekommen
(panary/panary-core#1229).

Für den Updater allein wäre kein Apple-Zertifikat nötig: `.app.tar.gz` und `.sig` signiert der
minisign-Schlüssel, den Windows schon nutzt. Ein ad-hoc signiertes Bundle hat aber bei jedem Build
eine neue Identität. macOS kann dann nach jedem Update die Berechtigung „Lokales Netzwerk“ neu
abfragen, und die braucht die mDNS-Hub-Suche (`Info.plist`). Außerdem lehnt Gatekeeper ein
heruntergeladenes ad-hoc-Bundle ab.

## Entscheidung

**1. Developer-ID-Signatur und Notarisierung (Michael, 2026-11-02).** Der Job `release-macos`
baut mit `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` und
notarisiert über `APPLE_ID`, `APPLE_PASSWORD` (App-spezifisch), `APPLE_TEAM_ID`. Das Tauri-CLI
importiert das Zertifikat selbst in einen temporären Schlüsselbund. Die Apple-ID-Variante statt der
API-Key-Trias aus ADR 0014: Sie kommt ohne `.p8`-Datei auf dem Runner aus. `signingIdentity: "-"`
ist aus `tauri.macos.conf.json` entfernt, die Identität kommt allein aus der Umgebung.

**2. Secrets in Bitwarden, die IDs als Repo-Variablen.** Wie bei den Tauri-Schlüsseln liegen die
Werte in Bitwarden. Die sechs Secret-IDs stehen nicht im Workflow, sondern als Repo-Variablen
`BWS_ID_POS_APPLE_*` (Zeiger, keine Geheimnisse). So lässt sich der Workflow mergen, bevor das
Apple-Konto steht, und das Einrichten braucht keinen zweiten PR.

**3. Ohne Signing kein Build.** Fehlt eine Variable oder liefert Bitwarden einen leeren Wert, bricht
der Job mit einer Meldung ab. Ohne diese Prüfung würde das Tauri-CLI Signatur und Notarisierung nur
mit Warnung überspringen, und ein unsigniertes Bundle stünde im Manifest jeder Kasse. Nach dem Build
prüft der Job am Artefakt selbst: `codesign --verify --deep --strict`, Authority
`Developer ID Application`, `stapler validate`, `spctl --assess`.

**4. Das Manifest wird erweitert, nie ersetzt.** `release-macos` läuft nach `release-windows`
(`needs`, ADR 0014 Punkt 7). Er lädt das `latest.json` des Releases, prüft Version und
`windows-x86_64`, setzt `darwin-aarch64` und `darwin-aarch64-app` (der Updater sucht beide) und lädt
nur hoch, wenn der Windows-Eintrag danach byte-gleich ist. Schlägt ein Schritt fehl, bleibt das
Windows-Manifest stehen.

**5. `build-pos.yml` signiert mit, bekommt aber keinen Updater-Schlüssel.** Der Dispatch-Build
beweist Signatur und Notarisierung vor dem Tag. Den minisign-Schlüssel bekommt er weiter nicht
(Least-Privilege, ADR 0014), die Updater-Artefakte sind dort per `--config`-Override aus.

## Konsequenzen

- Ab dem ersten Release mit eingerichtetem Signing findet ein macOS-POS neue Versionen selbst.
  Der erste Umstieg von einem ad-hoc-Build braucht noch einmal das `.dmg`.
- **Bis die sechs Repo-Variablen gesetzt sind, ist `release-macos` bei jedem `pos-v*`-Release rot**
  und hängt kein `.dmg` an. Das Windows-Release samt `latest.json` ist davon nicht betroffen, es
  ist vorher fertig.
- Wird `release-windows` später einzeln neu gestartet, schreibt er `latest.json` ohne
  macOS-Eintrag. Danach auch `release-macos` neu starten.
- Ein lokaler `pnpm tauri build` auf dem Mac braucht jetzt `TAURI_SIGNING_PRIVATE_KEY` oder
  `--config '{"bundle":{"createUpdaterArtifacts":false}}'`, wie unter Windows.
- Das Apple-Developer-Konto kostet 99 USD im Jahr. Das Zertifikat läuft nach fünf Jahren ab,
  ein abgelaufenes stoppt den Job an der Signaturprüfung.
- Einrichtung Schritt für Schritt:
  [Tauri Update-Server-Einrichtung § macOS](../integrations/tauri-update-server-einrichtung.md#macos-signing-und-notarisierung-einrichten).
