#!/bin/bash
# ============================================================
# Panary Edge Server — Docker Build & Push
#
# Nutzung:
#   ./tools/docker/build-edge.sh                    # Lokale Architektur
#   ./tools/docker/build-edge.sh --platform amd64   # Gezielt für amd64
#   ./tools/docker/build-edge.sh --push             # Multi-Plattform + Push
#   ./tools/docker/build-edge.sh --tag 2026.3.1     # Eigener Tag
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="ghcr.io/panary/panary-edge"
TAG="latest"
PUSH=false
PLATFORM=""

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
      shift 2
      ;;
    *)
      # Erstes Argument ohne Flag = Tag (Rückwärtskompatibilität)
      TAG="$1"
      shift
      ;;
  esac
done

echo "=== Panary Edge Server Build ==="
echo "Image:   $IMAGE_NAME:$TAG"
echo "Context: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# .dockerignore aus tools/docker/ ins Root kopieren (temporär)
cp tools/docker/.dockerignore .dockerignore.tmp
trap 'rm -f .dockerignore.tmp' EXIT

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

if [ "$PUSH" = false ]; then
  echo ""
  echo "Lokal testen:"
  echo "  docker run -d -p 3030:3030 -v panary-data:/app/data $IMAGE_NAME:$TAG"
  echo ""
  echo "Weitere Optionen:"
  echo "  --platform amd64    Gezielt für Intel/AMD bauen"
  echo "  --platform arm64    Gezielt für ARM bauen"
  echo "  --push              Multi-Plattform bauen + pushen"
  echo "  --tag 2026.3.1      Eigenen Tag setzen"
fi
