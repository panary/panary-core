---
type: Guide
title: Tauri Update-Server-Einrichtung
description: 'Einrichtung des Tauri-Auto-Update-Systems: Ed25519-Signatur-Schlüsselpaar, GitHub-Actions-Release-Workflow mit latest.json und Update-Prüfung samt Installation in der POS-App.'
tags: [tauri, pos, updater, release]
status: stable
generated: { by: claude-code/historic, at: 2025-03-28T00:00:00Z }
---

# Tauri Auto-Update — Einrichtung & Release-Prozess

> **Geltungsbereich: Windows.** Der hier beschriebene Updater-Pfad (NSIS-Artefakte,
> minisign-Signatur, `latest.json`) gilt ausschließlich für den Windows-Build. Das
> macOS-Bundle wird zwar im selben Release mitgeliefert, hat aber **keinen
> Auto-Updater**: `createUpdaterArtifacts` ist in `tauri.macos.conf.json` auf `false`,
> und `latest.json` kennt nur den Schlüssel `windows-x86_64`. macOS wird durch einen
> neuen Download aktualisiert. Begründung und der Weg zu einem macOS-Updater:
> [ADR 0014 — POS-Build-Plattformen](../adr/0014-pos-build-plattformen.md).

## Architektur-Übersicht

```
Tag-Push (pos-v2026.x.x)
  → GitHub Actions Workflow
    → Angular Build (Production)
    → Tauri Build (NSIS-Installer, signiert)
    → latest.json generiert (Update-Manifest)
  → GitHub Release erstellt
    → Panary POS_2026.x.x_x64-setup.exe
    → Panary POS_2026.x.x_x64-setup.nsis.zip
    → Panary POS_2026.x.x_x64-setup.nsis.zip.sig
    → latest.json

Tauri-App (installiert beim Kunden)
  → Prüft alle 30 Min: GET https://github.com/panary/panary-core/releases/latest/download/latest.json
  → Vergleicht Version → zeigt Update-Badge auf Login-Seite
  → Benutzer klickt "Aktualisieren & Neustarten"
    → Download + Signatur-Prüfung + Installation + Neustart
```

---

## Voraussetzungen

- **Rust** (stable, >= 1.77.2): https://rustup.rs
- **Tauri CLI** v2: `pnpm add -w -D @tauri-apps/cli`
- **pnpm** als Paketmanager
- **GitHub Repository**: `panary/panary-core` (öffentlich)

---

## 1. Schlüsselpaar generieren (einmalig)

Das Tauri-Update-System verwendet Ed25519-Signaturen. Jedes Release wird signiert, die App prüft die Signatur vor der Installation.

```bash
cd panary-core/apps/pos-client
pnpm tauri signer generate -w ~/.tauri/panary-pos.key
```

**Ausgabe:**
- **Private Key**: `~/.tauri/panary-pos.key` (NIEMALS committen!)
- **Public Key**: wird in der Konsole angezeigt (langer Base64-String)
- **Passwort**: wird abgefragt — sicher aufbewahren

### Public Key eintragen

Den angezeigten Public Key in `apps/pos-client/src-tauri/tauri.conf.json` eintragen:

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/panary/panary-core/releases/latest/download/latest.json"
    ],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbm... <HIER DEN PUBLIC KEY EINFÜGEN>"
  }
}
```

---

## 2. GitHub Secrets konfigurieren

Im Repository unter **Settings → Secrets and variables → Actions** zwei Secrets anlegen:

| Secret | Wert |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Inhalt der Datei `~/.tauri/panary-pos.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Das Passwort, das bei der Generierung gewählt wurde |

**Private Key auslesen:**

```bash
cat ~/.tauri/panary-pos.key
```

Den gesamten Inhalt (inkl. `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----`) als Secret speichern.

---

## 3. Release-Prozess

### Version bumpen

Die Version in `apps/pos-client/src-tauri/tauri.conf.json` ist die **Source of Truth**:

```json
{
  "version": "2026.4.0"
}
```

Zusätzlich synchronisieren:
- `apps/pos-client/src/app/app.config.ts` → `appVersion: '2026.4.0'`
- `libs/domains/users/feature-pos-login/src/lib/login.component.html` → Footer-Versionstext

### Tag erstellen und pushen

```bash
git add -A
git commit -m "Release Panary POS v2026.4.0"
git tag pos-v2026.4.0
git push origin main --tags
```

### Automatischer Workflow

Der Push des Tags `pos-v2026.4.0` löst den Workflow `.github/workflows/release-pos.yml` aus:

1. Angular-App wird für Production gebaut
2. Tauri baut den NSIS-Installer und signiert ihn
3. `latest.json` wird automatisch generiert
4. Ein GitHub Release wird erstellt mit allen Artefakten
5. Der Job `release-sbom` hängt die Stückliste an dasselbe Release

### Release prüfen

Unter https://github.com/panary/panary-core/releases sollte das neue Release erscheinen mit:
- `Panary POS_2026.4.0_x64-setup.exe` — der Installer
- `Panary POS_2026.4.0_x64-setup.nsis.zip` — das Update-Paket
- `Panary POS_2026.4.0_x64-setup.nsis.zip.sig` — die Signatur
- `latest.json` — das Update-Manifest
- `panary-pos-2026.4.0.cdx.json` — die CycloneDX-Stückliste (npm und Cargo), angehängt vom Job `release-sbom` ([ADR 0051](../adr/0051-stueckliste-je-release-cyclonedx.md#pos-paket-pos-v-core421))

---

## 4. Update-Verhalten in der App

### Automatische Prüfung

Der `UpdateService` prüft:
- **Erster Check**: 5 Sekunden nach dem Laden der Login-Seite
- **Danach**: alle 30 Minuten

### Benutzer-Interaktion

Wenn ein Update verfügbar ist, erscheint auf der Login-Seite ein dezenter Amber-Badge:

```
[v2026.4.0 verfügbar] [Aktualisieren & Neustarten]
```

- Der Benutzer wird **nicht** durch Popups oder erzwungene Neustarts unterbrochen
- Das Update wird nur angezeigt, wenn der Benutzer auf der Login-Seite ist
- Klick auf "Aktualisieren & Neustarten" lädt das Update herunter, installiert es und startet die App neu

### Kein Update-Server nötig

Da das Repository öffentlich ist, nutzt die App direkt die GitHub Releases API. Die URL:

```
https://github.com/panary/panary-core/releases/latest/download/latest.json
```

liefert immer das Manifest des neuesten Releases.

---

## 5. Manueller Build (ohne Release)

Für lokale Tests oder manuelle Builds ohne Release:

```bash
cd panary-core
pnpm nx build pos-client --configuration=production
cd apps/pos-client
pnpm tauri build
```

Der Installer liegt dann unter `apps/pos-client/src-tauri/target/release/bundle/nsis/`.
Auf einem Mac entstehen stattdessen `bundle/macos/*.app` und `bundle/dmg/*.dmg` — der
Angular-Build muss dort vorher separat laufen (`pnpm nx build pos-client --configuration=production`),
weil `beforeBuildCommand` bewusst leer ist.

Alternativ kann der bestehende Workflow `build-pos.yml` manuell über GitHub Actions ausgelöst werden (Workflow Dispatch). Er baut beide Plattformen und legt die Artefakte als Workflow-Artifacts ab, ohne ein Release zu erzeugen.

---

## 6. Troubleshooting

### Signatur-Mismatch

**Symptom:** Update-Download schlägt mit Signatur-Fehler fehl.

**Ursache:** Der Public Key in `tauri.conf.json` stimmt nicht mit dem Private Key überein, mit dem signiert wurde.

**Lösung:**
- Prüfen, ob `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets korrekt ist
- Prüfen, ob der `pubkey` in `tauri.conf.json` zum gleichen Schlüsselpaar gehört

### CSP-Fehler

**Symptom:** Update-Check schlägt fehl, Konsole zeigt CSP-Fehler.

**Lösung:** In `tauri.conf.json` prüfen, ob `connect-src` die GitHub-Domains enthält:
```
https://github.com https://*.github.com https://*.githubusercontent.com
```

### Update wird nicht erkannt

**Symptom:** App zeigt kein Update an, obwohl ein neues Release existiert.

**Prüfschritte:**
1. Ist die Version in `tauri.conf.json` des Releases **höher** als die installierte Version?
2. Ist `latest.json` im GitHub Release vorhanden?
3. Ist die URL `https://github.com/panary/panary-core/releases/latest/download/latest.json` erreichbar?
4. Hat der Installer Netzwerkzugriff (Firewall)?

### Update im Browser-Dev-Modus

Im Browser-Entwicklungsmodus (`nx serve pos-client`) ist der UpdateService inaktiv — er prüft `__TAURI_INTERNALS__` und überspringt alle Operationen, wenn die App nicht in Tauri läuft.

---

## 7. App-Name „Panary Terminal“ (seit panary/panary-core#1106)

Bis `pos-v26.10.33` hieß die App `Panary — Terminal`. Seit #1106 tragen `productName` und Fenstertitel
in `apps/pos-client/src-tauri/tauri.conf.json` den Namen `Panary Terminal`, ohne Gedankenstrich
(Regel: `.claude/rules/code-style.md` §9.2). Michael hat die Umbenennung trotz der folgenden Folgen
freigegeben (2026-10-26). Der `identifier` `de.panary.pos` bleibt unverändert.

### Was die Umbenennung auf Windows auslöst

Tauris NSIS-Vorlage (`tauri-bundler`, `installer.nsi`) leitet drei Dinge aus `PRODUCTNAME` ab:

| Wert | Bisher | Neu |
|---|---|---|
| Uninstall-Schlüssel | `…\CurrentVersion\Uninstall\Panary — Terminal` | `…\CurrentVersion\Uninstall\Panary Terminal` |
| Schlüssel, unter dem der Installer die vorige Installation sucht (`MANUPRODUCTKEY`) | `…\Panary — Terminal` | `…\Panary Terminal` |
| Standard-Installationsordner (`installMode: perMachine`) | `C:\Program Files\Panary — Terminal` | `C:\Program Files\Panary Terminal` |

Das erste Update auf den neuen Namen, ob über den Updater oder als Installer von Hand, findet die alte
Installation deshalb nicht. Es installiert **zusätzlich** in den neuen Ordner. Unter „Apps“ stehen danach
zwei Einträge, und die alte Verknüpfung startet weiter die alte Version.

**Was nach dem Update am Windows-Gerät zu tun ist:**

1. Prüfen, ob `Panary Terminal` startet und die neue Version zeigt.
2. Unter „Einstellungen → Apps“ den Eintrag **`Panary — Terminal`** deinstallieren.
   🚨 **Im Deinstaller das Häkchen „App-Daten löschen“ NICHT setzen.** Es löscht
   `%APPDATA%\de.panary.pos` und `%LOCALAPPDATA%\de.panary.pos` (`installer.nsi`, Abschnitt
   `DeleteAppDataCheckboxState`). Diese Ordner hängen am `identifier`, nicht am Produktnamen. Die
   neue Installation benutzt dieselben Ordner. Mit dem Häkchen gehen Kopplung, Offline-Cache und die
   **Outbox mit noch nicht übertragenen Bestellungen** verloren.
3. Alte Verknüpfungen (Desktop, Taskleiste, Autostart) entfernen bzw. auf `Panary Terminal` setzen.

**Was erhalten bleibt:** Die App-Daten (Kopplung, Offline-Cache, Outbox) liegen unter dem
`identifier` `de.panary.pos`, nicht unter dem Produktnamen. Die neue Installation findet sie wieder,
solange beim Deinstallieren der alten App das Häkchen oben nicht gesetzt wird.

**Nicht betroffen:**

- **Sunmi:** Die Android-APK ist der Capacitor-Wrapper mit `appName: 'Panary POS'`
  (`apps/pos-client/capacitor.config.ts`). Der Tauri-`productName` spielt dort keine Rolle.
- **Updater-Manifest:** `release-pos.yml` liest den Namen des `-setup.exe`-Assets aus dem
  tatsächlich hochgeladenen Release, statt ihn aus dem `productName` zu bilden. Der Endpunkt
  (`latest.json`) bleibt gleich.
- **macOS:** Ohne Auto-Updater (§ oben). Das neue Bundle heißt `Panary Terminal.app`, die alte
  `Panary — Terminal.app` muss von Hand aus `/Applications` gelöscht werden.

Ein NSIS-Hook, der die Altinstallation selbst entfernt, wurde bewusst nicht gebaut (Entscheidung
Orchestrierung/Michael, 2026-10-26): Es betrifft genau ein Update je Gerät.
