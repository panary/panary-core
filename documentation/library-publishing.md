---
title: Library-Publishing — @panary-core/* via GitHub Packages
date: 2026-05-20
category: infrastructure
domains: [all]
status: current
---

# Library-Publishing — `@panary-core/*` via GitHub Packages

panary-core ist die Single Source of Truth für die geteilten Domain-Schemas,
Backend-Hooks und Utilities. panary-cloud (und künftig weitere Konsumenten)
beziehen diese als versionierte npm-Pakete aus **GitHub Packages**
(`https://npm.pkg.github.com`, Scope `@panary-core`).

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

Publiziert wird jedes Nx-Projekt mit `tag: publishable`. Aktuell **27 Pakete**:
die 26 von panary-cloud konsumierten Domains/Shared-Libs + `audit-events`.

Publishable wird ein Domain-Paket durch:
1. **Eltern-`package.json`** (`libs/domains/<name>/package.json`):
   `name: "@panary-core/<name>"`, `version`, `exports` (`./domain` →
   `./domain/dist/index.cjs.js`), `files: ["domain/dist", …]`, `publishConfig`
   (Registry), `peerDependencies`.
2. **Eltern-`project.json`** (`libs/domains/<name>/project.json`):
   `tags: ["type:domain-package", "domain:<name>", "publishable"]`, Build-Target
   `dependsOn: ["<name>-domain:build"]`, `nx-release-publish.packageRoot`.

Shared-Libs (`libs/shared/common`, `libs/shared/backend`) bauen via `@nx/js:tsc`
nach `dist/libs/shared/<name>` und publizieren mit
`nx-release-publish.packageRoot: dist/libs/shared/<name>`.

> Beim Anlegen einer neuen Domain, die auch von der Cloud gebraucht wird, **beide**
> Dateien gemäß obigem Muster anlegen — sonst fehlt das Paket in der Registry und
> der Cloud-Standalone-Build scheitert mit 404.

---

## Release-Ablauf (manuell ausgelöst, Tag triggert Publish)

```bash
cd panary-core

# 1. Version aller publishable Libs setzen (bumpt package.json + peer-Ranges).
#    Specifier: konkrete Version oder patch/minor/major.
pnpm nx release version 26.5.0

# 2. Geänderte package.json committen.
git add libs/domains/*/package.json libs/shared/*/package.json
git commit -m "chore(release): @panary-core/* auf 26.5.0"

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

---

## Konsum in panary-cloud

`panary-cloud/package.json` referenziert die Pakete als `"@panary-core/<name>":
"^26.5.0"`. Auflösung:

| Umgebung | Mechanismus |
|---|---|
| Lokale Entwicklung | pnpm-Workspace-Root `_WORKBENCH_PANARY/` + `prefer-workspace-packages=true` → lokale Source wird gelinkt, sofern deren Version den Range erfüllt |
| Prod / CI (standalone) | `.npmrc` mit `@panary-core:registry=https://npm.pkg.github.com` + Read-Token → `pnpm install` zieht die gepinnte Version aus der Registry |

Nach einem Core-Release wird die Range in panary-cloud manuell gebumpt
(Dep-Bump-Commit) → Cloud-CI baut das Image gegen die neue Version → Coolify
deployt.
