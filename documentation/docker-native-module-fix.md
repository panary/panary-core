---
title: Docker-Build-Fix — Native Module für Cross-Platform-Deployment
date: 2026-04-07
category: infrastructure
domains: [api-edge]
status: aktiv
---

# Docker-Build-Fix: Native Module (macOS ARM → Linux x64)

## Problem

Beim Deployment der `api-edge`-Applikation von macOS (Apple Silicon / arm64) auf einen Linux-x64-Server schlug der Container-Start fehl. Die Ursache: das native Node-Modul `sqlite3` enthält plattformspezifische C++-Binaries, die nicht zwischen Architekturen/Betriebssystemen übertragen werden können.

Zusätzlich gab es einen **glibc/musl-Mismatch** im Dockerfile:
- **Build-Stage:** `node:22-slim` (Debian, glibc)
- **Runtime-Stage:** `node:22-alpine` (Alpine, musl)

Native Module, die im Build-Stage gegen glibc kompiliert werden, sind mit musl (Alpine) inkompatibel.

## Analyse: Native Module im Projekt

| Modul | Version | Typ | Risiko |
|---|---|---|---|
| **sqlite3** | ^5.1.7 | C++ Native (node-gyp, prebuild-install) | Hoch |
| bcryptjs | 3.0.3 | Pure JavaScript | Keines |
| bson | 7.2.0 | Pure JavaScript | Keines |

Alle anderen Abhängigkeiten sind reines JavaScript. Nur `sqlite3` erfordert native Kompilierung.

## Durchgeführte Änderungen

### 1. `tools/docker/Dockerfile.edge`

**Build-Stage:**
- Basis-Image von `node:22-slim` auf `node:22-bookworm-slim` geändert (expliziterer Name, gleiche Plattform)
- Build-Tools `python3`, `make`, `g++` installiert — Fallback für `sqlite3`-Kompilierung, falls Prebuilds für die Zielarchitektur fehlen

**Runtime-Stage:**
- `node:22-alpine` (musl) durch `node:22-bookworm-slim` (glibc) ersetzt
- Beide Stages nutzen jetzt dieselbe C-Library (glibc), womit native Binaries kompatibel sind
- Healthcheck-Installation von `apk add` auf `apt-get install` umgestellt

### 2. `package.json`

- `engines.node` Feld ergänzt: `>=22.0.0` — dokumentiert die Mindestanforderung passend zum Docker-Image

### 3. `.dockerignore` (keine Änderung nötig)

Enthielt bereits: `node_modules/`, `dist/`, `.git/`, `*.log`, `.env`, `.env.*`

## Image-Größe

Das Runtime-Image wird durch den Wechsel von Alpine auf Bookworm-Slim etwas größer (~+30-50 MB), weil Debian-Basis-Images mehr System-Libraries enthalten. Der Trade-off ist:
- **Alpine:** ~50 MB Basis, aber musl-Inkompatibilität mit glibc-nativen Modulen
- **Bookworm-Slim:** ~80 MB Basis, volle glibc-Kompatibilität, zuverlässigere Prebuilds

## Verifizierung

```bash
# Lokaler Build
cd panary-core
pnpm docker:build -- --no-bump

# Oder manuell
cp tools/docker/.dockerignore .dockerignore
docker build -f tools/docker/Dockerfile.edge -t panary-edge:test .
rm .dockerignore

# Container starten
mkdir -p data
docker run --rm -p 3030:3030 -v "$(pwd)/data":/app/data panary-edge:test

# Healthcheck
curl http://localhost:3030/health

# Gezielt für linux/amd64 bauen (von macOS ARM)
docker buildx build --platform linux/amd64 \
  -f tools/docker/Dockerfile.edge -t panary-edge:test --load .
```

## Migration: sqlite3 → better-sqlite3 (abgeschlossen)

Die Migration wurde durchgeführt. Änderungen:

1. **Dependency-Swap:** `sqlite3@^5.1.7` → `better-sqlite3@^11.0.0`
2. **Knex-Client:** `"client": "sqlite3"` → `"client": "better-sqlite3"` in `config/default.json`
3. **Connection-Format:** `"connection": "path"` (String) → `"connection": { "filename": "path" }` (Objekt, von better-sqlite3 erwartet)
4. **Pfad-Auflösung:** `sqlite.ts` und `knexfile.ts` auf Objekt-Format angepasst
5. **Build-Scripts:** `pnpm.onlyBuiltDependencies` in `package.json` für better-sqlite3 freigeschaltet
6. **Legacy-Skript:** `scripts/migrate-legacy-data.ts` Client-String angepasst

Keine Änderungen nötig an: Migrationen (21 Dateien), Services (16 Dateien), Hooks, Service-Factory.
