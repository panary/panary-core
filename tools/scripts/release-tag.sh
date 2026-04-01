#!/usr/bin/env bash
#
# release-tag.sh — Erstellt ein Release-Tag und aktualisiert automatisch
# das BSL-1.1 Change Date in der LICENSE-Datei.
#
# Verwendung:
#   ./tools/scripts/release-tag.sh v2026.3.1          # Edge-Server-Release
#   ./tools/scripts/release-tag.sh pos-v2026.3.1      # POS-Windows-Release
#   ./tools/scripts/release-tag.sh v2026.3.1 --push   # Tag erstellen + sofort pushen
#
set -euo pipefail

TAG="${1:?Verwendung: $0 <tag> [--push]}"
PUSH="${2:-}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
LICENSE="$REPO_ROOT/LICENSE"

if [[ ! -f "$LICENSE" ]]; then
  echo "❌ LICENSE-Datei nicht gefunden: $LICENSE"
  exit 1
fi

# Change Date berechnen: heute + 4 Jahre
TODAY=$(date +%Y-%m-%d)
CHANGE_YEAR=$(($(date +%Y) + 4))
CHANGE_DATE="${CHANGE_YEAR}-$(date +%m-%d)"

# Copyright-Jahr aktualisieren (Endjahr = aktuelles Jahr)
CURRENT_YEAR=$(date +%Y)

echo "📋 Release-Tag:  $TAG"
echo "📅 Heute:        $TODAY"
echo "🔄 Change Date:  $CHANGE_DATE (4 Jahre ab heute)"
echo ""

# LICENSE aktualisieren: Change Date
sed -i.bak -E "s/^Change Date:.*$/Change Date:          $CHANGE_DATE (Four years from the release date)/" "$LICENSE"

# LICENSE aktualisieren: Copyright-Endjahr
sed -i.bak -E "s/\(c\) ([0-9]{4})-[0-9]{4}/\(c\) \1-$CURRENT_YEAR/" "$LICENSE"

# Backup entfernen
rm -f "$LICENSE.bak"

# Prüfen ob sich etwas geändert hat
if git diff --quiet "$LICENSE"; then
  echo "✅ LICENSE war bereits aktuell"
else
  echo "✏️  LICENSE aktualisiert:"
  git diff --stat "$LICENSE"
  echo ""

  # Änderung committen
  git add "$LICENSE"
  git commit -m "chore(license): Change Date auf $CHANGE_DATE aktualisiert für Release $TAG"
  echo ""
fi

# Tag erstellen
git tag -a "$TAG" -m "Release $TAG"
echo "🏷️  Tag erstellt: $TAG"

# Optional pushen
if [[ "$PUSH" == "--push" ]]; then
  git push origin HEAD
  git push origin "$TAG"
  echo "🚀 Gepusht: Commit + Tag $TAG"
else
  echo ""
  echo "Zum Pushen:"
  echo "  git push origin HEAD && git push origin $TAG"
fi
