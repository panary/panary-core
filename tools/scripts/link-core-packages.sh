#!/usr/bin/env bash
# ============================================================
# link-core-packages.sh
# ============================================================
# Erzeugt `node_modules/@panary/<name>`-Symlinks zu den lokalen libs.
#
# Hintergrund: Im Workbench-Setup (_WORKBENCH_PANARY/) löst der pnpm-Workspace
# `@panary/*`-Importe über node_modules-Links auf. Standalone (CI / Publish)
# existiert dieser Workspace nicht, also fehlen die Links — `@nx/js:tsc` (z. B.
# shared-backend) findet dann `@panary/users/domain` nicht (TS2307), weil der
# Executor die tsconfig-`paths`-Overrides nicht honoriert. Dieses Skript
# repliziert die Workspace-Links, sodass Standalone-Builds wie im Workbench
# auflösen.
#
# Idempotent (ln -sfn). Aus dem panary-core-Repo-Root ausführen.
# ============================================================
set -euo pipefail

mkdir -p node_modules/@panary

while IFS= read -r pj; do
  name=$(node -e "try{process.stdout.write(require('./$pj').name||'')}catch(e){}")
  case "$name" in
    @panary/*)
      sub=${name#@panary/}
      dir=$(dirname "$pj")
      ln -sfn "../../$dir" "node_modules/@panary/$sub"
      echo "  @panary/$sub -> $dir"
      ;;
  esac
# Nur Eltern-Pakete (@panary/<name>); Subpakete (domain/, aggregator/,
# data-access/, feature*/) tragen `-internal`-Namen und werden vom
# @panary/*-Filter ohnehin übersprungen — der Pfad-Filter ist nur Optimierung.
done < <(find libs -maxdepth 3 -name package.json \
  | grep -vE '/(node_modules|dist)/')
