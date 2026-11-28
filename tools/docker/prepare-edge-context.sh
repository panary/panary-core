#!/bin/bash
# ============================================================
# Docker-Build-Kontext fuer Dockerfile.edge materialisieren (nur CI).
#
# Aufgerufen von build-edge-docker.yml (Release/Dispatch) UND
# edge-image-check.yml (PR-Pruefung, panary/panary-core#497). Ein gemeinsames
# Skript, damit die PR-Pruefung genau den Nachbau baut, den der Release baut —
# zwei Kopien drifteten auseinander, und der PR waere gruen gegen einen
# Kontext, den es im Release nicht gibt.
#
# Veraendert den Checkout (pnpm-workspace.yaml, .npmrc, pnpm-lock.yaml,
# .dockerignore). Lokal nicht aufrufen — lokal baut tools/docker/build-edge.sh.
# Voraussetzung: pnpm und Node 22 im PATH.
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/../.."

cp tools/docker/.dockerignore .dockerignore

# Workspace-Files fuer den Docker-Build-Kontext bereitstellen.
# Das Repo bringt eine `pnpm-workspace.yaml` mit, die NUR die
# Supply-Chain-Settings traegt (kein `packages:`-Key, damit der
# Standalone-Install ein Single-Package-Install bleibt). Fuer den
# Docker-Build braucht es zusaetzlich die Workspace-Globs — die werden
# daher ANGEHAENGT, nicht drueber geschrieben; sonst gingen
# minimumReleaseAge/trustPolicy/blockExoticSubdeps still verloren.
# Ausserdem ist pnpm-lock.yaml lokal ein Symlink ins Workbench-Root
# (`pnpm-lock.yaml -> ../pnpm-lock.yaml`) und muss durch eine echte
# Lockfile ersetzt werden, sonst bricht `Dockerfile.edge:23`
# (COPY pnpm-workspace.yaml/pnpm-lock.yaml) mit "not found" bzw.
# broken-link. Beobachtet bei v26.6.1.

# Symlink-Lockfile durch echte Datei ersetzen
if [ -L pnpm-lock.yaml ]; then rm pnpm-lock.yaml; fi
# Sicherung: die committete Datei MUSS existieren und darf die
# angehaengten Keys noch nicht enthalten (YAML verbietet Duplikate).
test -f pnpm-workspace.yaml || { echo "::error::pnpm-workspace.yaml fehlt im Repo"; exit 1; }
if grep -qE '^(packages|onlyBuiltDependencies|linkWorkspacePackages|preferWorkspacePackages|autoInstallPeers|strictPeerDependencies):' pnpm-workspace.yaml; then
  echo "::error::pnpm-workspace.yaml traegt bereits einen der angehaengten Keys (packages/linkWorkspacePackages/…) oder das seit pnpm 11 ungueltige onlyBuiltDependencies: — dieses Skript wuerde doppelte YAML-Keys erzeugen. Skript und Repo-Datei abgleichen."
  exit 1
fi
# Build-Freigaben: Die Repo-Datei fuehrt `allowBuilds:` (pnpm 11+, panary/panary-core#1535)
# mit better-sqlite3 als einzigem `true`. Das Image baut zusaetzlich @swc/core, esbuild und
# nx — die Werte werden an Ort und Stelle umgestellt, ein zweiter `allowBuilds:`-Block waere
# ein doppelter YAML-Key. Fehlt eine Zeile, bricht das Skript ab statt still weniger zu bauen.
for pkg in '@swc/core' 'esbuild' 'nx'; do
  grep -qxF "  '${pkg}': false" pnpm-workspace.yaml || {
    echo "::error::allowBuilds-Eintrag '${pkg}': false fehlt in pnpm-workspace.yaml — Skript und Repo-Datei abgleichen."
    exit 1
  }
  sed -i.bak "s|^  '${pkg}': false\$|  '${pkg}': true|" pnpm-workspace.yaml && rm -f pnpm-workspace.yaml.bak
done
cat >> pnpm-workspace.yaml <<'EOF'

# --- vom CI angehaengt (tools/docker/prepare-edge-context.sh) ---
packages:
  - 'apps/*'
  - 'libs/domains/*'
  # libs/shared selbst ist das @panary/shared-Parent-Paket (Option A);
  # ohne diesen Eintrag ist es kein Workspace-Member und pnpm versucht,
  # den @panary/shared-Peer der Domain-Parents von registry.npmjs.org
  # zu fetchen → ERR_PNPM_FETCH_404 (so geschehen bei v26.7.5).
  - 'libs/shared'
  - 'libs/shared/*'
# Workspace-Linking — sonst zieht pnpm @panary/* aus npm.pkg.github.com
# (ERR_PNPM_FETCH_401 ohne Auth-Token). Seit pnpm 11 liest pnpm diese Keys
# nur noch hier, nicht mehr aus .npmrc (panary/panary-core#1535).
linkWorkspacePackages: deep
preferWorkspacePackages: true
autoInstallPeers: true
strictPeerDependencies: false
EOF
# .npmrc leeren: Die Repo-Datei setzt die @panary-Registry, im Image soll
# pnpm @panary/* aber ausschliesslich aus dem Workspace nehmen.
printf '# vom CI geleert (tools/docker/prepare-edge-context.sh)\n' > .npmrc
# Echte Lockfile generieren (Inhalt landet via COPY im Image und wird
# darin von `pnpm install` konsumiert).
#
# --config.minimumReleaseAge=0 haengt die 7-Tage-Karenz NUR fuer diesen
# Schritt aus. Grund: das committete Lockfile ist fuer den
# Single-Package-Importer-Satz aufgeloest; die `packages:`-Globs oben
# bringen ~46 zusaetzliche Importer mit, wodurch pnpm Teile des Baums
# neu aufloest und dabei die bereits gepinnten Versionen erneut prueft.
# Jede Lockfile-Version, die juenger als 7 Tage ist (typisch direkt nach
# einem Dependabot-Bump), liesse den Build sonst mit
# ERR_PNPM_NO_MATURE_MATCHING_VERSION scheitern — gemessen am 2026-07-22
# waren das 8+ Pakete (autoprefixer, enhanced-resolve, @parcel/watcher-*).
# Die Karenz ist ein Gate fuer den EINTRITT neuer Versionen (lokales
# `pnpm add/update`, Dependabot-PRs via ci.yml), nicht fuer den Konsum
# eines bereits gereviewten Lockfiles. blockExoticSubdeps und
# trustPolicy bleiben hier aktiv.
pnpm install --lockfile-only --config.minimumReleaseAge=0
