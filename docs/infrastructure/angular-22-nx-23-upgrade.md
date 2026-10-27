---
type: Guide
title: Angular 22 und Nx 23 — was das Upgrade geändert hat und was bewusst gleich blieb
description: Versionsstand nach panary/panary-core#129 (Angular 22.2.3, Nx 23.3.0, Vite 8, ng-packagr 22), die verhaltensgleich gehaltenen v22-Defaults (Change Detection, HttpClient, Router, Safe Navigation), die nicht übernommenen TS-6-Migrationen von Nx und der Breaking Change für Konsumenten der @panary/*-Pakete.
tags: [infra, angular, nx, vite, tooling, breaking-change]
status: stable
generated: { by: claude-code/opus-5-5, at: 2026-10-28T00:30:00Z }
sources:
  - { id: core-129, resource: 'https://github.com/panary/panary-core/issues/129', title: 'core#129' }
  - { id: core-1168, resource: 'https://github.com/panary/panary-core/pull/1168', title: 'core#1168 (Vorarbeit OnPush)' }
---

# Angular 22 und Nx 23 — was das Upgrade geändert hat und was bewusst gleich blieb

## Versionsstand

| Paket | vorher | jetzt | Anmerkung |
| --- | --- | --- | --- |
| `@angular/*` | 21.2.25 | 22.2.3 | 22.2.4 lag am 2026-10-27 noch in der Karenz (`minimumReleaseAge` 7 Tage) |
| `nx`, `@nx/*` | 22.7.12 | 23.3.0 | 23.3.1 erst ab 2026-10-30 reif; Nx 24 bringt für Angular nichts über 23 hinaus |
| `vite` | 7.3.7 | 8.3.4 | `@angular/build@22` braucht Vite 8 |
| `ng-packagr` | 21.2.7 | 22.2.4 | |
| `angular-eslint` | 21.4.0 | 22.6.0 | |
| `ngx-echarts` / `angularx-qrcode` | 21 | 22 | Peer `@angular/core >=22` |
| `rollup` | transitiv | `^4.64.12` (devDependency) | Vite 8 bündelt mit Rolldown und bringt Rollup nicht mehr mit; die Domain-Libs bauen weiter mit `@nx/rollup` |
| `typescript` | ~6.0 | ~6.0 | Angular 22 peert `>=6.0 <6.1`, siehe [TypeScript-7-Migration](typescript-7-migration.md) |
| `vitest` | 4 | 4 | Vitest 5 erst nach Prüfung von nrwl/nx#37051 |

⚠️ **Der Security-Override `"vite"` in `package.json` → `pnpm.overrides` zwingt jede Vite-Instanz auf seine Range**,
auch die von `@angular/build`. Er stand auf `^7.3.7` (#789) und steht jetzt auf `^8.3.4`. Wer ihn später für ein
Advisory hebt, darf die Major nicht unter die von `@angular/build` drücken.

## v22-Defaults, die verhaltensgleich gehalten sind

Ziel war unveränderte Funktion. Deshalb ist jeder geänderte Default dort, wo er greift, auf den v21-Wert festgesetzt:

- **Change Detection:** Komponenten ohne `changeDetection` fallen in v22 auf `OnPush`. Die 14 betroffenen
  Komponenten (alle unter `libs/domains/*/feature-pos-*`) tragen seit #1168 explizit `OnPush`; sie lesen ihren
  Template-Zustand über Signals. `ChangeDetectionStrategy.Eager` kommt nirgends vor.
- **HttpClient:** v22 nutzt per Default `fetch`. pos-client, admin-client und die Shell-Lib setzen `withXhr()`,
  setup-client nutzte schon `withFetch()`.
- **Router:** `paramsInheritanceStrategy` ist in v22 per Default `'always'`. Alle `provideRouter` setzen
  `'emptyOnly'`. Wer auf `'always'` umstellt, prüft vorher jede Kind-Route, die `ActivatedRoute.params` liest,
  und im admin-client zusätzlich die Inputs über `withComponentInputBinding()`.
- **Safe Navigation:** `a?.b` liefert in v22 `undefined` statt `null`. Die Migration hat 9 Template-Stellen, an
  denen der Unterschied sichtbar wird (Funktionsargument, Vergleich mit `!== undefined`, Pipe), mit
  `$safeNavigationMigration(...)` umhüllt; die neuen Diagnosen `nullishCoalescingNotNullable` und
  `optionalChainNotNullable` sind je Angular-Projekt in `angularCompilerOptions.extendedDiagnostics` unterdrückt.
  Beides ist Übergang, kein Zielzustand.

## Vite 8 in den Vitest-Läufen

Vite 8 transformiert TypeScript mit Oxc statt esbuild. Zwei Fallen, beide im Upgrade-Lauf rot:

- **Decorators:** Oxc senkt nur Legacy-Decorators ab, und nur, wenn die zur Datei nächstgelegene `tsconfig.json`
  `experimentalDecorators: true` setzt. Ohne das bleibt `@Injectable(...)` im Code stehen und Node bricht beim
  Laden mit `SyntaxError: Invalid or unexpected token` ab — ohne Zeilenangabe. esbuild hatte die Decorators
  vorher stillschweigend umgewandelt. Betroffen war `libs/shared/data-access-updater`, und zwar auch für
  fremde Specs, die ihren `UpdateService` importieren (`login.component.spec.ts`). Jede Lib mit Angular-Decorators
  braucht den Schalter in ihrer `tsconfig.json`.
- **Typen von `vite`:** Vite 8 liefert seine Typen nur über `exports`. Unter `moduleResolution: "node"` (die
  CommonJS-Domain-Libs) findet der Typecheck `'vite'` nicht mehr. Die `vite.config.ts` der Libs importieren
  `defineConfig` deshalb aus `vitest/config`, wie die `vitest.config.mts`.
  Der Typ `Plugin`, den `tools/vitest/panary-vitest.ts` aus `vitest/config` bezieht, wird dort trotzdem still
  zu `any` (`skipLibCheck` verschluckt die unaufgelöste Weiterleitung auf `vite`); die Hook-Parameter tragen ihre
  Typen deshalb selbst. Typsicher wird das erst mit `moduleResolution: bundler` in den Domain-Libs.

Die Nx-Migration `__dirname → import.meta.dirname` in den Vitest-Configs ist zurückgenommen: Die Configs liegen im
`tsconfig.spec.json` der CommonJS-Libs, und dort ist `import.meta` ein Typfehler (TS1343). Vite meldet `__dirname`
als inkompatibel mit dem künftigen `configLoader: 'native'` — das ist eine Warnung, kein Fehler, und betrifft erst
einen späteren Vite-Major.

## Nicht übernommene Nx-Migrationen

Nx 23 bringt Migrationen für den Umstieg auf TypeScript 6: `ignoreDeprecations: "6.0"` in jeder Projekt-tsconfig,
dazu `esModuleInterop: false`, `types: ["*"]` und `noUncheckedSideEffectImports: false` in `tsconfig.base.json`.
Das Repo läuft schon seit vor dem Upgrade unter TS 6.0.3, `ignoreDeprecations` steht einmal in `tsconfig.base.json`.
Die Zusätze hätten die TS-6-Defaults, gegen die heute gebaut wird, zurückgedreht — `esModuleInterop: false`
ändert den Emit von CJS-Default-Importen. Sie sind deshalb zurückgenommen.

Ohne Befund blieben die fünf KI-Prompts der Migration (Vite 8, Vitest 3/4, ESLint-Flat-Config, `ban-types`):
keine `.eslintrc*`, kein `ban-types`, kein `rollupOptions`, keine Pool- oder `deps`-Optionen in Vitest-Configs.

## Breaking Change für Konsumenten der `@panary/*`-Pakete

Die `@angular/*`-Peers der veröffentlichten Pakete stehen auf `^22.0.0` (vorher `^21.0.0`). Die Angular-Libs
werden partiell mit Angular 22 kompiliert und laufen in einem Angular-21-Host nicht.

**Vorher:** `panary-cloud` (Angular 21) konnte jede `@panary/*`-Version konsumieren.
**Nachher:** Ab dem ersten Core-Release nach #129 setzt der Pin-Bump in cloud Angular 22 voraus.
**Update-Pfad:** panary/panary-cloud#116 hebt cloud auf Angular 22 und zieht dabei den `@panary/*`-Pin nach.
Bis dahin bleibt cloud auf der letzten Core-Version vor dem Upgrade.

## Gemessen am 2026-10-27

Fundstellen der übrigen v22-Breaking-Changes: Shadow-CSS-Polyfills und Legacy-Shadow-Selektoren 0 (8 grep-Treffer,
alle TS-Generics bzw. `>>>`-Shifts), `ViewEncapsulation.ShadowDom` 0, Event-Attribut-Bindings 0, `<script>` in
Templates 0, `Validators.min/max` 0, Spec-Hosts ohne `changeDetection` 0. `::ng-deep` steht fünfmal und bleibt in
v22 unterstützt.

## Offen

- `$safeNavigationMigration` auflösen und die unterdrückten Diagnosen wieder einschalten — je Stelle entscheiden,
  ob `undefined` statt `null` dort einen Unterschied macht.
- Signal Forms: panary/panary-core#1017.
