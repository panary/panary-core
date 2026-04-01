#!/bin/bash
# ============================================================
# Panary Edge Server — Docker Build & Push
#
# Versionierung: Automatisch via bump-version.mjs (YY.MM.INDEX)
# Die Version wird bei jedem Build ohne explizites --tag hochgezählt.
#
# Nutzung:
#   pnpm docker:build                              # Auto-Bump + lokaler Build
#   pnpm docker:build -- --push                   # Auto-Bump + Multi-Plattform + Push
#   ./tools/docker/build-edge.sh --platform amd64 # Gezielt für amd64
#   ./tools/docker/build-edge.sh --tag 26.4.1     # Fester Tag (kein Auto-Bump)
#   ./tools/docker/build-edge.sh --no-bump        # Aktuellen package.json-Tag verwenden
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="ghcr.io/panary/panary-edge"
TAG=""          # leer = automatisch ermitteln
PUSH=false
PLATFORM=""
AUTO_BUMP=true  # Standard: Version automatisch anheben

# Argumente parsen
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=true
      shift
      ;;
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      AUTO_BUMP=false  # Expliziter Tag → kein Auto-Bump
      shift 2
      ;;
    --no-bump)
      AUTO_BUMP=false  # Aktuellen package.json-Tag verwenden, nicht hochzählen
      shift
      ;;
    *)
      # Erstes Argument ohne Flag = Tag (Rückwärtskompatibilität)
      TAG="$1"
      AUTO_BUMP=false
      shift
      ;;
  esac
done

cd "$PROJECT_ROOT"

# Version ermitteln
if [ "$AUTO_BUMP" = true ]; then
  echo "→ Version automatisch anheben..."
  TAG=$(node "$PROJECT_ROOT/tools/scripts/bump-version.mjs")
  echo "→ Neue Version: $TAG"
elif [ -z "$TAG" ]; then
  # --no-bump ohne --tag: aktuelle Version aus package.json lesen
  TAG=$(node -p "require('./package.json').version")
  echo "→ Aktuelle Version: $TAG (kein Bump)"
fi

echo ""
echo "=== Panary Edge Server Build ==="
echo "Image:   $IMAGE_NAME:$TAG"
echo "Context: $PROJECT_ROOT"

# .dockerignore aus tools/docker/ ins Root kopieren (temporär)
cp tools/docker/.dockerignore .dockerignore
trap 'rm -f .dockerignore' EXIT

if [ "$PUSH" = true ]; then
  # Push = immer Multi-Plattform (amd64 + arm64)
  echo "Mode:    Multi-Plattform Push (linux/amd64 + linux/arm64)"
  echo ""
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -f tools/docker/Dockerfile.edge \
    -t "$IMAGE_NAME:$TAG" \
    -t "$IMAGE_NAME:latest" \
    --push \
    .
elif [ -n "$PLATFORM" ]; then
  # Gezielter Plattform-Build (lokal)
  echo "Mode:    Gezielter Build (linux/$PLATFORM)"
  echo ""
  docker buildx build \
    --platform "linux/$PLATFORM" \
    -f tools/docker/Dockerfile.edge \
    -t "$IMAGE_NAME:$TAG" \
    --load \
    .
else
  # Standard: Lokale Architektur
  echo "Mode:    Lokale Architektur"
  echo ""
  docker build \
    -f tools/docker/Dockerfile.edge \
    -t "$IMAGE_NAME:$TAG" \
    -t "$IMAGE_NAME:latest" \
    .
fi

echo ""
echo "=== Build erfolgreich ==="
echo "Image: $IMAGE_NAME:$TAG"
echo ""
echo "Version $TAG wurde in package.json und tauri.conf.json gespeichert."
echo "Zum Committen und Taggen für ein CI-Release:"
echo "  pnpm release:edge"

if [ "$PUSH" = false ]; then
  echo ""
  echo "Lokal testen (Bind Mount — Daten in ./data/ sichtbar):"
  echo "  mkdir -p data"
  echo "  docker run -d -p 3030:3030 -v \"\$(pwd)/data\":/app/data --name panary-edge $IMAGE_NAME:$TAG"
  echo ""
  echo "Oder via Docker Compose:"
  echo "  docker compose -f tools/docker/docker-compose.edge.yml up -d"
  echo ""
  echo "Weitere Optionen:"
  echo "  --platform amd64    Gezielt für Intel/AMD bauen"
  echo "  --platform arm64    Gezielt für ARM bauen"
  echo "  --push              Multi-Plattform bauen + pushen"
  echo "  --tag 26.4.1        Festen Tag setzen (kein Auto-Bump)"
  echo "  --no-bump           Kein Version-Bump (aktuellen Stand verwenden)"
fi
