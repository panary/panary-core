#!/usr/bin/env bash
# Installs gh, osv-scanner and gitleaks for local security scanning.
#
# Usage:  bash scripts/install-security-tools.sh
#
# macOS:  Uses Homebrew (https://brew.sh).
# Linux:  Prints binary download instructions for each tool.

set -euo pipefail

REQUIRED_TOOLS=(gh osv-scanner gitleaks)

have() { command -v "$1" >/dev/null 2>&1; }

print_versions() {
  echo
  echo "Installierte Tool-Versionen:"
  have gh           && echo "  gh:          $(gh --version | head -1)"
  have osv-scanner  && echo "  osv-scanner: $(osv-scanner --version 2>&1 | head -1)"
  have gitleaks     && echo "  gitleaks:    $(gitleaks version 2>&1 | head -1)"
}

install_macos() {
  if ! have brew; then
    echo "Homebrew ist auf macOS erforderlich. Installation: https://brew.sh"
    exit 1
  fi
  local missing=()
  for tool in "${REQUIRED_TOOLS[@]}"; do
    have "$tool" || missing+=("$tool")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    echo "Alle Tools sind bereits installiert."
  else
    echo "Installation via Homebrew: ${missing[*]}"
    brew install "${missing[@]}"
  fi
}

install_linux() {
  cat <<'EOS'
Linux-Installation (manuell):

  gh:           https://github.com/cli/cli/blob/trunk/docs/install_linux.md
  osv-scanner:  https://google.github.io/osv-scanner/installation/
  gitleaks:     https://github.com/gitleaks/gitleaks#installing

Fuehre die jeweiligen Schritte aus und starte dieses Skript erneut.
EOS
  exit 0
}

case "$(uname -s)" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)      echo "Nicht unterstuetztes Betriebssystem: $(uname -s)"; exit 1 ;;
esac

print_versions

cat <<'EOS'

Naechste Schritte:
  1. gh auth login -s repo,security_events
     (benoetigt fuer Dependabot-Alerts via API)
  2. pnpm install
     (zieht lefthook + aktiviert pre-commit/pre-push Hooks via prepare)
  3. pnpm security:scan
     (lokale Scans: osv-scanner + gitleaks)
  4. pnpm security:report
     (zusaetzlich GitHub-Alerts via API -> Markdown-Report unter .security/)
EOS
