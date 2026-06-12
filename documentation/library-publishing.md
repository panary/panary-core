---
title: Library-Publishing — @panary/* via GitHub Packages
date: 2026-05-20
category: infrastructure
domains: [all]
status: current
---

# Library-Publishing — `@panary/*` via GitHub Packages

panary-core ist die Single Source of Truth für die geteilten Domain-Schemas,
Backend-Hooks und Utilities. panary-cloud (und künftig weitere Konsumenten)
beziehen diese als versionierte npm-Pakete aus **GitHub Packages**
(`https://npm.pkg.github.com`, Scope `@panary`).

Dieses Dokument beschreibt, **wie** publiziert wird und **welche** Pakete dabei
veröffentlicht werden.

---

## Problem → Entscheidung → Konsequenzen (ADR)

**Problem:** Lokal teilen sich panary-core und panary-cloud die Libs über einen
pnpm-Workspace-Root (`_WORKBENCH_PANARY/`, nicht in Git). Für die Produktion
braucht panary-cloud aber eine **gepinnte, reproduzierbare** Version der
Core-Libs, die unabhängig vom lokalen Checkout aus einer Registry installierbar
ist — sonst baut Prod gegen „irgendeinen" Core-Stand.

**Entscheidung:** Die geteilten Libs werden als versionierte Pakete nach GitHub
Packages publiziert. Versionierung + Publish laufen über **Nx Release**
(`nx.json` → `release`-Block, `projectsRelationship: "fixed"`,
`releaseTagPattern: "v{version}"`). Auslöser ist ein **Git-Tag `v*`**.
panary-cloud referenziert die Pakete mit Caret-Ranges (`^26.5.0`) und zieht sie
in Prod/CI aus der Registry; lokal linkt der Workspace-Root weiterhin die
Source.

**Konsequenzen:**
- Bei jeder Core-Änderung, die ein geteiltes Schema/Hook betrifft, ist ein
  Release-Tanz nötig: Core taggen/publishen → Version in panary-cloud bumpen →
  Cloud deployen. Bewusst akzeptiert (kontrolliert, auditierbar).
- Alle publishable Libs teilen **eine** Version (fixed group). Auch wenn nur ein
  Paket sich ändert, bekommt der ganze Satz die neue Versionsnummer.
- panary-core bleibt OSS-autark — kein Verweis auf panary-cloud oder den
  Workspace-Root.

---

## Was wird publiziert (publishable-Menge)

Publiziert wird jedes Nx-Projekt mit `tag: publishable`. Seit Option A
(Registry-Autarkie für panary-cloud, 2026-06-12) **38 Projekte**: 35
Domain-Parents (alle `libs/domains/*` mit Parent-`package.json`) +
`@panary/shared` + `@panary/shared-common` + `@panary/shared-backend` +
`@panary/util-error-handling`.

Publishable wird ein Domain-Paket durch:
1. **Eltern-`package.json`** (`libs/domains/<name>/package.json`):
   `name: "@panary/<name>"`, `version`, `exports` (`./domain` →
   `./domain/dist/index.cjs.js`), `files: ["domain/dist", …]`, `publishConfig`
   (Registry), `peerDependencies`.
2. **Eltern-`project.json`** (`libs/domains/<name>/project.json`):
   `tags: ["type:domain-package", "domain:<name>", "publishable"]`, Build-Target
   `dependsOn: ["<name>-domain:build"]`, `nx-release-publish.packageRoot`.

Shared-Libs `libs/shared/common` (`@panary/shared-common`) und
`libs/shared/util-error-handling` bauen via `@nx/js:tsc` **in-place** nach
`<lib>/dist` (exports `./dist/src/index.js`); `libs/shared/backend` baut
weiterhin nach `dist/libs/shared/backend` mit entsprechendem `packageRoot`.

> Beim Anlegen einer neuen Domain, die auch von der Cloud gebraucht wird, **beide**
> Dateien gemäß obigem Muster anlegen — sonst fehlt das Paket in der Registry und
> der Cloud-Standalone-Build scheitert mit 404.

### Angular-Subpaths via ng-packagr (Option A)

Frontend-Libs werden als **zweiter Subpath** des Domain-Parents publiziert
(`@panary/<name>/data-access`) bzw. als Subpaths des neuen Parent-Pakets
`@panary/shared` (`./data-access`, `./data-access-config`, `./ui-notifications`,
`./util-helpers`). Build via `@nx/angular:package` (ng-packagr, **APF partial
compilation** → `dist/fesm2022/*.mjs` + `dist/types/*.d.ts`).

Das 5-Datei-Muster pro Domain-`data-access` (Referenz: `user-preferences`):
1. `data-access/ng-package.json` — `dest: ./dist`, `entryFile: src/index.ts`.
2. `data-access/package.json` — `<name>-data-access-internal`, `private`,
   `sideEffects: false`, **nur Third-Party**-`peerDependencies`
   (`@panary/*`-Peers erzeugen Kind→Parent-Task-Zyklen — verboten).
3. `data-access/project.json` — Build-Target `@nx/angular:package`,
   `dependsOn: ["^build"]`, `implicitDependencies` auf die **Kind**-Projekte
   der tatsächlichen `@panary`-Imports (azyklisch).
4. `data-access/tsconfig.lib.json` — `compilationMode: "partial"`,
   `baseUrl: "."` + **lib-relative** `paths`-Map auf die gebauten dist-d.ts
   der Geschwister (die Nx-tmp-tsconfig-Remap-Logik verstümmelt root-relative
   Einträge; lib-relative ohne `libs/…`-Substring überleben sie).
5. Parent-`package.json`/`project.json` — `./data-access`-Export auf die
   konkreten fesm/d.ts-Dateien, `files` + `data-access/dist`, peerDeps-Union,
   Build-`dependsOn` beide Kinder.

**Fallstricke (gelernt beim Rollout):**
- ng-packagr default = full compilation → ohne `compilationMode: "partial"`
  wird eine Publish-Sperre ins dist-package.json injiziert.
- ng-packagr validiert Imports NICHT gegen die package.json (lodash-Befund) —
  Peer-Vollständigkeit manuell sichern.
- Die pnpm-Peer-Links der Parents bilden Symlink-Zyklen unter `libs/`
  (auth⇄users, shared⇄domains) — `**`-Globs (z. B. Tailwind-`@source`)
  rekursieren dort endlos; nur tiefenbegrenzte Patterns verwenden.
- `libs/shared/data-access` publiziert NUR den Browser-Entry (`src/index.ts`);
  `src/server.ts`/`service.factory.ts` (knex/mongodb) sind via tsconfig-
  `exclude` vom Lib-Build ausgeschlossen.

---

## Release-Ablauf (manuell ausgelöst, Tag triggert Publish)

```bash
cd panary-core

# 1. Version aller publishable Libs setzen (bumpt package.json + peer-Ranges).
#    Specifier: konkrete Version oder patch/minor/major.
pnpm nx release version 26.5.0

# 2. Geänderte package.json committen.
git add libs/domains/*/package.json libs/shared/*/package.json
git commit -m "chore(release): @panary/* auf 26.5.0"

# 3. Tag setzen + pushen → triggert publish-libraries.yml.
git tag v26.5.0
git push --follow-tags
```

Der Workflow `.github/workflows/publish-libraries.yml` baut bei Tag-Push alle
`tag:publishable`-Libs und führt `pnpm nx release publish` aus
(`currentVersionResolver: "disk"` → publiziert die in den package.json stehende
Version). Auth via `GITHUB_TOKEN` (`packages: write`).

**Sicheres Testen ohne Veröffentlichung:** Workflow manuell via
`workflow_dispatch` mit Default `dry-run='true'` starten — oder lokal:
```bash
pnpm nx run-many -t build --projects="tag:publishable"
pnpm nx release publish --dry-run
```

> **Versionsschema:** `YY.MM.INDEX` (konsistent mit `bump-version.mjs`).
> `bump-version.mjs` bleibt für die **App**-Version (Edge/POS/Tauri) zuständig;
> die **Lib**-Version läuft über `nx release version`. Beide dürfen, müssen aber
> nicht dieselbe Nummer tragen.
>
> **Vermerk (2026-06-12):** Die Releases v26.7.0–v26.7.6 wurden bereits im
> **Juni** getaggt — das `MM`-Präfix lief dem Kalender einen Monat voraus
> (begonnen mit v26.7.0 in den Brand-/Reservation-Phasen). Da npm-Versionen
> unveränderlich sind und monoton steigen müssen, wird die Linie fortgesetzt:
> Juli-Releases zählen regulär als 26.7.7+ (Schema stimmt ab Juli wieder),
> August beginnt mit 26.8.0. KEIN Rücksprung auf 26.6.x.

---

## Konsum in panary-cloud

`panary-cloud/package.json` referenziert die Pakete als `"@panary/<name>":
"^26.5.0"`. Auflösung:

| Umgebung | Mechanismus |
|---|---|
| Lokale Entwicklung | pnpm-Workspace-Root `_WORKBENCH_PANARY/` + `prefer-workspace-packages=true` → lokale Source wird gelinkt, sofern deren Version den Range erfüllt |
| Prod / CI (standalone) | `.npmrc` mit `@panary:registry=https://npm.pkg.github.com` + Read-Token → `pnpm install` zieht die gepinnte Version aus der Registry |

Nach einem Core-Release wird die Range in panary-cloud manuell gebumpt
(Dep-Bump-Commit) → Cloud-CI baut das Image gegen die neue Version → Coolify
deployt.
