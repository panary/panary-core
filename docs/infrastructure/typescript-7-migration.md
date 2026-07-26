---
type: Plan
title: TypeScript-7-Migration — Status, Blocker & Vorbereitung
description: Status der TypeScript-7-Migration (GA 2026-07-08) mit den aktuellen Blockern durch die fehlende TS-API, der umgesetzten tsconfig-Vorbereitung und den Triggern für den Re-Check.
tags: [infra, typescript, tooling]
status: stable
generated: { by: claude-code/fable-5, at: 2026-07-26T09:44:27Z }
stale_after: 2026-11-30
---

# TypeScript-7-Migration — Status, Blocker & Vorbereitung

## Ausgangslage (Stand 2026-07-26)

TypeScript 7.0 ist am **2026-07-08 stabil erschienen** (Abschluss von „Project Corsa": nativer
Go-Port des Compilers, 8–12× schnellere Builds/Typechecks, multithreaded, drop-in `tsc`).
panary-core steht auf `typescript@~6.0.2` — die TS-6-Breaking-Changes (strict-Defaults etc.)
sind bereits verdaut.

## Warum wir NICHT migrieren können (Blocker)

TS 7.0 hat **keine stabile programmatische API**. Alle Tools, die die TS-API einbetten, können
weiterhin nur TS 6.0 nutzen:

| Abhängigkeit | Stand | Problem |
| --- | --- | --- |
| `@angular/compiler-cli@21.2.17` | Peer-Range `>=5.9 <6.1` | `ngtsc`/Template-Type-Checking nutzt die TS-API |
| `ng-packagr` (27 publishable Libs) | Peer `>=5.9 <6.0` | nutzt die TS-API |
| typescript-eslint (via `nx lint`) | — | nutzt die TS-API |
| Angular 22 (2026-06-03) | verlangt ebenfalls TS 6 | kein TS-7-Support |

Die neue API kommt erst mit **TS 7.1 (~Okt 2026)**; Angular-Support ist danach realistisch
(voraussichtlich Angular 23, ~Nov/Dez 2026).

## Umgesetzte Vorbereitung (dieser Commit)

TS 7 **entfernt** die deprecateten Optionen `baseUrl`, `moduleResolution: node`, `target: es5`
und Closure-JSDoc. Als risikoarme Vorbereitung wurde `baseUrl` vollständig entfernt:

* `tsconfig.base.json` + Root-`tsconfig.json`: `baseUrl` raus, `paths`-Werte explizit
  `./`-relativ (Auflösung ohne `baseUrl` erfolgt relativ zur deklarierenden tsconfig — für
  die Root-Dateien identisches Verhalten).
* Alle `tsconfig.lib.json` der data-access-Libs + `libs/shared/data-access/tsconfig.{lib,server}.json`:
  lokales `"baseUrl": "."` entfernt (Anker bleibt das Lib-Verzeichnis — verhaltensneutral).
* **Nebenwirkung, bewusst in Kauf genommen:** Lib-tsconfigs mit eigenen `paths`, aber ohne
  eigenes `baseUrl` (Domain-Libs, Muster aus CLAUDE.md §2.1) ankerten bisher am Workspace-Root —
  ihre relativen dist-Overrides liefen dadurch teils ins Leere und wurden still per
  node_modules-Fallback aufgelöst. Ohne `baseUrl` ankern sie jetzt korrekt am Lib-Verzeichnis
  (die dokumentierte Intention). Verifiziert über `nx run-many -t lint,test,build`.
* **Zwei dabei aufgedeckte tote Overrides bereinigt:** In `discounts/domain` und
  `businessdays/aggregator` wurden die vorher wirkungslosen d.ts-Mappings „lebendig" und
  brachen Vitest (Runtime-Import einer `.d.ts`). Fix: expliziter **leerer** `"paths": {}`-Block —
  Auflösung läuft wie zuvor über die node_modules-Workspace-Links. Wichtig: Der leere Block ist
  Absicht, denn ein nicht-leerer `paths`-Block in einer Lib-tsconfig zieht ohne `baseUrl` den
  Anker der von Nx generierten tmp-tsconfig (`createTmpTsConfig`/`resolvePathsBaseUrl` in
  `@nx/js`) von der Workspace-Root auf das Lib-Verzeichnis — die von Nx injizierten
  root-relativen `dist/...`-Dep-Mappings laufen dann ins Leere. Gleiches gilt für
  `//`-Kommentare in diesen Dateien: der Nx-Helper parst mit striktem `JSON.parse` und
  überspringt JSONC-Dateien still — deshalb sind die Blöcke kommentarfrei.

## Verbleibende TS-7-Inkompatibilitäten (bewusst NICHT angefasst)

`moduleResolution: "node"` (gepaart mit `module: "commonjs"`) steckt noch in ~60 Lib-tsconfigs
(`libs/domains/*/domain|aggregator`, `libs/shared/*`, `apps/api-edge`, `apps/tse-gateway`) sowie
im Root-`tsconfig.json`. Das ist **kein** verhaltensneutraler Suchen-und-Ersetzen-Fix:
`node10`-Auflösung ignoriert `exports`-Maps, `node16`/`bundler` erzwingen sie — ein Wechsel
ändert die Modul-Auflösung real und gehört in die eigentliche Migration (Stufe 2), wo
Nx-/Angular-Migrationsschematics den kanonischen Zielwert vorgeben.

## Stufe 2 — Trigger für den Re-Check

Migration erneut prüfen, sobald **alle** erfüllt sind:

1. TS 7.1 mit stabiler API erschienen (~Okt 2026)
2. Angular-Release, dessen `@angular/compiler-cli`-Peer-Range TS 7 erlaubt
3. ng-packagr, typescript-eslint und Nx mit TS-7-Support

Dann: regulärer `ng update`-/Nx-Migrationspfad, `typescript` bumpen, `moduleResolution`-Altlasten
mitziehen. **Lockstep beachten:** core und cloud gleichzeitig bumpen (wie bei Angular-Majors,
vgl. Memory `feedback_workbench_angular_lockstep`), Builds nie parallel.

## Quellen

* [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) — GA, API-Lücke, entfernte Optionen
* [What's new in Angular 22](https://blog.ninja-squad.com/2026/06/03/what-is-new-angular-22.0) — Angular 22 verlangt TS 6
* Cloud-Gegenstück: `panary-cloud/docs/infrastructure/typescript-7-migration.md`
