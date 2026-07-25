# Architektur

Architektur-Konzepte ohne Entscheidungscharakter — Systemaufbau, Muster, technische Beschreibungen
(`type: Architecture`).

* [Cloud-Pairing-Wizard — Edge-Seite (M7.2)](cloud-pairing-wizard.md) - Vierstufiger Cloud-Pairing-Wizard auf Edge-Seite mit Preflight, Bootstrap-Runner, drei Initial-Sync-Richtungen, Konflikt-Review und Sync-Scheduler-Modi.
* [Cloud-Status-Badge — Sync-Alter + Token-Ablauf (POS + Admin)](cloud-status-badge.md) - Historische Badge-Lösung für Sync-Alter- und Token-Ablauf-Warnungen in POS und Admin, abgelöst durch das priorisierte Einzel-Banner-System.
* [Cloud-Status-Banner — priorisiertes Einzel-Banner-System (POS + Admin)](cloud-status-banner-priorisierung.md) - Zentrales gewichtetes Regelwerk zeigt in POS und Admin immer nur den höchstpriorisierten Cloud-Status-Banner; Wurzelursachen unterdrücken nachgelagerte Symptome.
* [Data-Access Auto-Load — Opt-out via DATA_ACCESS_AUTO_LOAD + ensureLoaded()](data-access-auto-load-opt-out.md) - Opt-out des Eager-Loadings der Data-Access-Services per DATA_ACCESS_AUTO_LOAD-Token plus idempotentes ensureLoaded() für On-Demand-Konsumenten.
* [M2 — DB-Agnostik-Refactor (SQLite Edge ↔ MongoDB Cloud)](m2-db-agnostik-refactor.md) - Refactor aller Edge-Services auf das Hybrid-Adapter-Pattern mit ensureIndexes, getJsonFieldHooks und Schema-First, damit derselbe Service-Code auf SQLite und MongoDB läuft.
* [PosButton-View-Model — POS-Dialog mutiert keine ProductService-Cache-Objekte mehr](pos-button-viewmodel.md) - Typisiertes PosButton-View-Model mit toPosButton-Shallow-Copies verhindert, dass der POS-Bestelldialog geteilte ProductService-Cache-Objekte mutiert.
* [Sync-Pull-Apply — geteiltes Modul (gebatcht, entdoppelt, getestet)](sync-apply-shared-modul.md) - Geteiltes Modul sync-apply.ts als Single Source für Cloud-zu-Edge-Pull-Applies mit gebatchtem Existenz-Check, Insert-Modus beim Bootstrap und Fokus-Tests.
* [Sync-Run-Details — Per-Record-Nachvollziehbarkeit in der Sync-Historie](sync-run-details.md) - Neues details-JSON-Feld am sync-run-Event persistiert pro Sync-Vorgang die betroffenen Records für Per-Record-Nachvollziehbarkeit in der Admin-Sync-Historie.
