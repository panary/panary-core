#!/bin/bash
# ============================================================
# Panary Edge Server — Installations-Skript
#
# Richtet den Edge Server auf einem Zielsystem ein.
# Erstellt Verzeichnis, .env, docker-compose.yml und startet den Container.
#
# Nutzung:
#   curl -sL https://get.panary.cloud/install.sh | sudo bash
#   sudo bash install.sh --port 3030 --dir /opt/panary --tag latest
#
# Nach der Installation:
#   cd /opt/panary
#   docker compose up -d       # Starten
#   docker compose down        # Stoppen
#   docker compose logs -f     # Logs
#   docker compose pull && docker compose up -d   # Manuelles Update
# ============================================================

set -euo pipefail

# --- Farben ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# --- Defaults ---
INSTALL_DIR="/opt/panary"
PORT=3030
TAG="latest"
IMAGE="ghcr.io/panary/panary-edge"

# --- Argumente parsen ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)  PORT="$2";        shift 2 ;;
    --dir)   INSTALL_DIR="$2"; shift 2 ;;
    --tag)   TAG="$2";         shift 2 ;;
    --help|-h)
      echo "Nutzung: install.sh [--port PORT] [--dir VERZEICHNIS] [--tag VERSION]"
      echo ""
      echo "  --port PORT          HTTP-Port (Default: 3030)"
      echo "  --dir  VERZEICHNIS   Installationsverzeichnis (Default: /opt/panary)"
      echo "  --tag  VERSION       Image-Version (Default: latest)"
      exit 0
      ;;
    *) echo -e "${RED}Unbekanntes Argument: $1${NC}"; exit 1 ;;
  esac
done

# ============================================================
# 1. Pre-Flight-Checks
# ============================================================
echo -e "${BOLD}=== Panary Edge Server — Installation ===${NC}"
echo ""

# Docker
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Docker ist nicht installiert.${NC}"
  echo "Installation: https://docs.docker.com/engine/install/"
  exit 1
fi
echo -e "${GREEN}✓${NC} Docker gefunden: $(docker --version | head -1)"

# Docker Compose (v2 als Plugin)
if ! docker compose version &> /dev/null; then
  echo -e "${RED}Docker Compose ist nicht verfuegbar.${NC}"
  echo "Docker Compose v2 ist seit Docker Engine 23+ integriert."
  echo "Installation: https://docs.docker.com/compose/install/"
  exit 1
fi
echo -e "${GREEN}✓${NC} Docker Compose gefunden: $(docker compose version --short)"

# --- Registry-Vorabpruefung ---------------------------------------------------
# Hintergrund (2026-07-27, Zweitinstallation cpc-buero): Der Pull scheiterte mit
#   denied: denied
# obwohl das GHCR-Paket oeffentlich ist. Ursache ist NICHT die Sichtbarkeit,
# sondern der Client: sobald in der Docker-Config ein (abgelaufener) Login fuer
# ghcr.io liegt, schickt Docker diesen Token mit — und GHCR antwortet dann mit
# `denied`, statt auf den anonymen Pfad zurueckzufallen. Ohne jede Credential
# laeuft derselbe Pull durch.
#
# Die Probe geht bewusst an der Docker-Config VORBEI (reines curl gegen die
# Registry-API) und beantwortet damit genau die Frage, die im Fehlerfall zaehlt:
# liegt es am Paket/Netz — oder am lokalen Login?
REPO="${IMAGE#ghcr.io/}"
REGISTRY_CODE="skipped"
GHCR_CRED_FILES=""

# Docker-Config des Users, der spaeter tatsaechlich pullt (siehe `su` weiter
# unten), plus root — je nachdem wie das Skript aufgerufen wurde, greift die eine
# oder die andere.
find_ghcr_logins() {
  local user home cfg
  for user in "${SUDO_USER:-$(whoami)}" root; do
    # Fehlschlag hier ist harmlos (unbekannter User, kein getent) — darf aber
    # unter `set -e` nicht den ganzen Installer abbrechen.
    home="$(getent passwd "$user" 2>/dev/null | cut -d: -f6)" || home=""
    [ -n "$home" ] || continue
    cfg="${home}/.docker/config.json"
    [ -f "$cfg" ] || continue
    case " ${GHCR_CRED_FILES} " in *" ${cfg} "*) continue ;; esac
    if grep -q '"ghcr\.io"' "$cfg" 2>/dev/null; then
      GHCR_CRED_FILES="${GHCR_CRED_FILES}${cfg} "
    fi
  done
}

# Gibt den HTTP-Status des Manifest-Requests zurueck ("000" = keine Verbindung).
probe_registry() {
  local token code
  token="$(curl -fsS --max-time 10 \
    "https://ghcr.io/token?scope=repository:${REPO}:pull&service=ghcr.io" 2>/dev/null \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || { echo "000"; return 0; }
  [ -n "$token" ] || { echo "000"; return 0; }
  code="$(curl -sS -I -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: Bearer ${token}" \
    -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/${REPO}/manifests/${TAG}" 2>/dev/null)" || code="000"
  echo "${code:-000}"
}

find_ghcr_logins

if ! command -v curl &> /dev/null; then
  echo -e "${YELLOW}⚠${NC} curl nicht gefunden — Registry-Vorabpruefung uebersprungen."
else
  REGISTRY_CODE="$(probe_registry)"
  case "$REGISTRY_CODE" in
    200)
      echo -e "${GREEN}✓${NC} Image oeffentlich erreichbar: ${IMAGE}:${TAG} (kein GitHub-Token noetig)"
      ;;
    404)
      echo -e "${RED}Image-Tag existiert nicht: ${IMAGE}:${TAG}${NC}"
      echo "Verfuegbare Tags: https://github.com/panary/panary-core/pkgs/container/panary-edge"
      exit 1
      ;;
    401|403)
      if [ -n "$GHCR_CRED_FILES" ]; then
        echo -e "${YELLOW}⚠${NC} Anonymer Zugriff auf ${IMAGE}:${TAG} verweigert (HTTP ${REGISTRY_CODE})."
        echo -e "  Es existiert ein ghcr.io-Login — der Pull laeuft darueber. Weiter."
      else
        echo -e "${RED}Kein anonymer Zugriff auf ${IMAGE}:${TAG} (HTTP ${REGISTRY_CODE}).${NC}"
        echo "Das Paket ist derzeit nicht oeffentlich. Vor der Installation anmelden:"
        echo "  echo <GITHUB_TOKEN> | docker login ghcr.io -u <github-user> --password-stdin"
        exit 1
      fi
      ;;
    *)
      echo -e "${YELLOW}⚠${NC} Registry nicht erreichbar (HTTP ${REGISTRY_CODE}) — Proxy/DNS/Firewall?"
      echo -e "  Installation laeuft weiter; der Pull kann scheitern."
      ;;
  esac
fi

if [ -n "$GHCR_CRED_FILES" ] && [ "$REGISTRY_CODE" = "200" ]; then
  echo -e "${YELLOW}⚠${NC} Gespeicherter ghcr.io-Login gefunden:"
  for cfg in $GHCR_CRED_FILES; do echo "    ${cfg}"; done
  echo -e "  Das Image ist oeffentlich — der Login wird nicht gebraucht und fuehrt,"
  echo -e "  falls abgelaufen, zu \"denied: denied\". Im Fehlerfall: ${BOLD}docker logout ghcr.io${NC}"
fi

# Port pruefen
if command -v ss &> /dev/null; then
  if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    echo -e "${YELLOW}⚠ Port ${PORT} ist bereits belegt. Der Container wird trotzdem konfiguriert.${NC}"
  fi
elif command -v lsof &> /dev/null; then
  if lsof -i ":${PORT}" -sTCP:LISTEN &> /dev/null; then
    echo -e "${YELLOW}⚠ Port ${PORT} ist bereits belegt. Der Container wird trotzdem konfiguriert.${NC}"
  fi
fi

echo ""

# ============================================================
# 2. Installationsverzeichnis
# ============================================================
echo -e "${BLUE}→ Installationsverzeichnis: ${INSTALL_DIR}${NC}"
mkdir -p "${INSTALL_DIR}/data"

REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_GROUP="$(id -gn "$REAL_USER")"

# ============================================================
# 3. .env generieren (nur bei Erstinstallation)
# ============================================================
ENV_FILE="${INSTALL_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  echo -e "${GREEN}✓${NC} Bestehende .env gefunden — Secret wird beibehalten."
  # Port und Tag aktualisieren, Secret beibehalten
  source "$ENV_FILE"
  # Nur ueberschreiben wenn explizit per Argument gesetzt
  FEATHERS_SECRET="${FEATHERS_SECRET}"
else
  echo -e "${BLUE}→ Generiere neues JWT-Secret...${NC}"
  FEATHERS_SECRET=$(openssl rand -base64 32)
fi

cat > "$ENV_FILE" <<EOF
# Panary Edge Server — Konfiguration
# Generiert am $(date -u +"%Y-%m-%dT%H:%M:%SZ")
FEATHERS_SECRET=${FEATHERS_SECRET}
PANARY_PORT=${PORT}
PANARY_TAG=${TAG}
PANARY_UID=$(id -u ${REAL_USER})
PANARY_GID=$(id -g ${REAL_USER})
EOF

chmod 640 "$ENV_FILE"
echo -e "${GREEN}✓${NC} .env geschrieben"

# ============================================================
# 4. docker-compose.yml schreiben
# ============================================================
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"

cat > "$COMPOSE_FILE" <<'COMPOSEOF'
# ============================================================
# Panary Edge Server — Production Deployment
#
# Verwaltet mit:
#   docker compose up -d       # Starten
#   docker compose down        # Stoppen
#   docker compose logs -f     # Logs anzeigen
#   docker compose pull        # Manuelles Image-Update
#
# Watchtower prueft stuendlich auf neue Versionen und
# aktualisiert den Edge-Container automatisch.
#
# Netzwerk: host — zwingend, damit der Hub per mDNS (`_panary._tcp`) im LAN
# gefunden wird. Multicast (224.0.0.251:5353, TTL 1) verlaesst ein Bridge-Netz
# nicht, und der annoncierte A-Record truege die Container-IP statt der LAN-IP.
# Deshalb kein `ports:`-Mapping: der Edge lauscht direkt auf PANARY_PORT.
# ============================================================
services:
  panary-edge:
    image: ghcr.io/panary/panary-edge:${PANARY_TAG:-latest}
    container_name: panary-edge
    user: "${PANARY_UID:-1000}:${PANARY_GID:-1000}"
    network_mode: host
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - FEATHERS_SECRET=${FEATHERS_SECRET}
      # Ohne Port-Mapping muss der Prozess selbst auf dem Zielport lauschen.
      - PORT=${PANARY_PORT:-3030}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:${PANARY_PORT:-3030}/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    labels:
      - "com.centurylinklabs.watchtower.scope=panary"
    # Kein `networks:` — mit network_mode: host waere das ein Konflikt.
    # Watchtower erreicht den Container ohnehin ueber den Docker-Socket.
    # --- Hardening ---
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
        reservations:
          memory: 128M

  watchtower:
    image: containrrr/watchtower
    container_name: panary-watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=3600
      - WATCHTOWER_SCOPE=panary
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.scope=panary"
    networks:
      - panary-internal
    # --- Hardening ---
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: "0.25"

networks:
  panary-internal:
    driver: bridge
    internal: false
COMPOSEOF

echo -e "${GREEN}✓${NC} docker-compose.yml geschrieben"

# ============================================================
# 5. Berechtigungen setzen — alle Dateien dem aufrufenden User zuweisen
# ============================================================
chown -R "${REAL_USER}:${REAL_GROUP}" "${INSTALL_DIR}"
echo -e "${GREEN}✓${NC} Berechtigungen gesetzt (Besitzer: ${REAL_USER})"

# ============================================================
# 6. Bestehenden Container stoppen (Update-Szenario)
# ============================================================
if docker ps -a --format '{{.Names}}' | grep -q "^panary-edge$"; then
  echo -e "${BLUE}→ Bestehender Container gefunden — wird aktualisiert...${NC}"
  cd "$INSTALL_DIR"
  su "$REAL_USER" -c "docker compose down" 2>/dev/null || true
fi

# ============================================================
# 6. Image pullen + Container starten
# ============================================================
echo -e "${BLUE}→ Image pullen: ${IMAGE}:${TAG}${NC}"
cd "$INSTALL_DIR"
if ! su "$REAL_USER" -c "cd ${INSTALL_DIR} && docker compose pull"; then
  echo ""
  echo -e "${RED}Image-Pull fehlgeschlagen.${NC}"
  if [ "$REGISTRY_CODE" = "200" ]; then
    # Die Vorabpruefung hat das Manifest anonym gelesen — Paket und Netzwerkweg
    # sind also in Ordnung. Bleibt der lokale Docker-Client als Ursache.
    echo -e "Die Registry liefert ${IMAGE}:${TAG} anonym aus (HTTP 200) — Paket und"
    echo -e "Netzwerk sind in Ordnung. Ursache ist der lokale Docker-Client:"
    echo ""
    echo -e "  ${BOLD}docker logout ghcr.io${NC}          # als ${REAL_USER}"
    echo -e "  ${BOLD}sudo docker logout ghcr.io${NC}     # zusaetzlich als root"
    echo ""
    if [ -n "$GHCR_CRED_FILES" ]; then
      echo -e "Betroffene Config-Dateien:"
      for cfg in $GHCR_CRED_FILES; do echo "    ${cfg}"; done
      echo ""
    fi
    echo -e "Danach dieses Skript einfach erneut ausfuehren (es ist idempotent)."
  else
    echo -e "Registry-Vorabpruefung: HTTP ${REGISTRY_CODE}. Pruefen:"
    echo -e "  • Internetzugang / Proxy / Firewall auf ghcr.io"
    echo -e "  • /etc/docker/daemon.json (Registry-Mirror, Proxy-Eintraege)"
    echo -e "  • docker logout ghcr.io (abgelaufene Credentials)"
  fi
  exit 1
fi

echo -e "${BLUE}→ Container starten...${NC}"
su "$REAL_USER" -c "cd ${INSTALL_DIR} && docker compose up -d"

# ============================================================
# 7. Healthcheck warten
# ============================================================
echo -e "${BLUE}→ Warte auf Healthcheck...${NC}"
HEALTHY=false
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done

echo ""
echo -e "${BOLD}============================================${NC}"

if [ "$HEALTHY" = true ]; then
  echo -e "${GREEN}✓ Panary Edge Server laeuft!${NC}"
else
  echo -e "${YELLOW}⚠ Server startet noch — Setup-Wizard wird beim ersten Aufruf geladen.${NC}"
fi

# IP ermitteln
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "  ${BOLD}Setup-Wizard:${NC}  http://${LOCAL_IP}:${PORT}"
echo -e "  ${BOLD}Admin-Panel:${NC}   http://${LOCAL_IP}:${PORT}/admin"
echo -e "  ${BOLD}Health-Check:${NC}  http://${LOCAL_IP}:${PORT}/health"
echo ""
echo -e "  ${BOLD}Verzeichnis:${NC}   ${INSTALL_DIR}"
echo -e "  ${BOLD}Daten:${NC}         ${INSTALL_DIR}/data"
echo ""
echo -e "  Verwaltung:  cd ${INSTALL_DIR}"
echo -e "               docker compose up -d       ${BLUE}# Starten${NC}"
echo -e "               docker compose down        ${BLUE}# Stoppen${NC}"
echo -e "               docker compose logs -f     ${BLUE}# Logs${NC}"
echo ""
echo -e "${BOLD}============================================${NC}"
