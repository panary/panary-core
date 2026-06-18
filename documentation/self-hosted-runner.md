---
title: Self-hosted GitHub Actions Runner — Setup, Sicherheit & Betrieb
date: 2026-06-19
category: Infrastruktur
domains: [ci, infra, ops]
status: aktiv (Setup ausstehend)
---

# Self-hosted GitHub Actions Runner

Geteilte CI-Infrastruktur für **panary-core** und **panary-cloud**. Ein
self-hosted Runner führt die GitHub-Actions-Jobs auf eigener Hardware aus —
**ohne GitHub-Hosted-Minuten zu verbrauchen** (self-hosted Minuten sind
kostenlos). Zusammen mit dem [Nx-Remote-Cache](nx-remote-cache.md) auf demselben
Host bildet er die hauseigene CI-Beschleunigung.

## Warum

- **Minuten-Kosten:** Private Repos haben ein begrenztes Hosted-Minuten-Kontingent.
  Die häufigen `ci.yml`-Läufe (PR + main-Push, beide Repos) fressen es auf →
  self-hosted = kein Limit, keine Kosten.
- **Cache-Synergie:** Liegt der Runner auf demselben Host wie der nx-cache-server,
  erreicht er den Cache **intern** → der Cache braucht keine öffentliche Exposition.
- **Kontrolle/DSGVO:** eigene Hardware, eigene Tool-Versionen, Daten im Haus.

## Architektur

- **Org-Level-Runner** (registriert auf der Organisation `panary`, **nicht** pro
  Repo) → bedient **beide** Repos aus einer Instanz. Zugriff wird über
  **Runner-Groups** auf `panary-core` + `panary-cloud` beschränkt.
- **Host: Staging** (neben dem nx-cache-server) — **nicht** der Prod-Host.
  CI-Infra gehört nicht auf die Produktions-Maschine (Blast-Radius).
- **Label `staging`** steuert, welche Workflows hier laufen (siehe runs-on-Mapping).
- ⚠️ **Sizing:** Angular-Builds sind CPU/RAM-intensiv. Reserve auf dem Staging-Host
  einplanen oder eine kleine separate VM danebenstellen, damit die Builds die
  Staging-Apps nicht ausbremsen.

## Voraussetzungen

- **Org-Owner-Rechte** auf `panary` (Registration-Token + Runner-Group).
- **Docker** auf dem Host — die `security.yml`-Jobs (gitleaks/semgrep/osv) laufen
  in `container:` und brauchen Docker. Der Coolify-Host hat es.
- Ein **Nicht-root-User** für den Runner (GitHub verbietet root).

## Setup (als systemd-Dienst)

1. **Token holen:** GitHub → Org `panary` → **Settings → Actions → Runners →
   New runner → New self-hosted runner** → **Linux / x64**. GitHub zeigt die
   exakten Befehle inkl. **zeitlich begrenztem Token (1 h gültig)** + aktueller
   Runner-Version.

2. **User + Verzeichnis:**
   ```bash
   sudo useradd -m -s /bin/bash ghrunner
   sudo usermod -aG docker ghrunner          # für container:-Jobs
   sudo -iu ghrunner && mkdir actions-runner && cd actions-runner
   ```

3. **Download + entpacken** (Version/URL exakt aus der GitHub-UI kopieren — sie
   ändert sich mit jeder Runner-Version):
   ```bash
   curl -o runner.tar.gz -L https://github.com/actions/runner/releases/download/v<VER>/actions-runner-linux-x64-<VER>.tar.gz
   tar xzf runner.tar.gz
   ```

4. **Konfigurieren:**
   ```bash
   ./config.sh --url https://github.com/panary --token <TOKEN> \
     --name staging-runner-1 --labels staging --runnergroup default \
     --unattended --ephemeral
   ```
   - `--labels staging` = Basis der runs-on-Trennung.
   - `--ephemeral` = Runner setzt sich nach **jedem** Job neu auf → kein
     persistenter Kompromiss-Zustand (Security, s. u.).

5. **Als Dienst installieren** (Auto-Start, läuft als `ghrunner`, NICHT root):
   ```bash
   exit                                       # zurück zum sudo-User
   cd /home/ghrunner/actions-runner
   sudo ./svc.sh install ghrunner
   sudo ./svc.sh start
   sudo ./svc.sh status
   ```

6. **Runner-Group beschränken:** Org → Settings → Actions → Runner groups → die
   Gruppe nur für `panary-core` + `panary-cloud` freigeben (least privilege).
   Public-Repo-Zugriff bleibt aus (GitHub-Default).

## `runs-on`-Mapping (Staging/Prod-Trennung)

| Workflow | Repo | `runs-on` | Begründung |
|---|---|---|---|
| `ci.yml` | core + cloud | `[self-hosted, staging]` | häufig (PR+main), nicht-prod |
| `build-and-push-staging.yml` | cloud | `[self-hosted, staging]` | ist Staging |
| `security.yml` | core + cloud | `[self-hosted, staging]` (optional) | Nightly/PR, braucht Docker |
| `build-and-push.yml` | cloud | **`ubuntu-latest`** / Prod-Runner | **Prod-Deploy**, nur `v*`-Tag, selten |
| `build-edge-docker.yml` | core | **`ubuntu-latest`** / Prod-Runner | Edge-Release, selten |
| `build-/release-pos-windows.yml` | core | **Windows-Runner** | Tauri braucht Windows |
| `publish-libraries.yml` | core | **`ubuntu-latest`** | Release auf Tag |

**Prinzip:** Die **häufigen, nicht-prod** Workflows → Staging-Runner (spart die
meisten Minuten). Die **seltenen Prod-Deploy-/Release-Workflows** bleiben
GitHub-hosted (geringe Minuten) → **kein Prod-Deploy auf dem Staging-Runner**.
Wer auch prod self-hosten will: **separater Runner auf dem Prod-Host**, Label
`prod`, Prod-Workflows auf `[self-hosted, prod]`.

> Hinweis: Das Umstellen von `runs-on: ubuntu-latest` auf `[self-hosted, staging]`
> ist eine Workflow-Änderung in den jeweiligen `.yml`-Dateien — bewusst noch nicht
> umgesetzt, bis der Runner steht.

## Sicherheit

Self-hosted Runner führen Workflow-Code auf **eurer** Infra aus — das ist die
zentrale Risikoachse:

- ✅ **Nur private Repos.** Eure Repos sind privat (keine Fork-PRs) — die
  Grundvoraussetzung. Self-hosted Runner **niemals** für öffentliche Repos
  (ein Fork-PR könnte beliebigen Code auf dem Host ausführen).
- **`--ephemeral`** verwenden — frischer Runner pro Job begrenzt die Persistenz
  eines etwaigen Kompromisses.
- **Runner-Host isolieren:** nicht der Prod-Host; keine Prod-Secrets auf dem Host
  ablegen. Der Runner bekommt Secrets nur aus dem Job-Kontext (GitHub-Secrets).
- **Runner-Group** auf die zwei Repos beschränken.
- **`docker`-Gruppe ≈ root:** `ghrunner` ist für die `container:`-Jobs in der
  `docker`-Gruppe — das ist effektiv root auf dem Host. Daher Host-Isolation umso
  wichtiger.

## Zusammenspiel mit dem Nx-Remote-Cache

Runner + [nx-cache-server](nx-remote-cache.md) auf demselben Staging-Host:

- Der Runner erreicht den Cache **intern** (`http://<intern>:3000` bzw. der
  Coolify-interne Service-Name) → `NX_CACHE_SERVER_URL` kann auf die interne
  Adresse zeigen.
- Sobald **keine** GitHub-Hosted-Runner mehr auf den Cache zugreifen (alles
  self-hosted), kann die **öffentliche Cache-Exposition entfallen** → Angriffsfläche weg.
- Das Token-Modell bleibt gleich (`NX_CACHE_RW_TOKEN` nur auf main-Push; PRs lokal).

## Betrieb

| Aufgabe | Befehl |
|---|---|
| Status | `sudo ./svc.sh status` |
| Stop / Start | `sudo ./svc.sh stop` / `start` |
| Dienst entfernen | `sudo ./svc.sh uninstall` |
| Runner abmelden (GitHub) | `./config.sh remove --token <REMOVE_TOKEN>` |
| Logs | `journalctl -u 'actions.runner.panary.*' -f` |
| Fehlende Distro-Deps | `sudo ./bin/installdependencies.sh` |

- **Mehrere Runner** für Parallelität: weitere Instanzen in eigenen Verzeichnissen
  (`actions-runner-2`, …) mit eigenem `--name`, gleichem Label.
- **Updates** zieht der Runner i. d. R. selbst; bei Bedarf abmelden + neu `config.sh`.

## Referenzen

- Nx-Remote-Cache (gleicher Host): [`nx-remote-cache.md`](nx-remote-cache.md)
- Deployment-Integration: `panary-cloud/documentation/deployment-staging.md` §8
  (Staging) + `deployment-production.md` §8 (Prod-Trennung)
- GitHub-Docs: „Adding self-hosted runners" + „Configuring the application as a service"
