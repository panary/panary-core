#!/usr/bin/env bash
#
# release-tag.sh — Automatischer Versionsbump + Release-Tag erstellen
#
# Format: YY.MM.INDEX (z.B. 26.4.1, 26.4.2, 26.5.1)
# Die Version wird automatisch via bump-version.mjs berechnet.
#
# Verwendung (empfohlen):
#   pnpm release:edge                              # Edge-Server Release
#   pnpm release:pos                               # POS-Windows Release
#
#   ./tools/scripts/release-tag.sh                # Edge, auto-bump, ohne Push
#   ./tools/scripts/release-tag.sh --type pos     # POS, auto-bump, ohne Push
#   ./tools/scripts/release-tag.sh --push         # Edge + sofort pushen → CI startet
#   ./tools/scripts/release-tag.sh --type pos --push
#
# Rückwärtskompatibel (manueller Tag, kein Bump):
#   ./tools/scripts/release-tag.sh v26.4.1 --push
#   ./tools/scripts/release-tag.sh pos-v26.4.1 --push
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
LICENSE="$REPO_ROOT/LICENSE"
TYPE="edge"
PUSH=false
MANUAL_TAG=""

# Argumente parsen
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=true
      shift
      ;;
    --type)
      TYPE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Verwendung: $0 [--type edge|pos] [--push] [manueller-tag]"
      echo ""
      echo "  --type edge   Edge-Server Release (Tag-Prefix: v)        [Standard]"
      echo "  --type pos    POS-Windows Release (Tag-Prefix: pos-v)"
      echo "  --push        Tag direkt pushen (startet CI-Pipeline)"
      echo ""
      echo "  Manueller Tag (kein Auto-Bump):"
      echo "    $0 v26.4.1 --push"
      echo "    $0 pos-v26.4.1 --push"
      exit 0
      ;;
    v*|pos-v*)
      # Rückwärtskompatibel: manueller Tag als Positionsargument
      MANUAL_TAG="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ ! -f "$LICENSE" ]]; then
  echo "❌ LICENSE-Datei nicht gefunden: $LICENSE"
  exit 1
fi

# Version und Tag ermitteln
if [ -n "$MANUAL_TAG" ]; then
  # Manueller Tag — keine Versionsdateien verändern
  FULL_TAG="$MANUAL_TAG"
  # Version aus Tag extrahieren (v26.4.1 → 26.4.1, pos-v26.4.1 → 26.4.1)
  VERSION="${FULL_TAG#pos-}"
  VERSION="${VERSION#v}"
  echo "📌 Manueller Tag: $FULL_TAG (Version: $VERSION)"
else
  # Automatisch hochzählen via bump-version.mjs
  echo "→ Version automatisch anheben..."
  VERSION=$(node "$REPO_ROOT/tools/scripts/bump-version.mjs")
  case "$TYPE" in
    pos) FULL_TAG="pos-v$VERSION" ;;
    *)   FULL_TAG="v$VERSION" ;;
  esac
  echo "→ Neue Version: $VERSION → Tag: $FULL_TAG"
fi

# Datumsberechnung für LICENSE
TODAY=$(date +%Y-%m-%d)
CHANGE_YEAR=$(($(date +%Y) + 4))
CHANGE_DATE="${CHANGE_YEAR}-$(date +%m-%d)"
CURRENT_YEAR=$(date +%Y)

echo ""
echo "📋 Release-Tag:  $FULL_TAG"
echo "📅 Heute:        $TODAY"
echo "🔄 Change Date:  $CHANGE_DATE (4 Jahre ab heute)"
echo ""

# LICENSE aktualisieren: Change Date
sed -i.bak -E "s/^Change Date:.*$/Change Date:          $CHANGE_DATE (Four years from the release date)/" "$LICENSE"

# LICENSE aktualisieren: Copyright-Endjahr
sed -i.bak -E "s/\(c\) ([0-9]{4})-[0-9]{4}/\(c\) \1-$CURRENT_YEAR/" "$LICENSE"
rm -f "$LICENSE.bak"

# Geänderte Dateien committen
STAGED_FILES=()

# Versionsdateien (nur wenn kein manueller Tag, d.h. bump-version.mjs wurde aufgerufen)
if [ -z "$MANUAL_TAG" ]; then
  git add "$REPO_ROOT/package.json"
  STAGED_FILES+=("package.json")

  if [ -f "$REPO_ROOT/apps/pos/src-tauri/tauri.conf.json" ]; then
    git add "$REPO_ROOT/apps/pos/src-tauri/tauri.conf.json"
    STAGED_FILES+=("tauri.conf.json")
  fi
fi

# LICENSE immer committen wenn geändert
if ! git diff --quiet "$LICENSE"; then
  git add "$LICENSE"
  STAGED_FILES+=("LICENSE")
fi

if git diff --cached --quiet; then
  echo "✅ Keine Änderungen zu committen"
else
  git commit -m "chore(release): $FULL_TAG — BSL Change Date $CHANGE_DATE"
  echo "✏️  Commit erstellt: $(git log --oneline -1)"
fi

# Annotiertes Tag erstellen
git tag -a "$FULL_TAG" -m "Release $FULL_TAG"
echo "🏷️  Tag erstellt: $FULL_TAG"

# Optional pushen → löst CI-Pipeline aus
if [ "$PUSH" = true ]; then
  git push origin HEAD
  git push origin "$FULL_TAG"
  echo ""
  echo "🚀 Gepusht → CI-Pipeline läuft jetzt"

  case "$TYPE" in
    pos)
      echo "   Pipeline: release-pos-windows.yml (Tag: $FULL_TAG)"
      ;;
    *)
      echo "   Pipeline: build-edge-docker.yml (Tag: $FULL_TAG)"
      echo "   Image:    ghcr.io/panary/panary-edge:$VERSION"
      ;;
  esac
else
  echo ""
  echo "Zum Pushen (startet CI-Pipeline):"
  echo "  git push origin HEAD && git push origin $FULL_TAG"
fi
