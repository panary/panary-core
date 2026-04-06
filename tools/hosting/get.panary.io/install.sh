#!/bin/bash
# ============================================================
# Panary Edge Server — Installations-Skript
#
# Richtet den Edge Server auf einem Zielsystem ein.
# Erstellt Verzeichnis, .env, docker-compose.yml und startet den Container.
#
# Nutzung:
#   curl -sL http://get.panary.io/install.sh | bash
#   bash install.sh --port 3030 --dir /opt/panary --tag latest
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
EOF

chmod 600 "$ENV_FILE"
echo -e "${GREEN}✓${NC} .env geschrieben (chmod 600)"

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
# ============================================================
services:
  panary-edge:
    image: ghcr.io/panary/panary-edge:${PANARY_TAG:-latest}
    container_name: panary-edge
    ports:
      - "${PANARY_PORT:-3030}:3030"
    volumes:
      - ./data:/app/data
      - edge-tmp:/tmp
    environment:
      - NODE_ENV=production
      - FEATHERS_SECRET=${FEATHERS_SECRET}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3030/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    labels:
      - "com.centurylinklabs.watchtower.scope=panary"
    networks:
      - panary-internal
    # --- Hardening ---
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
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
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: "0.25"

networks:
  panary-internal:
    driver: bridge
    internal: false

volumes:
  edge-tmp:
COMPOSEOF

echo -e "${GREEN}✓${NC} docker-compose.yml geschrieben"

# ============================================================
# 5. Bestehenden Container stoppen (Update-Szenario)
# ============================================================
if docker ps -a --format '{{.Names}}' | grep -q "^panary-edge$"; then
  echo -e "${BLUE}→ Bestehender Container gefunden — wird aktualisiert...${NC}"
  cd "$INSTALL_DIR"
  docker compose down 2>/dev/null || true
fi

# ============================================================
# 6. Image pullen + Container starten
# ============================================================
echo -e "${BLUE}→ Image pullen: ${IMAGE}:${TAG}${NC}"
cd "$INSTALL_DIR"
docker compose pull

echo -e "${BLUE}→ Container starten...${NC}"
docker compose up -d

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
