# Tauri Auto-Update — Einrichtung & Release-Prozess

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
cd panary-core/apps/pos
pnpm tauri signer generate -w ~/.tauri/panary-pos.key
```

**Ausgabe:**
- **Private Key**: `~/.tauri/panary-pos.key` (NIEMALS committen!)
- **Public Key**: wird in der Konsole angezeigt (langer Base64-String)
- **Passwort**: wird abgefragt — sicher aufbewahren

### Public Key eintragen

Den angezeigten Public Key in `apps/pos/src-tauri/tauri.conf.json` eintragen:

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

Die Version in `apps/pos/src-tauri/tauri.conf.json` ist die **Source of Truth**:

```json
{
  "version": "2026.4.0"
}
```

Zusätzlich synchronisieren:
- `apps/pos/src/app/app.config.ts` → `appVersion: '2026.4.0'`
- `libs/domains/users/feature-pos-login/src/lib/login.component.html` → Footer-Versionstext

### Tag erstellen und pushen

```bash
git add -A
git commit -m "Release Panary POS v2026.4.0"
git tag pos-v2026.4.0
git push origin main --tags
```

### Automatischer Workflow

Der Push des Tags `pos-v2026.4.0` löst den Workflow `.github/workflows/release-pos-windows.yml` aus:

1. Angular-App wird für Production gebaut
2. Tauri baut den NSIS-Installer und signiert ihn
3. `latest.json` wird automatisch generiert
4. Ein GitHub Release wird erstellt mit allen Artefakten

### Release prüfen

Unter https://github.com/panary/panary-core/releases sollte das neue Release erscheinen mit:
- `Panary POS_2026.4.0_x64-setup.exe` — der Installer
- `Panary POS_2026.4.0_x64-setup.nsis.zip` — das Update-Paket
- `Panary POS_2026.4.0_x64-setup.nsis.zip.sig` — die Signatur
- `latest.json` — das Update-Manifest

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
pnpm nx build pos --configuration=production
cd apps/pos
pnpm tauri build
```

Der Installer liegt dann unter `apps/pos/src-tauri/target/release/bundle/nsis/`.

Alternativ kann der bestehende Workflow `build-pos-windows.yml` manuell über GitHub Actions ausgelöst werden (Workflow Dispatch).

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

Im Browser-Entwicklungsmodus (`nx serve pos`) ist der UpdateService inaktiv — er prüft `__TAURI_INTERNALS__` und überspringt alle Operationen, wenn die App nicht in Tauri läuft.
