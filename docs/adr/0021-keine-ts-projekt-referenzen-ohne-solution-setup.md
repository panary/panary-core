---
type: ADR
title: Keine TS-Projekt-Referenzen ohne TS-Solution-Setup — references aus den App-tsconfigs entfernt statt composite nachgezogen
description: Die projektübergreifenden references in den beiden App-tsconfigs waren Generator-Erbe ohne Funktion und werden entfernt; der Nx-Sync-Generator, der sie zurückschreiben würde, wird abgeschaltet, statt den Workspace auf composite umzustellen.
tags: [build, typescript, nx, admin-client, pos-client, ci]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-05T18:55:00.000Z }
---

# Keine TS-Projekt-Referenzen ohne TS-Solution-Setup

## Problem

`nx run admin-client:typecheck` scheiterte mit fünf Mal `TS6306`:

```
tsconfig.app.json:14:5 - error TS6306: Referenced project '.../libs/shared/data-access-theme'
must have setting "composite": true.
```

— dazu identisch für `libs/domains/locations/domain`, `libs/shared/ui-cloud-status`,
`libs/shared/data-access` und `libs/shared/data-access-config`.

`typecheck` ist kein Target aus einer `project.json`, sondern wird vom `@nx/js/typescript`-Plugin
inferiert (`nx.json#plugins[0]`). Es läuft `tsc --build tsconfig.json --emitDeclarationOnly` im
Projektverzeichnis. `tsc --build` ist der Projekt-Referenz-Modus von TypeScript: er folgt jedem
`references`-Eintrag und verlangt von jedem referenzierten Projekt `composite: true`.

`apps/admin-client/tsconfig.app.json` und `apps/pos-client/tsconfig.app.json` sind die **einzigen
beiden Dateien im gesamten Repo** mit projektübergreifenden `references` (5 bzw. 14 Einträge).
Sie zeigen auf Projekt-**Wurzeln**; TS löst das auf deren `tsconfig.json` auf, und die sind
Solution-Files (`"files": []`, `"include": []`, nur `references`) ohne `composite`. Im gesamten
Workspace kam `composite` an keiner einzigen Stelle vor.

Der entscheidende Befund liegt eine Ebene darüber: **der Workspace ist gar nicht im
TS-Solution-Setup.** `isUsingTsSolutionSetup()` aus `@nx/js` prüft vier Bedingungen, drei davon
sind hier nicht erfüllt:

| Bedingung | Ist-Zustand |
|---|---|
| Package-Manager-Workspaces (`packages:` in `pnpm-workspace.yaml`) | **nein** — bewusst weggelassen, siehe [ADR 0012](0012-pnpm-supply-chain-haertung.md) |
| `tsconfig.base.json` mit `composite: true` | **nein** — nirgends gesetzt |
| Root-`tsconfig.json` mit leerem `files` **oder** `include` | **nein** — definiert keins von beidem |
| Root-`tsconfig.json` mit `extends: "./tsconfig.base.json"` | ja |

Gegengeprüft im Code: `isUsingPackageManagerWorkspaces` → `false`, `isUsingTsSolutionSetup` →
`false`.

Damit tragen die Referenzen zur Modulauflösung nichts bei. Die läuft vollständig über `paths` in
`tsconfig.base.json`, die auf die **Quell**-`index.ts` der Libs zeigen — nicht auf gebaute
`.d.ts`. Der Angular-Build (`@angular/build:application`) baut ohnehin über sein eigenes Programm
und nutzt dieselben `paths`. Die `references` sind Generator-Erbe: Angular-/Nx-Generatoren
schreiben sie beim Anlegen einer Lib unbesehen mit.

Sichtbar wurde der Fehler erst durch [PR #110](https://github.com/michaelratke/panary-core/pull/110)
(`fix/typecheck-target`), der die vorgelagerten Config-Ursachen (`TS5069` fehlendes
`declaration`, `TS1343` `import.meta` in den vite-Configs) behoben hat. Vorher war `typecheck`
workspace-weit rot und dieser Fehler nie erreicht.

## Entscheidung

Die projektübergreifenden `references`-Blöcke werden aus beiden App-tsconfigs **entfernt**, und
der Nx-Sync-Generator, der sie zurückschreiben würde, wird abgeschaltet:

```jsonc
// nx.json
"sync": {
  "disabledTaskSyncGenerators": ["@nx/js:typescript-sync"]
}
```

Der zweite Teil ist nicht optional. Entfernt man nur die Referenzen, meldet der nächste
Task-Lauf `The workspace is out of sync` — das inferierte `typecheck`-Target trägt
`syncGenerators: ["@nx/js:typescript-sync"]`, und dieser Generator will die Referenzen aus dem
Projektgraphen wiederherstellen. Der TS-Fehler wäre dann gegen einen Nx-Fehler getauscht.

### Warum nicht `composite: true` nachziehen

Der naheliegende Gegenvorschlag — `composite` auf die referenzierten Lib-Wurzeln, konsequenterweise
workspace-weit — wurde gebaut und verworfen. Er kostet deutlich mehr, als er einbringt:

1. **Der Sync-Generator kaskadiert.** Er legt Referenzen ausschließlich auf `composite`-Projekte.
   Sobald die fünf Libs composite waren, wollte `nx sync` die Root-`tsconfig.json` mit Referenzen
   auf ebendiese fünf füllen und zusätzlich Referenzen zwischen Geschwister-Libs ziehen
   (`ui-cloud-status/tsconfig.lib.json` → `../data-access/tsconfig.lib.json`). Eine Teil-Umstellung
   ist kein stabiler Zustand.
2. **`composite` erzwingt vollständige `include`-Listen.** Direkt nach der Umstellung erschien
   `TS6307`: `libs/domains/locations/domain/src/lib/default-settings.ts` ist nicht in der Dateiliste
   von `tsconfig.spec.json` gelistet. Unter `composite` muss jede erreichbare Datei über
   `files`/`include` erfasst sein — das trifft die `tsconfig.spec.json` praktisch aller Domain-Libs
   und ist eine eigene Sanierung, kein Nebeneffekt.
3. **`nx sync` fasst 33 Dateien an**, darunter die handgepflegten `paths`-Overrides der
   data-access-Libs (das Cross-Lib-Import-Pattern aus `CLAUDE.md` §2.1). Inhaltlich blieben sie
   verlustfrei — nachgeprüft, kein `paths`-Eintrag ging verloren, nur Umformatierung auf 120
   Spalten. Trotzdem steht das gegen die Regel, Diffs minimal zu halten.

Der Nutzen dagegen wäre null: solange `paths` auf Quelldateien zeigt und kein Solution-Setup
existiert, beschleunigen Projekt-Referenzen nichts und prüfen nichts, was `tsc` nicht ohnehin prüft.
Sie erzeugen lediglich zusätzliche `.tsbuildinfo`-Artefakte und eine zweite, konkurrierende
Auflösungsschicht neben `paths`.

## Konsequenzen

- `nx run admin-client:typecheck` läuft grün (25 abhängige Tasks inklusive).
- Verifiziert ohne Regression: `nx run-many -t build` (121 Projekte) grün,
  `nx run-many -t test` (49 Projekte) grün, `nx sync:check` meldet „workspace is up to date",
  `nx run-many -t eslint:lint -p admin-client pos-client` 0 Fehler (135 vorbestehende Warnungen).
- **Neu generierte Libs bringen wieder `references` mit.** Generatoren schreiben sie unbesehen;
  solange kein Solution-Setup existiert, gehören projektübergreifende Einträge entfernt. Ein
  `nx sync` läuft dank `disabledTaskSyncGenerators` nicht mehr automatisch dagegen.
- **Die Abschaltung ist an das fehlende Solution-Setup gebunden, nicht an eine Abneigung gegen
  Projekt-Referenzen.** Migriert der Workspace je auf das TS-Solution-Setup (`packages:` in
  `pnpm-workspace.yaml`, `composite` in `tsconfig.base.json`, Solution-Root-tsconfig), dann gehört
  der Generator wieder aktiviert — zusammen mit der `include`-Sanierung aller
  `tsconfig.spec.json`. Das ist eine eigene Migration und ein eigenes ADR wert.
- **Nicht behoben:** `pos-client:typecheck` bleibt rot, aber aus unabhängigem Grund —
  `orders-domain:typecheck` meldet 29 TypeBox-Fehler in Spec-Dateien (`TS2345`, fehlendes
  `[Kind]`-Symbol). Identisch reproduzierbar auf dem unveränderten `fix/typecheck-target`-Stand,
  also vorbestehende Typecheck-Schuld aus derselben Serie wie PR #110 und keine Folge dieser
  Entscheidung.
- `typecheck` ist weiterhin **nicht** CI-gated — CI fährt `nx affected -t lint,test,build`. Diese
  Änderung repariert ein lokales Werkzeug, kein Gate.
