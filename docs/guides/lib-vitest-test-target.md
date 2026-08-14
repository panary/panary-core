---
type: Guide
title: Test-Target an einer Nx-Lib nachrüsten
description: Anleitung, wie eine Lib ohne `test`-Target eines per Plugin-Inferenz bekommt — inklusive der drei Fallen (Config-Drift, TS5069, fehlender JIT-Compiler) und des TestBed-freien Musters für Angular-Klassen.
tags: [nx, vitest, testing, ci]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-10T21:00:00Z }
---

# Test-Target an einer Nx-Lib nachrüsten

Nicht jedes Projekt im Workspace hat ein `test`-Target. Ohne eines laufen Specs
**weder lokal noch in der CI** — und zwar lautlos: `nx affected -t lint,test,typecheck,build`
überspringt das Projekt beim `test`-Teil und meldet trotzdem Erfolg. Eine Spec-Datei
kann dort monatelang liegen, ohne je ausgeführt worden zu sein.

Prüfen, was ein Projekt wirklich hat:

```bash
pnpm nx show project <projekt> --json
```

---

## 1. Das Target wird nicht geschrieben, sondern inferiert

`nx.json` registriert das `@nx/vitest`-Plugin mit `testTargetName: 'test'` und
`ciTargetName: 'test-ci'`. Das Plugin leitet das Target aus der **Anwesenheit einer
Vitest-Konfiguration** ab. Es genügt also eine Datei:

`libs/domains/<domain>/<lib>/vitest.config.mts`

```ts
import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/<domain>/<lib>',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: '<projektname>',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/<domain>/<lib>',
      provider: 'v8' as const,
    },
  },
}))
```

> ⚠️ **Kein handgeschriebenes `test`-Target in `project.json`.** Es funktioniert zwar,
> weicht aber von der Inferenz ab und überschreibt sie. Damit driftet die Lib von den
> Projekten weg, die es per Inferenz haben, und Änderungen an den Plugin-Optionen in
> `nx.json` gehen an ihr vorbei. Vorlagen mit korrektem Aufbau:
> `libs/domains/devices/domain`, `libs/domains/products/data-access`.
>
> **Dasselbe gilt für `lint`.** Generatoren schreiben gern
> `"lint": { "executor": "@nx/eslint:lint" }`; 46 Projekte trugen das, bis
> [panary/panary-core#206](https://github.com/panary/panary-core/issues/206) es entfernt hat.
> Ein solches Target überschreibt das inferierte und erbt dessen Cache-Inputs nicht — es
> bekommt stattdessen die aus `targetDefaults`. Wer nach `nx g …` ein `lint`- oder
> `test`-Target in der frischen `project.json` findet, löscht es — bleibt danach
> `"targets": {}` übrig, kommt der Schlüssel gleich mit weg.
>
> ⚠️ **Bis 2026-08-14 stand hier, die projektlokale `eslint.config.mjs` habe damit nicht
> in den Inputs gestanden und eine Änderung daran den Cache nicht invalidiert.** Das ist
> falsch: Die Inputs des expliziten Targets begannen mit `default`, und `default` ist in
> `nx.json` als `{projectRoot}/**/*` definiert — die Datei liegt im projectRoot und war
> damit erfasst. Gemessen am expliziten Target (`libs/shared/ui-notifications`, alter
> Stand wiederhergestellt): Änderung an der lokalen `eslint.config.mjs` → **echter Lauf**,
> unverändert → Cache-Treffer, zweite Änderung → wieder echter Lauf.
>
> Gefehlt haben zwei **andere** Inputs, die nur das inferierte Target mitbringt:
> `^default` (eine Änderung in einer Abhängigkeit invalidierte den Lint-Cache nicht) und
> `externalDependencies: ["eslint"]` (ein eslint-Versionswechsel ebenso wenig). Der
> Aufräum-Grund bleibt derselbe, nur der belegte Schaden ist ein anderer — und er lag
> nie bei der Datei, die man zuerst verdächtigt.

Gegenprobe nach dem Anlegen — das Delta im Projektgraphen muss **genau `test`** sein,
sonst hat man nebenbei etwas anderes verändert:

```bash
pnpm nx show project <projekt> --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).targets).join(', ')))"
```

`test-ci` erscheint erst, sobald die erste Spec-Datei existiert (das Plugin legt pro
Datei ein CI-Target an).

---

## 2. `tsconfig.spec.json` — `declaration: true` ist Pflicht

Ohne spec-tsconfig werden die Specs nie typgeprüft. Mit einer falsch gebauten reißt
man dagegen das **workspace-weite** Typecheck-Gate ab:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "../../../../dist/out-tsc",
    "types": ["vitest/globals", "vitest/importMeta", "vite/client", "node", "vitest"]
  },
  "include": [
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ]
}
```

Dazu die Referenz in der `tsconfig.json` der Lib:

```json
"references": [{ "path": "./tsconfig.lib.json" }, { "path": "./tsconfig.spec.json" }]
```

**Warum `declaration: true`:** Das `typecheck`-Target des `@nx/js/typescript`-Plugins
läuft als `tsc --build --emitDeclarationOnly` über **alle** referenzierten Projekte.
`tsconfig.base.json` setzt `declaration: false` bei `declarationMap: true` — eine
Kombination, an der `tsc` mit **TS5069** abbricht, *bevor* eine einzige Datei geprüft
wird. Genau daran lief das Gate workspace-weit ins Leere, während unbemerkt 96
Typfehler aufliefen (#110, #111). Seit dem Fix ist `typecheck` hart und ohne Baseline.

### Wann die spec-tsconfig entfällt

Sie hängt am `typecheck`-Target. Projekte ohne `tsconfig.json` haben keines — dort wäre
sie Maschinerie ohne Wirkung, und es bleibt bei der `vitest.config.mts` allein. Im
Workspace betrifft das genau zwei Projekte (#159):

| Projekt                      | Warum                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| `tse-gateway`                | App mit `tsconfig.app.json` statt `tsconfig.json`; Specs sind dort exkludiert |
| `feathers-service-generator` | Tool ganz ohne tsconfig; Specs laufen über `@nx/devkit/testing`               |

Für jede Lib mit `tsconfig.lib.json` gilt der Regelfall oben.

---

## 3. Angular-Klassen ohne TestBed instanziieren

Der Workspace fährt für Lib-Specs durchgängig `environment: 'node'` — kein jsdom, kein
`@angular/build:unit-test`. Services **und** Komponenten-Klassen lassen sich damit
trotzdem testen, solange nichts gerendert wird:

```ts
// JIT-Compiler zuerst laden: @angular/common kommt über die Data-Access-Barrels
// partial-compiled herein; ohne Linker fällt Angular auf JIT zurück.
import '@angular/compiler'
import { Injector, runInInjectionContext } from '@angular/core'

const injector = Injector.create({
  providers: [
    { provide: ConnectionService, useValue: { /* … */ } },
    { provide: DeviceConfigService, useValue: { getConfig: () => ({ deviceId: 'terminal-1' }) } },
  ],
})

const service = runInInjectionContext(injector, () => new MyService())
```

Drei Punkte, die sonst Zeit kosten:

- **`import '@angular/compiler'` muss die erste Zeile sein.** Fehlt sie, bricht der Lauf
  mit `The injectable 'PlatformLocation' needs to be compiled using the JIT compiler`
  ab — und zwar beim Import des Barrels, nicht in einem Test.
- **Komponenten-Klassen gehen, Rendern nicht.** `new LoginComponent()` im
  Injection-Kontext löst alle `inject()`-Aufrufe auf; `templateUrl` wird erst beim
  Rendern kompiliert, das hier nie passiert. Für Logik in Methoden und `computed()`
  reicht das vollständig.
- **Kein `localStorage` in `environment: 'node'`.** Ein kleiner Stub über
  `Object.defineProperty(globalThis, 'localStorage', …)` ist hier kein Notbehelf: Er
  ist der einzige Weg, einen kaputten Cache-Rohwert herzustellen, den ein echtes
  Storage-API so nie schreiben würde.

Referenz-Implementierungen:
`libs/domains/products/data-access/src/lib/services/product.service.spec.ts`,
`libs/domains/devices/data-access/src/lib/services/device-assignment.service.spec.ts`,
`libs/domains/users/feature-pos-login/src/lib/login.component.spec.ts`.

---

## 4. Verifikation

```bash
pnpm nx run-many -t lint,typecheck,build,test -p <projekt> --skip-nx-cache
pnpm nx format:check --files <neue-dateien-kommasepariert>
```

> **Bis 2026-08-14 stand hier `eslint:lint,lint`** — mit dem Hinweis, `nx lint <projekt>`
> allein laufe „bei den meisten Libs still ins Leere und melde trotzdem Exit 0". Das war
> korrekt beobachtet und als Workaround dokumentiert; die Ursache lag eine Ebene tiefer
> (`@nx/eslint/plugin` hieß `targetName: "eslint:lint"`, während CI und Gewohnheit `lint`
> riefen) und traf die CI genauso — 40 Projekte wurden dort nie gelintet.
> Seit [panary/panary-core#204](https://github.com/panary/panary-core/issues/204) heißt das
> inferierte Target überall `lint`; ein zweiter Target-Name ist nicht mehr nötig.

Ist eine `project.json`- oder tsconfig-Pfad-Änderung im Spiel, vorher `pnpm nx reset` —
der Projektgraph liefert dem Executor sonst weiter den alten Wert, auch mit
`--skip-nx-cache`. ⚠️ Nie, während in einem anderen Worktree ein nx-Lauf aktiv ist:
Alle Worktrees eines Repos teilen sich den Nx-Cache des Haupt-Checkouts.

Zum Schluss die Gegenprobe, die den eigentlichen Wert der Specs belegt: die
abgesicherte Stelle im Quellcode absichtlich brechen und prüfen, dass **genau** die
zuständige Spec fehlschlägt. Eine Spec, die nach einer Mutation grün bleibt, misst
nichts.

---

## 5. Ein Target ist noch keine Abdeckung

Seit #159 hat **jedes Projekt mit eigenem Code** ein `test`-Target. Gemessen direkt
danach: **45 der 86 Targets enthalten keine einzige Spec-Datei** — 35 davon neu aus
#159, 10 waren es schon vorher. `passWithNoTests: true` macht sie grün, und in der
CI-Ausgabe sieht ein leeres Target genauso aus wie ein volles.

Das ist Absicht und trotzdem eine Falle. Der Nutzen liegt allein darin, dass eine
künftig angelegte Spec **läuft**: Ohne Target wird sie stillschweigend übersprungen,
und `nx affected -t test` meldet trotzdem Erfolg — genau der Zustand, der in #155 zwei
Projekte betraf und dort erst bei der Code-Review auffiel. Der Nutzen liegt *nicht*
in der Zahl grüner Test-Tasks.

Seit #162 misst die CI das. Das Gate friert die **Liste** der leeren Projekte in
`empty-test-targets-baseline.json` ein und bricht ab, sobald ein weiteres dazukommt:

```bash
pnpm empty-targets:gate
```

```
Leerstand: 45 von 86 test-Targets ohne eine einzige Spec-Datei.
Kein neues leeres test-Target.
```

**Richtung.** Wachstum bricht ab. Ein Projekt, das seine erste Spec bekommt, bricht
*nicht* ab — es wird nur gemeldet, damit die Baseline nachgezogen wird:

```bash
pnpm empty-targets:gate:update
```

Warum die Baseline eine Liste ist und kein Zähler: Bekommt Projekt A seine erste Spec
(−1) und wird Projekt B neu und leer angelegt (+1), bleibt die Summe 45 — und niemand
sieht es. Dieselbe Überlegung wie bei `mongo-raw-gate.mjs` in panary-cloud, wo ein
reiner Zähler aus demselben Grund verworfen wurde.

**Neues Projekt angelegt und das Gate ist rot?** Das ist der Normalfall und kein
Fehler im Gate: Ein frisch generiertes Projekt hat ein `test`-Target und noch keine
Spec. Zwei zulässige Antworten — eine Spec schreiben, oder den Leerstand mit
`:update` quittieren und im PR begründen. Was nicht geht, ist ihn unbemerkt zu lassen;
genau dafür existiert das Gate.

> ⚠️ Die Baseline ist eine regenerierbare Datei und ein Konflikt-Kandidat wie
> `pnpm-lock.yaml`. Bei einem Merge-Konflikt **nie zeilenweise auflösen**, sondern
> neu erzeugen:
>
> ```bash
> git checkout --theirs empty-test-targets-baseline.json && pnpm empty-targets:gate:update
> ```

---

## Verwandt

- [Nx-Generator-Nutzungsanleitung](generator-usage-guide.md) — Scaffolding neuer Libs und Services
- [ADR 0022 — Format-Gate ohne Base](../adr/0022-format-gate-ohne-base.md) — das zweite harte CI-Gate, das neue Dateien betrifft
