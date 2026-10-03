#!/bin/bash
# ============================================================
# Smoke-Test des gebauten Edge-Images (panary/panary-core#505).
#
# Ein gruener Build belegt nur, dass das Image entsteht — nicht, dass der
# Container bootet. Dieses Skript startet das Image zweimal:
#   1. mit minimaler panary.config.json → PRODUCTION MODE: Migrationen,
#      Service-Registrierung, /health und die Admin-SPA unter /admin/
#   2. ohne Config → SETUP MODE: /api/system-info meldet "unconfigured"
# und bricht mit Exit 1 ab, sobald eine Erwartung nicht haelt. Dann stehen
# die Container-Logs im Ausgabe-Log.
#
# Nutzung: tools/docker/smoke-edge-image.sh <image> <erwartete-version>
# Lokal:   docker build -f tools/docker/Dockerfile.edge --build-arg PANARY_VERSION=smoke -t panary-edge:smoke .
#          bash tools/docker/smoke-edge-image.sh panary-edge:smoke smoke
# Braucht docker, curl, jq, openssl.
# ============================================================

set -euo pipefail

IMAGE="${1:?Image fehlt (z. B. panary-edge:pr-check)}"
EXPECTED_VERSION="${2:?erwartete Version fehlt}"
# Gemessen bootet der Edge in wenigen Sekunden; der Deckel faengt einen
# langsamen Runner ab, ohne einen haengenden Boot ewig laufen zu lassen.
BOOT_TIMEOUT_S="${BOOT_TIMEOUT_S:-90}"

PREFIX="edge-smoke-$$"
DATA_DIR="$(mktemp -d)"
FAILED=0

cleanup() {
  for c in "$PREFIX-prod" "$PREFIX-setup"; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() {
  echo "::error::Smoke-Test: $1"
  FAILED=1
}

show_logs() {
  echo "----- docker logs $1 -----"
  docker logs "$1" 2>&1 | tail -80 || true
  echo "----- Ende docker logs $1 -----"
}

# Startet einen Container und gibt den Host-Port aus. Der Port wird von
# Docker frei gewaehlt, damit parallele Laeufe und ein lokaler Edge auf 3030
# nicht kollidieren.
start() {
  local name="$1" data="$2"
  # Secret je Lauf neu: assertFeathersSecret verlangt >= 32 Zeichen und lehnt
  # den Platzhalter aus dem Repo ab.
  docker run -d --name "$name" \
    -e FEATHERS_SECRET="$(openssl rand -base64 32)" \
    -v "$data:/app/data" \
    -p 127.0.0.1::3030 \
    "$IMAGE" >/dev/null
  docker port "$name" 3030/tcp | head -1 | sed 's/.*://'
}

# Wartet, bis $url mit 200 antwortet, und gibt die Antwort aus. Stirbt der
# Container vorher, wird nicht weiter gewartet.
wait_for() {
  local name="$1" url="$2" waited=0 body
  while [ "$waited" -lt "$BOOT_TIMEOUT_S" ]; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]; then
      echo "Container $name laeuft nicht mehr (Exit $(docker inspect -f '{{.State.ExitCode}}' "$name"))." >&2
      return 1
    fi
    if body="$(curl -fsS --max-time 5 "$url" 2>/dev/null)"; then
      echo "$waited" >&2
      printf '%s' "$body"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "Keine Antwort von $url nach ${BOOT_TIMEOUT_S} s." >&2
  return 1
}

# --- 1. Produktionsmodus -----------------------------------------------------
PROD_DATA="$DATA_DIR/prod"
mkdir -p "$PROD_DATA"
# Leere Config genuegt: Ihre blosse Existenz waehlt den PRODUCTION MODE
# (apps/api-edge/src/main.ts), alle Werte haben Defaults.
echo '{}' > "$PROD_DATA/panary.config.json"
# Das Image laeuft als root, der Bind-Mount muss trotzdem fuer jeden
# beschreibbar sein, falls sich das kuenftig aendert.
chmod -R a+rwX "$DATA_DIR"

port="$(start "$PREFIX-prod" "$PROD_DATA")"
echo "Produktionsmodus: $PREFIX-prod auf 127.0.0.1:$port"
if health="$(wait_for "$PREFIX-prod" "http://127.0.0.1:$port/health" 2>"$DATA_DIR/wait.txt")"; then
  echo "/health nach $(cat "$DATA_DIR/wait.txt") s: $(jq -c '{status,version,systemMode,database}' <<<"$health")"
  [ "$(jq -r .status <<<"$health")" = ok ] || fail "/health.status ist nicht 'ok'"
  got="$(jq -r .version <<<"$health")"
  [ "$got" = "$EXPECTED_VERSION" ] || fail "/health.version ist '$got', erwartet '$EXPECTED_VERSION' (PANARY_VERSION-Build-Argument)"
  [ "$(jq -r '.database.type' <<<"$health")" = sqlite ] || fail "/health.database.type ist nicht 'sqlite' — laeuft der Produktionsmodus?"

  # Admin-SPA: faellt sie in der Runtime-Stage weg, antwortet /admin/ nicht mit HTML.
  admin_type="$(curl -sS -o "$DATA_DIR/admin.html" -w '%{http_code} %{content_type}' "http://127.0.0.1:$port/admin/")"
  case "$admin_type" in
    200\ text/html*) grep -q '<app-root' "$DATA_DIR/admin.html" || fail "/admin/ liefert HTML ohne <app-root>" ;;
    *) fail "/admin/ antwortet '$admin_type', erwartet 200 text/html" ;;
  esac
  echo "/admin/: $admin_type"
else
  fail "Produktionsmodus bootet nicht: $(tail -1 "$DATA_DIR/wait.txt")"
fi
[ "$FAILED" = 0 ] || show_logs "$PREFIX-prod"

# --- 2. Setup-Modus ----------------------------------------------------------
SETUP_DATA="$DATA_DIR/setup"
mkdir -p "$SETUP_DATA"
chmod a+rwX "$SETUP_DATA"
before="$FAILED"
port="$(start "$PREFIX-setup" "$SETUP_DATA")"
echo "Setup-Modus: $PREFIX-setup auf 127.0.0.1:$port"
if info="$(wait_for "$PREFIX-setup" "http://127.0.0.1:$port/api/system-info" 2>"$DATA_DIR/wait.txt")"; then
  echo "/api/system-info nach $(cat "$DATA_DIR/wait.txt") s: $(jq -c '{status}' <<<"$info")"
  [ "$(jq -r .status <<<"$info")" = unconfigured ] || fail "/api/system-info.status ist nicht 'unconfigured'"
else
  fail "Setup-Modus bootet nicht: $(tail -1 "$DATA_DIR/wait.txt")"
fi
[ "$FAILED" = "$before" ] || show_logs "$PREFIX-setup"

if [ "$FAILED" != 0 ]; then
  echo "Smoke-Test fehlgeschlagen."
  exit 1
fi
echo "Smoke-Test bestanden: Produktions- und Setup-Modus booten, Version $EXPECTED_VERSION."
