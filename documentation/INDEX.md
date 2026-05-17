# Dokumentationsindex — Panary Core

## Guides

- [Nx-Generator-Nutzungsanleitung](generator-usage-guide.md) — 2025-02-13 — Schritt-für-Schritt: Nx-Generatoren für Domains, Services, Komponenten
- [Service-Erstellungsanleitung](service-creation-guide.md) — 2025-02-13 — Anleitung: Neuen FeathersJS-Service anlegen (Schema → Service → Hooks)
- [ensureIndexes — Entwicklungs-Guide](ensure-indexes-guide.md) — 2026-04-24 — DB-agnostische Index-Deklaration (SQLite/MongoDB) via Factory
- [Tauri Update-Server-Einrichtung](tauri-update-server-einrichtung.md) — 2025-03-28 — Einrichtung des Auto-Update-Servers für Tauri POS

## Architektur

- [M2 — DB-Agnostik-Refactor](m2-db-agnostik-refactor.md) — 2026-04-24 — Hybrid-Adapter, ensureIndexes, Schema-First, getJsonFieldHooks
- [ADR — Emergency-Override für Drucker-Konfiguration im Edge](emergency-override-adr.md) — 2026-05-14 — Eng begrenzte Notfall-Schreibrechte bei Cloud-Ausfall (≥3 Heartbeat-Fehler ODER >5 min), nur `printSettings`-Patches, eigene `pending-local-overrides`-Tabelle (nicht Sync-Outbox), Reconciliation via `POST /sync-reconcile-overrides` mit Old-Value-Konflikt-Detection
- [Tagesabschluss-Architektur (Edge + Cloud + Aggregator-Lib)](tagesabschluss-architektur.md) — 2026-05-15 — Lifecycle-Maschine (open → closing-requested → closing-aggregating → closed/failed → audited), Mode-Unterscheidung pro Location (orders-only vs pos-cashier), shared `@panary-core/businessdays/aggregator` als Single Source of Truth für Dashboard-Live + Cloud-Report (Cent-Integer, deterministisch, 57 Fixture-Tests), Sync-Outbox-Vorabprüfung im Edge, lückenlose Z-Bon-Nummer pro Location, KassenSichV-Schema-Reserve
- [Cloud-Status-Badge — Sync-Alter + Token-Ablauf (POS + Admin)](cloud-status-badge.md) — 2026-05-16 — Plan für proaktive schwebende Top-Center-Badges (gleiche Optik wie die existierenden OFFLINE/RE-PAIRING-Pillen), wenn der letzte erfolgreiche Cloud-Sync zu lange her ist (WARN > 5 min, CRIT > 30 min) oder der Edge-Token bald abläuft (WARN < 24 h, CRIT < 1 h). Schema-Ergänzung `cloud-connection.edgeTokenExpiresAt`, `/health`-Endpoint-Erweiterung, neue Shared-UI-Lib `<lib-cloud-status-badges>`, eingesetzt in POS und Admin-Dashboard. Status: planned

## Sicherheit

- [Sicherheitshärtung — Sensible Daten](sensitive-data-hardening.md) — 2026-04-07 — POS-PIN bcrypt, API-Key SHA-256, verifyPin Custom-Methode
- [Tenant-Audit-Events (Edge)](audit-events.md) — 2026-05-06 — Append-only Audit-Trail, Sidecar-Hook zu sync-outbox, SQLite-Trigger fuer Immutability, Cloud-Sync. Phase 2: Audit-Cleanup-Worker (nightly, 90d-Retention nach Cloud-Ack, transaktionaler Trigger-Bypass, Selbst-Audit `AUDIT_CLEANUP`)

## Infrastruktur

- [Docker-Build-Fix — Native Module](docker-native-module-fix.md) — 2026-04-07 — glibc/musl-Mismatch behoben, Build-Tools für sqlite3, bookworm-slim

## Integrationen

- [Print-Server-API](print-server-api.md) — 2025-03-28 — MQTT-basierte Print-Server-Schnittstelle (Protokoll, Befehle, Konfiguration)
- [Cloud-Pairing-Wizard — Edge-Seite (M7.2)](cloud-pairing-wizard.md) — 2026-05-02 — Custom-Methods (preflight/startBootstrap/syncNow), Bootstrap-Runner mit drei Direction-Modi, Sync-Scheduler in vier Modi, sync_outbox/sync_cursor/sync_conflicts
