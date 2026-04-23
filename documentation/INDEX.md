# Dokumentationsindex — Panary Core

## Guides

- [Nx-Generator-Nutzungsanleitung](generator-usage-guide.md) — 2025-02-13 — Schritt-für-Schritt: Nx-Generatoren für Domains, Services, Komponenten
- [Service-Erstellungsanleitung](service-creation-guide.md) — 2025-02-13 — Anleitung: Neuen FeathersJS-Service anlegen (Schema → Service → Hooks)
- [ensureIndexes — Entwicklungs-Guide](ensure-indexes-guide.md) — 2026-04-24 — DB-agnostische Index-Deklaration (SQLite/MongoDB) via Factory
- [Tauri Update-Server-Einrichtung](tauri-update-server-einrichtung.md) — 2025-03-28 — Einrichtung des Auto-Update-Servers für Tauri POS

## Architektur

- [M2 — DB-Agnostik-Refactor](m2-db-agnostik-refactor.md) — 2026-04-24 — Hybrid-Adapter, ensureIndexes, Schema-First, getJsonFieldHooks

## Sicherheit

- [Sicherheitshärtung — Sensible Daten](sensitive-data-hardening.md) — 2026-04-07 — POS-PIN bcrypt, API-Key SHA-256, verifyPin Custom-Methode

## Infrastruktur

- [Docker-Build-Fix — Native Module](docker-native-module-fix.md) — 2026-04-07 — glibc/musl-Mismatch behoben, Build-Tools für sqlite3, bookworm-slim

## Integrationen

- [Print-Server-API](print-server-api.md) — 2025-03-28 — MQTT-basierte Print-Server-Schnittstelle (Protokoll, Befehle, Konfiguration)
