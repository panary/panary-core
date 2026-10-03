#!/bin/bash
# ============================================================
# Smoke-Test des gebauten Edge-Images (panary/panary-core#505).
#
# Ein gruener Build belegt nur, dass das Image entsteht — nicht, dass der
# Container bootet. Dieses Skript startet das Image zweimal:
#   1. mit minimaler panary.config.json → PRODUCTION MODE: Migrationen,
#      Service-Registrierung, /health und die Admin-SPA unter /admin/
#   2. ohne Config → SETUP MODE: /api/system-info meldet "unconfigured"
# Jede verfehlte Erwartung wird als ::error:: gemeldet, beide Laeufe laufen
# trotzdem durch, am Ende Exit 1. Bei Fehlschlag stehen die Container-Logs im
# Ausgabe-Log.
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
# Nach dem ersten /health laedt main.ts weitere Teile per import() nach
# (Admin-Check, Geschaeftstag, Print-Server, mDNS) und faengt deren Fehler
# selbst ab. So lange wird gewartet, bevor die Logs auf fehlende Module
# geprueft werden.
SETTLE_S="${SETTLE_S:-8}"

PREFIX="edge-smoke-$$"
DATA_DIR="$(mktemp -d)"
FAILED=0

cleanup() {
  for c in "$PREFIX-prod" "$PREFIX-setup"; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  # Der Container schreibt als root (u. a. logs/ mit 755) — auf einem Runner
  # ohne root raeumt nur ein Container das wieder weg.
  docker run --rm -v "$DATA_DIR:/d" --entrypoint sh "$IMAGE" -c 'rm -rf /d/* /d/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "::error::Smoke-Test: $1"
  FAILED=1
}

# jq ohne Abbruch: Liefert der Endpunkt kein JSON, wird das ein Befund, kein
# stiller Abbruch durch set -e.
jget() {
  jq -r "$1" <<<"$2" 2>/dev/null || echo '<kein JSON>'
}

# Ein zur Laufzeit fehlendes Modul, das main.ts nach dem Boot abfaengt, laesst
# /health gruen. Gezielt danach suchen, nicht nach "level":"error": Ein
# frischer Edge ohne Admin meldet bootstrap.admin_access_missing zu Recht.
check_modules() {
  local name="$1" hits
  hits="$(docker logs "$name" 2>&1 | grep -cE 'MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module' || true)"
  [ "$hits" = 0 ] || fail "$name: $hits Log-Zeile(n) mit fehlendem Modul"
}

show_logs() {
  echo "----- docker logs $1 -----"
  docker logs "$1" 2>&1 | tail -80 || true
  echo "----- Ende docker logs $1 -----"
}

# Startet einen Container und setzt PORT auf den Host-Port. Der Port wird von
# Docker frei gewaehlt, damit parallele Laeufe und ein lokaler Edge auf 3030
# nicht kollidieren. Ohne Kommandosubstitution, damit ein gescheitertes
# `docker run` beim Aufrufer als Rueckgabewert ankommt.
PORT=""
start() {
  local name="$1" data="$2" mapping
  # Secret je Lauf neu: assertFeathersSecret verlangt >= 32 Zeichen und lehnt
  # den Platzhalter aus dem Repo ab.
  docker run -d --name "$name" \
    -e FEATHERS_SECRET="$(openssl rand -base64 32)" \
    -v "$data:/app/data" \
    -p 127.0.0.1::3030 \
    "$IMAGE" >/dev/null || return 1
  mapping="$(docker port "$name" 3030/tcp 2>/dev/null)" || return 1
  PORT="${mapping##*:}"
  PORT="${PORT%%$'\n'*}"
  [ -n "$PORT" ]
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

if ! start "$PREFIX-prod" "$PROD_DATA"; then
  fail "Container $PREFIX-prod startet nicht (Image '$IMAGE' geladen?)"
elif health="$(wait_for "$PREFIX-prod" "http://127.0.0.1:$PORT/health" 2>"$DATA_DIR/wait.txt")"; then
  echo "Produktionsmodus: $PREFIX-prod auf 127.0.0.1:$PORT"
  echo "/health nach $(cat "$DATA_DIR/wait.txt") s: $(jq -c '{status,version,systemMode,database}' <<<"$health" 2>/dev/null || echo '<kein JSON>')"
  [ "$(jget .status "$health")" = ok ] || fail "/health.status ist nicht 'ok'"
  got="$(jget .version "$health")"
  [ "$got" = "$EXPECTED_VERSION" ] || fail "/health.version ist '$got', erwartet '$EXPECTED_VERSION' (PANARY_VERSION-Build-Argument)"
  # systemMode gibt es nur in der /health-Antwort des Produktionsmodus.
  [ "$(jget 'has("systemMode")' "$health")" = true ] || fail "/health hat kein systemMode — antwortet der Produktionsmodus?"

  # Admin-SPA: faellt sie in der Runtime-Stage weg, antwortet /admin/ nicht mit HTML.
  admin_type="$(curl -sS --max-time 10 -o "$DATA_DIR/admin.html" -w '%{http_code} %{content_type}' "http://127.0.0.1:$PORT/admin/")" ||
    admin_type="curl-Fehler $?"
  case "$admin_type" in
    200\ text/html*) grep -q '<app-root' "$DATA_DIR/admin.html" || fail "/admin/ liefert HTML ohne <app-root>" ;;
    *) fail "/admin/ antwortet '$admin_type', erwartet 200 text/html" ;;
  esac
  echo "/admin/: $admin_type"
  sleep "$SETTLE_S"
  check_modules "$PREFIX-prod"
else
  fail "Produktionsmodus bootet nicht: $(tail -1 "$DATA_DIR/wait.txt")"
fi
[ "$FAILED" = 0 ] || show_logs "$PREFIX-prod"

# --- 2. Setup-Modus ----------------------------------------------------------
SETUP_DATA="$DATA_DIR/setup"
mkdir -p "$SETUP_DATA"
chmod a+rwX "$SETUP_DATA"
before="$FAILED"
if ! start "$PREFIX-setup" "$SETUP_DATA"; then
  fail "Container $PREFIX-setup startet nicht (Image '$IMAGE' geladen?)"
elif info="$(wait_for "$PREFIX-setup" "http://127.0.0.1:$PORT/api/system-info" 2>"$DATA_DIR/wait.txt")"; then
  echo "Setup-Modus: $PREFIX-setup auf 127.0.0.1:$PORT"
  echo "/api/system-info nach $(cat "$DATA_DIR/wait.txt") s: $(jget .status "$info")"
  [ "$(jget .status "$info")" = unconfigured ] || fail "/api/system-info.status ist nicht 'unconfigured'"
  check_modules "$PREFIX-setup"
else
  fail "Setup-Modus bootet nicht: $(tail -1 "$DATA_DIR/wait.txt")"
fi
[ "$FAILED" = "$before" ] || show_logs "$PREFIX-setup"

if [ "$FAILED" != 0 ]; then
  echo "Smoke-Test fehlgeschlagen."
  exit 1
fi
echo "Smoke-Test bestanden: Produktions- und Setup-Modus booten, Version $EXPECTED_VERSION."
