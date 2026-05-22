# Dokumentationsindex — Panary Core

## Guides

- [Nx-Generator-Nutzungsanleitung](generator-usage-guide.md) — 2025-02-13 — Schritt-für-Schritt: Nx-Generatoren für Domains, Services, Komponenten
- [Service-Erstellungsanleitung](service-creation-guide.md) — 2025-02-13 — Anleitung: Neuen FeathersJS-Service anlegen (Schema → Service → Hooks)
- [ensureIndexes — Entwicklungs-Guide](ensure-indexes-guide.md) — 2026-04-24 — DB-agnostische Index-Deklaration (SQLite/MongoDB) via Factory
- [Tauri Update-Server-Einrichtung](tauri-update-server-einrichtung.md) — 2025-03-28 — Einrichtung des Auto-Update-Servers für Tauri POS

## Architektur

- [M2 — DB-Agnostik-Refactor](m2-db-agnostik-refactor.md) — 2026-04-24 — Hybrid-Adapter, ensureIndexes, Schema-First, getJsonFieldHooks
- [ADR — Emergency-Override für Drucker-Konfiguration im Edge](emergency-override-adr.md) — 2026-05-14 — Eng begrenzte Notfall-Schreibrechte bei Cloud-Ausfall (≥3 Heartbeat-Fehler ODER >5 min), nur `printSettings`-Patches, eigene `pending-local-overrides`-Tabelle (nicht Sync-Outbox), Reconciliation via `POST /sync-reconcile-overrides` mit Old-Value-Konflikt-Detection
- [Tagesabschluss-Architektur (Edge + Cloud + Aggregator-Lib)](tagesabschluss-architektur.md) — 2026-05-15 — Lifecycle-Maschine (open → closing-requested → closing-aggregating → closed/failed → audited), Mode-Unterscheidung pro Location (orders-only vs pos-cashier), shared `@panary/businessdays/aggregator` als Single Source of Truth für Dashboard-Live + Cloud-Report (Cent-Integer, deterministisch, 57 Fixture-Tests), Sync-Outbox-Vorabprüfung im Edge, lückenlose Z-Bon-Nummer pro Location, KassenSichV-Schema-Reserve
- [Verbrauchs-Explosion (computeCogs / explodeOrderConsumption)](verbrauchs-explosion.md) — 2026-05-22 — Single Source of Truth der Material-Verbrauchsrechnung: proportionaler Faktor `quantity/baseQuantity` (+ Modifier/Menü multiplikativ, direkte Zutaten ohne Faktor); KEINE Einheiten-Umrechnung (`conversionFactor` ist Einkaufs-Referenz, nicht Verbrauch); neue Primitive `explodeOrderConsumption` (ohne Klassifizierungs-Filter, für Stock-Hook wiederverwendbar); Embedded-Snapshot (`recipeReference.recipeIngredients`, RAW) bevorzugt vor externer Map; `onlyOutsideConsumption` (Außer-Haus-only); `unresolvedRecipes` statt stillem 0. Cloud-Konsumenten-Details in `panary-cloud/documentation/warenbewegung-bestandslogik.md`. 51 neue Specs (cogs 39 + snapshot 12)
- [Cloud-Status-Badge — Sync-Alter + Token-Ablauf (POS + Admin)](cloud-status-badge.md) — 2026-05-16 — Plan für proaktive schwebende Top-Center-Badges (gleiche Optik wie die existierenden OFFLINE/RE-PAIRING-Pillen), wenn der letzte erfolgreiche Cloud-Sync zu lange her ist (WARN > 5 min, CRIT > 30 min) oder der Edge-Token bald abläuft (WARN < 24 h, CRIT < 1 h). Schema-Ergänzung `cloud-connection.edgeTokenExpiresAt`, `/health`-Endpoint-Erweiterung, neue Shared-UI-Lib `<lib-cloud-status-badges>`, eingesetzt in POS und Admin-Dashboard. Status: planned
- [Sync-Run-Details — Per-Record-Nachvollziehbarkeit](sync-run-details.md) — 2026-05-21 — Neues `details`-JSON-Feld am `sync-run`-Event (Service + entityId + op + status, gekappt bei 500); Erfassung im Scheduler-Push/Pull; Admin-Popup gruppiert nach Service; Service-Spalte zeigt bei Push „Mehrere (N)" statt „—"; Push mit Rejects → `partial`
- [Geschäftstag — Automatische Rotation (Standalone) + Zeit-Guard](geschaeftstag-auto-rotation.md) — 2026-05-22 — Nightly Rotations-Worker (`business-day-rotation.worker`) ruft `autoEnsureBusinessDay` zeitgesteuert (Default 04:00 lokal), schließt die Lücke „Tag rotiert nur bei Boot/erstem Order"; Zeit-Guard `ensureBusinessDayNotOpenTooLong` verweigert neue Bestellungen ab `maxBusinessDayOpenHours` (Default 24h seit `openedAt`) bei durch aktive Orders blockierter Rotation; neuer Fehlercode `BUSINESS_DAY_OPEN_TOO_LONG` (BD_6003); UTC-Anker-Caveat dokumentiert
- [Geräte-Online-Tracking (Edge) — Echtzeit-Verbindungszählung + Admin-Panel](geraete-online-tracking.md) — 2026-05-22 — Neuer read-only Service `device-connections` zählt verbundene Geräte live aus `app.channel('authenticated').connections`; `lastSeen`-Stamps bei Connect/Disconnect (channels.ts, find→patch wegen `multi:[]`); Admin-Panel: Dashboard-KPI `X/Y` (grün/amber), Sidebar-Menüpunkt `/devices` mit Live-Badge, read-only Geräte-Liste, `DeviceStatusService`-Poll. RBAC OWNER+TECHNICIAN (geteilte Matrix). Spiegelt das Cloud-Feature

## Sicherheit

- [E-Mail-Identität — Edge- & Shared-Schema-Impact](email-identity-edge-impact.md) — 2026-05-22 — Login von `loginname` auf E-Mail; geteiltes Schema (`loginname`/`password` optional, neues `accountId`, `generateLoginname`); Edge bleibt single-tenant/flach (`usernameField: email`, Bootstrap per email); Sync-Projektion + Gates K3/K4. Voller Cloud-ADR in panary-cloud
- [Sicherheitshärtung — Sensible Daten](sensitive-data-hardening.md) — 2026-04-07 — POS-PIN bcrypt, API-Key SHA-256, verifyPin Custom-Methode
- [Tenant-Audit-Events (Edge)](audit-events.md) — 2026-05-06 — Append-only Audit-Trail, Sidecar-Hook zu sync-outbox, SQLite-Trigger fuer Immutability, Cloud-Sync. Phase 2: Audit-Cleanup-Worker (nightly, 90d-Retention nach Cloud-Ack, transaktionaler Trigger-Bypass, Selbst-Audit `AUDIT_CLEANUP`)
- [Schema-Feld-Härtung (Inline-Constraints)](schema-feld-haertung.md) — 2026-05-22 — Feldbezogene Inline-Limits gegen Dokument-Aufblähung über alle Domänen: `password` maxLength 72 (bcrypt), Freitext-`maxLength`, Preis/Mengen `minimum: 0`, Array-`maxItems` (projektweit erstmals), Zeit/`format`-`pattern`, `orderQuery`/`writeOffQuery` → `additionalProperties: false`. Entscheidung: inline (keine zentrale Lib), `Type.Any()` beibehalten (kein Laufzeit-Gewinn ggü. Unknown, bricht aber TS-Konsumenten), `additionalProperties: false` in `Type.Intersect` empirisch sicher. Bewusst offen: Sync-Payloads, Aggregate, signed quantity

## Infrastruktur

- [Docker-Build-Fix — Native Module](docker-native-module-fix.md) — 2026-04-07 — glibc/musl-Mismatch behoben, Build-Tools für sqlite3, bookworm-slim
- [Library-Publishing — @panary/* via GitHub Packages](library-publishing.md) — 2026-05-20 — Nx-Release-basiertes Publishing der 27 publishable Libs nach GitHub Packages, Tag-Trigger `v*`, Release-Ablauf, publishable-Markierung (Eltern-package.json + project.json), Konsum in panary-cloud via Caret-Ranges

## Integrationen

- [Print-Server-API](print-server-api.md) — 2025-03-28 — MQTT-basierte Print-Server-Schnittstelle (Protokoll, Befehle, Konfiguration)
- [Cloud-Pairing-Wizard — Edge-Seite (M7.2)](cloud-pairing-wizard.md) — 2026-05-02 — Custom-Methods (preflight/startBootstrap/syncNow), Bootstrap-Runner mit drei Direction-Modi, Sync-Scheduler in vier Modi, sync_outbox/sync_cursor/sync_conflicts
