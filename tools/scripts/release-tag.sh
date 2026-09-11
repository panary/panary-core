#!/usr/bin/env bash
#
# release-tag.sh — Automatischer Versionsbump + Release-Tag(s) erstellen
#
# Format: YY.MM.INDEX (z.B. 26.4.1, 26.4.2, 26.5.1)
# Die Version wird automatisch via bump-version.mjs berechnet.
#
# Verwendung:
#   pnpm release                # Edge + POS gemeinsam (eine Version, beide Tags)
#   pnpm release:edge           # Nur Edge-Server
#   pnpm release:pos-client            # Nur POS-App
#
#   ./tools/scripts/release-tag.sh --push              # Edge + POS
#   ./tools/scripts/release-tag.sh --type edge --push  # Nur Edge
#   ./tools/scripts/release-tag.sh --type pos-client --push   # Nur POS
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
LICENSE="$REPO_ROOT/LICENSE"
TYPE="all"
PUSH=false

# Argumente parsen
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)  PUSH=true;  shift ;;
    --type)  TYPE="$2";  shift 2 ;;
    --help|-h)
      echo "Verwendung: $0 [--type all|edge|pos] [--push]"
      echo ""
      echo "  --type all    Edge + POS gemeinsam (eine Version, beide Tags) [Standard]"
      echo "  --type edge   Nur Edge-Server Release (Tag: v...)"
      echo "  --type pos    Nur POS-App Release (Tag: pos-v...)"
      echo "  --push        Tags direkt pushen (startet CI-Pipelines)"
      exit 0
      ;;
    *) shift ;;
  esac
done

if [[ ! -f "$LICENSE" ]]; then
  echo "Fehler: LICENSE-Datei nicht gefunden: $LICENSE"
  exit 1
fi

# Version automatisch hochzaehlen
echo "→ Version automatisch anheben..."
VERSION=$(node "$REPO_ROOT/tools/scripts/bump-version.mjs")
echo "→ Neue Version: $VERSION"

# Tags bestimmen
TAGS=()
case "$TYPE" in
  edge) TAGS+=("v$VERSION") ;;
  pos-client)  TAGS+=("pos-v$VERSION") ;;
  all)  TAGS+=("v$VERSION" "pos-v$VERSION") ;;
esac

# Datumsberechnung fuer LICENSE
TODAY=$(date +%Y-%m-%d)
CHANGE_YEAR=$(($(date +%Y) + 4))
CHANGE_DATE="${CHANGE_YEAR}-$(date +%m-%d)"
CURRENT_YEAR=$(date +%Y)

echo ""
echo "  Version:       $VERSION"
echo "  Tags:          ${TAGS[*]}"
echo "  Datum:         $TODAY"
echo "  Change Date:   $CHANGE_DATE (4 Jahre)"
echo ""

# Die LICENSE pflegt bump-version.mjs mit (Change Date + Copyright-Jahr) — hier
# bewusst kein zweites sed. Seit #242 bumpt bump-version.mjs auch die
# publishable Lib-Manifeste; der frueher noetige zweite Release-Pfad
# (`nx release version` von Hand) entfaellt damit.
# $CHANGE_DATE/$CURRENT_YEAR bleiben fuer die Anzeige und die Commit-Message.

# Geaenderte Dateien committen
git add "$REPO_ROOT/package.json"
git add "$REPO_ROOT/apps/api-edge/package.json"
if [ -f "$REPO_ROOT/apps/pos-client/src-tauri/tauri.conf.json" ]; then
  git add "$REPO_ROOT/apps/pos-client/src-tauri/tauri.conf.json"
fi
if ! git diff --quiet "$LICENSE"; then
  git add "$LICENSE"
fi

# Die publishable Lib-Manifeste mitnehmen. Ohne diesen Schritt haette der Bump
# oben keine Wirkung: Der Release-Commit enthielte die Libs nicht, der Tag zeigte
# auf einen Stand mit alten Lib-Versionen, und `publish-libraries.yml` liefe in
# genau das Gate, das #242 eingezogen hat.
#
# Die Liste kommt aus dem Skript statt aus einem Glob: `libs/*/package.json`
# wuerde die privaten Subpackages (`*-domain-internal`) mitnehmen und ein
# kuenftiges publishable Paket ausserhalb von `libs/` uebersehen.
PUBLISHABLE_MANIFESTS=$(node "$REPO_ROOT/tools/scripts/publishable-manifests.mjs" --list)
if [ -z "$PUBLISHABLE_MANIFESTS" ]; then
  echo "Fehler: kein publishable Lib-Manifest gefunden — Release abgebrochen." >&2
  exit 1
fi
while IFS= read -r MANIFEST; do
  if [ -n "$MANIFEST" ]; then
    git -C "$REPO_ROOT" add "$MANIFEST"
  fi
done <<< "$PUBLISHABLE_MANIFESTS"

# Gegenprobe vor dem Commit: Tragen wirklich alle publishable Manifeste die neue
# Version? Billiger als der CI-Gate-Lauf und faengt den Fall, in dem der Bump
# teilweise durchlief (z. B. weil eine Manifest-Datei kein Top-Level-"version"
# hatte und der Schreibvorgang mittendrin abbrach).
node "$REPO_ROOT/tools/scripts/publishable-manifests.mjs" --check "$VERSION"

if git diff --cached --quiet; then
  echo "Keine Aenderungen zu committen."
else
  git commit -m "chore(release): v$VERSION — BSL Change Date $CHANGE_DATE"
  echo "Commit: $(git log --oneline -1)"
fi

# Tags erstellen
for TAG in "${TAGS[@]}"; do
  git tag -a "$TAG" -m "Release $TAG"
done
echo "Tags:   ${TAGS[*]}"

# Optional pushen
if [ "$PUSH" = true ]; then
  echo "Pushe Commit + Tags..."
  git push --quiet origin HEAD
  for TAG in "${TAGS[@]}"; do
    git push --quiet origin "$TAG"
  done

  echo ""
  echo "=== Release v$VERSION erfolgreich ==="
  echo ""
  case "$TYPE" in
    edge)
      echo "  Edge:   build-edge-docker.yml → ghcr.io/panary/panary-edge:$VERSION"
      ;;
    pos-client)
      echo "  POS:    release-pos.yml → GitHub Release pos-v$VERSION"
      ;;
    all)
      echo "  Edge:   build-edge-docker.yml → ghcr.io/panary/panary-edge:$VERSION"
      echo "  POS:    release-pos.yml → GitHub Release pos-v$VERSION"
      ;;
  esac
  echo ""
  echo "  CI-Status: https://github.com/panary/panary-core/actions"
  echo ""
else
  echo ""
  echo "=== Tags erstellt (lokal) ==="
  echo ""
  echo "  Zum Pushen (startet CI-Pipelines):"
  echo "  git push origin HEAD && git push origin ${TAGS[*]}"
  echo ""
fi
