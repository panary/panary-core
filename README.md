<div align="center">
  <img src="libs/shared/common/src/assets/logos/panary_logo_color.svg" alt="Panary Logo" width="280">
  <h3>Offline-First POS & ERP Platform for Food Service</h3>
  <p>
    <strong>Angular 21 &middot; FeathersJS v5 &middot; SQLite &middot; Tauri &middot; Nx Monorepo</strong>
  </p>
</div>

---

Panary Core is a modern, offline-first point-of-sale and ERP platform built for restaurants, bakeries, and food-service businesses. It runs as a native desktop app (via Tauri) or in the browser, with full offline capability through a local SQLite database and optional cloud sync via MongoDB.

## Features

- **Offline-First Architecture** — Local SQLite database ensures the POS works without internet. Cloud sync via MongoDB when connected.
- **Multi-Tenant & Multi-Location** — Built-in tenant isolation with role-based access control across locations.
- **Touch-Optimized POS** — Designed for Sunmi D3 tablets and similar touch-first hardware.
- **Product-First Data Model** — Unified product table handling standard items, modifiers, and bundles.
- **Native Desktop App** — Tauri-based builds for Windows and macOS.
- **Admin Dashboard** — Web-based admin interface for managing products, orders, users, and locations.
- **20+ Domain Libraries** — Orders, products, customers, working times, recipes, devices, and more.
- **Wide Event Logging** — Structured canonical log lines with full business context per request.

## Architecture

```
panary-core/
├── apps/
│   ├── api-edge/          # FeathersJS v5 backend (Koa, SQLite/Knex)
│   ├── pos/               # Angular POS client + Tauri desktop shell
│   ├── admin-client/      # Angular admin web interface
│   └── setup-client/      # Angular onboarding wizard
├── libs/
│   ├── domains/           # 20 domain libraries (schemas, types, business logic)
│   │   ├── orders/        #   Order management
│   │   ├── products/      #   Product catalog (product-first model)
│   │   ├── users/         #   Users, roles, RBAC
│   │   ├── customers/     #   B2C customers
│   │   ├── locations/     #   Multi-location management
│   │   ├── devices/       #   POS device configuration
│   │   ├── working-times/ #   Employee time tracking
│   │   └── ...            #   + 13 more domains
│   ├── shared/            # Common utilities, UI components, theming
│   └── apps/              # App-specific shell libraries
├── tools/
│   ├── docker/            # Dockerfiles & compose for edge deployment
│   ├── generators/        # Custom Nx generator for FeathersJS services
│   └── scripts/           # Versioning & release scripts
└── documentation/         # Service creation & generator guides
```

Domain libraries export via `@panary-core/[domain]/domain`. Apps import from libs — never the other way around.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [pnpm](https://pnpm.io/) v9+
- [Nx](https://nx.dev/) v22+ (installed via `pnpm`)

For Tauri desktop builds:
- [Rust](https://www.rust-lang.org/) toolchain
- Platform-specific dependencies ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Getting Started

```bash
# Install dependencies
pnpm install

# Run database migrations
pnpm db:migrate

# Start POS client + API backend in parallel
pnpm dev
```

The POS client runs at `http://localhost:4200`, the API at `http://localhost:3030`.

### Individual Apps

```bash
# API backend only
nx serve api-edge

# POS client only
nx serve pos

# Admin dashboard
pnpm admin:dev

# Tauri desktop app (dev mode)
pnpm tauri:dev
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21, Tailwind CSS v4, Angular Material |
| Desktop | Tauri 2 (Rust + WebView) |
| Backend | FeathersJS v5, Koa |
| Database (Edge) | SQLite via Knex |
| Database (Cloud) | MongoDB |
| Schemas | TypeBox (`@feathersjs/typebox`) |
| Monorepo | Nx 22, pnpm workspaces |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Logging | Winston (wide events / canonical log lines) |

## Security Model

Every external API request passes through three mandatory hooks:

1. **`authenticate('jwt')`** — Validates the token and populates `context.params.user`
2. **`authorize()`** — RBAC check against the central permissions matrix
3. **`multiTenancy()`** — Stamps and filters data by `tenantId` / `locationId`

A post-execution `ensureTenantIsolation()` hook validates that no data leaks across tenant boundaries.

> [!IMPORTANT]
> Every new FeathersJS service **must** register all three hooks in `around.all`.

## Useful Commands

```bash
pnpm dev                        # POS + API parallel
pnpm db:migrate                 # Run Knex migrations
pnpm db:create <name>           # Create a new migration

nx test <project>               # Run tests (Vitest)
nx lint <project>               # Run linter
nx run-many -t test             # Test all projects
nx affected -t lint,test,build  # CI: affected projects only

pnpm tauri:build                # Build Tauri desktop app
pnpm docker:build               # Build Docker image (edge)
pnpm admin:build                # Production build (admin)
```

## Docker (Edge Server)

### Voraussetzung: Multi-Platform Builder

`pnpm docker:release` baut für `linux/amd64` und `linux/arm64` gleichzeitig. Der Standard-Driver von Docker Desktop unterstuetzt das nicht. Einmalig einen `buildx`-Builder erstellen:

```bash
docker buildx create --name panary-builder --use --driver docker-container
```

Der Builder bleibt persistent und wird bei zukuenftigen Builds automatisch verwendet.

### Befehle

```bash
# Lokaler Build (nur aktuelle Architektur, kein Push)
pnpm docker:build

# Multi-Platform Build + Push in die Registry
pnpm docker:release

# Lokalen Container starten (z.B. zum Testen)
mkdir -p data
docker run -d -p 3030:3030 -v "$(pwd)/data":/app/data --name panary-edge ghcr.io/panary/panary-edge:latest
```

### Weitere Optionen

```bash
pnpm docker:build -- --platform amd64    # Gezielt fuer Intel/AMD
pnpm docker:build -- --platform arm64    # Gezielt fuer ARM
pnpm docker:build -- --tag 26.4.1        # Fester Tag (kein Auto-Bump)
pnpm docker:build -- --no-bump           # Aktuellen Tag verwenden
```

A `docker-compose.edge.yml` is provided in `tools/docker/` for production deployments with persistent SQLite storage.

## Releases

Panary Core uses calendar versioning: `YY.MM.INDEX` (z.B. `26.4.3`).

```bash
pnpm release                    # Edge + POS gemeinsam (eine Version, beide Pipelines)
pnpm release:edge               # Nur Edge-Server (Docker-Image)
pnpm release:pos                # Nur POS-App (Tauri/Windows)
```

Ein `pnpm release` bumpt die Version einmal, erstellt beide Tags (`v26.4.X` + `pos-v26.4.X`) und pusht. Die CI baut parallel:

- **`v*`-Tag** → `build-edge-docker.yml` → Docker-Image auf GHCR
- **`pos-v*`-Tag** → `release-pos-windows.yml` → GitHub Release mit Windows-Installer

### Installation auf Zielsystemen

```bash
curl -sL http://get.panary.io/install.sh | sudo bash
```

Das Skript richtet Docker Compose mit Edge-Server + Watchtower (Auto-Updates) ein.
