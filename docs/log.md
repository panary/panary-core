# Wiki Update Log

## 2026-07-26

* **Creation**: [TypeScript-7-Migration — Status, Blocker & Vorbereitung](infrastructure/typescript-7-migration.md) — TS 7.0 ist GA (2026-07-08), Migration bleibt durch die fehlende TS-API blockiert (Angular/ng-packagr/typescript-eslint brauchen TS 6); als Vorbereitung `baseUrl` aus allen tsconfigs entfernt, verbleibende `moduleResolution: node`-Altlasten und Re-Check-Trigger dokumentiert.

## 2026-07-25

* **Update**: Phase 2 — Migration abgeschlossen: 44 Konzepte aus `/documentation` übernommen (davon 12 ADRs mit Nummerierung), Frontmatter auf OKF-Profil konvertiert, Links umgeschrieben, `/documentation` aufgelöst.
* **Initialization**: OKF-Wiki-Grundstruktur angelegt (Phase 1) — Bereichsordner `adr/`, `architecture/`, `domains/`, `security/`, `guides/`, `infrastructure/`, `integrations/`, `references/` mit Indizes. Migration des Alt-Bestands aus `/documentation` folgt in Phase 2.
