# Guides

Anleitungen, Runbooks, Setup- und Smoke-Test-Beschreibungen (`type: Guide`).

* [Cargo-Advisories triagieren — vom osv-scanner-Befund zur Entscheidung](cargo-advisory-triage.md) - Reihenfolge für osv-scanner-Befunde auf apps/pos-client/src-tauri/Cargo.lock — zuerst prüfen, ob die Crate überhaupt kompiliert wird, dann Bump über den Parent, Ignore erst zuletzt.
* [ensureIndexes — Entwicklungs-Guide](ensure-indexes-guide.md) - Entwicklungs-Guide zur ensureIndexes()-Factory als einzige zulässige Methode, DB-Indexe in Service-Modulen idempotent für SQLite und MongoDB zu deklarieren.
* [Nx-Generator-Nutzungsanleitung](generator-usage-guide.md) - Anleitung zur Ausführung des FeathersJS-Service-Generators mit Optionen, Beispielen und Übersicht der erzeugten Artefakte.
* [Offline-Cache (Connect-Tier) — Smoke-Test-Anleitung](offline-cache-smoke-test.md) - Penible manuelle Smoke-Test-Anleitung für Offline-Cache und Outbox des POS-Clients: Bootstrap, Offline-Bestellung, Reconnect-Replay, Delta-Sync und Reload-Persistenz.
* [Service-Erstellungsanleitung](service-creation-guide.md) - Schritt-für-Schritt-Anleitung zum Anlegen eines neuen FeathersJS-Service mit Domain-Schema, Validatoren, Resolvern und Hooks für SQLite und MongoDB.
* [Test-Target an einer Nx-Lib nachrüsten](lib-vitest-test-target.md) - Anleitung, wie eine Lib ohne `test`-Target eines per Plugin-Inferenz bekommt — inklusive der drei Fallen (Config-Drift, TS5069, fehlender JIT-Compiler) und des TestBed-freien Musters für Angular-Klassen.
* [Zugewiesene POS-Geräte — manuelle Verifikation vor dem Rollout](geraete-zuweisung-verifikation.md) - Acht Prüfschritte am laufenden Terminal, inklusive Umgehungsprobe in den DevTools und der drei Notfallpfade, die eine kaputte Zuweisung unwiderruflich sperren würde.
