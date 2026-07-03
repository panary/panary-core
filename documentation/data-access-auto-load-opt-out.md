---
title: Data-Access Auto-Load — Opt-out via DATA_ACCESS_AUTO_LOAD + ensureLoaded()
date: 2026-07-03
category: Architektur
domains: [products, users, orders, shared]
status: implementiert
---

# Data-Access Auto-Load — Opt-out via `DATA_ACCESS_AUTO_LOAD` + `ensureLoaded()`

## Problem

`ProductService`, `UserService` und `OrderService` laden ihren kompletten Datenbestand über einen
Konstruktor-`effect()`, sobald **irgendeine** Komponente den Service injiziert und die Verbindung
authentifiziert ist (Products: `count` + `ceil(N/250)` sequenzielle `find`-Pages). Für den POS-Client
ist dieses Eager-Loading gewollt (Offline-First) — für andere Konsumenten (z. B. Admin-Apps, die nur
einen einzelnen Datensatz brauchen) ist es ungefragter Voll-Load.

Zusätzlich liefen die `loadDocuments()`-Aufrufe direkt im Effect-Tracking-Scope: Signal-Reads vor dem
ersten `await` (`#isLoading`, `connectionState` im Offline-Kurzschluss der `BaseService.find`) wurden
mitgetrackt → Extra-Re-Runs und latentes Endlos-Loop-Risiko (siehe `.claude/rules/angular.md` §2.1).

## Entscheidung

1. **Opt-out per InjectionToken statt Subklassen:** `DATA_ACCESS_AUTO_LOAD`
   (`@panary/shared/data-access`, Default `true` via root-Factory). Die `BaseService` injiziert das
   Token als `protected autoLoadEnabled`; Services mit Konstruktor-Lade-Effect registrieren den Effect
   nur, wenn das Flag `true` ist. Begründung: kein Service-Duplikat pro App, EIN app-weiter Schalter,
   und weitere Auto-Load-Services (product-groups, discounts, locations, …) können das Flag später mit
   einer Zeile adoptieren.

   ```typescript
   // appConfig einer App ohne Eager-Bedarf
   { provide: DATA_ACCESS_AUTO_LOAD, useValue: false }
   ```

2. **`ensureLoaded()` als On-Demand-Alternative:** idempotenter Load (lädt nur, solange `isLoaded()`
   false ist) mit Dedup paralleler Aufrufe auf EINEN laufenden Load. Gemeinsame Semantik im Helper
   `createEnsureLoaded(isLoaded, load)` (`@panary/shared/data-access`, Specs:
   `ensure-loaded.spec.ts`). Alle drei Services exponieren `ensureLoaded: () => Promise<void>` und
   `isLoaded: Signal<boolean>`.

3. **untracked-Härtung der Lade-Effects** (angular.md §2.1): getrackte Reads (`isAuthenticated`,
   `#isLoaded`, `activeLocation`) explizit am Effect-Anfang, `loadDocuments()` in `untracked()`.

## Konsequenzen

- **POS-Client unverändert:** Default `true` → Eager-Load wie bisher, kein Provider nötig.
- `UserService`/`OrderService` fangen Load-Fehler jetzt intern (`console.error`), statt unhandled
  rejections zu produzieren; `isLoaded` bleibt bei Fehler false → `ensureLoaded()` kann retryen.
  Der `UserService`-Effect lädt bewusst weiter bei JEDEM Auth-Wechsel neu (Reconnect-Refresh) —
  `isLoaded` gated dort nur `ensureLoaded()`, nicht den Effect.
- `OrderService.loadDocuments()` gibt jetzt `Promise<void>` zurück (Aggregat der drei `find`-Chains);
  bestehende Fire-and-forget-Aufrufer sind unverändert.
- Randfall: läuft der Auto-Load gerade (`ProductService.#isLoading`), resolvt ein paralleles
  `ensureLoaded()` früh — relevant nur bei `DATA_ACCESS_AUTO_LOAD = true`, wo `ensureLoaded()`
  ohnehin nicht gebraucht wird.
- **panary-cloud** kann Token + `ensureLoaded()` erst nach Core-Publish + Pin-Bump nutzen
  (Option A, Registry-Pin) — der Cloud-Opt-out ist Folgearbeit.
