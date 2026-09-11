---
type: ADR
title: 'Library-Publishing — @panary/* via GitHub Packages'
description: 'Nx-Release-basiertes Publishing der publishable @panary-Libs nach GitHub Packages per v-Tag mit fester Versionsgruppe und Konsum in panary-cloud über Caret-Ranges.'
tags: [infra, publishing, registry, nx]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-11T19:40:00Z }
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
(Registry-Autarkie für panary-cloud, 2026-06-12) **39 Projekte**: 35
Domain-Parents (alle `libs/domains/*` mit Parent-`package.json`) +
`@panary/shared` + `@panary/shared-common` + `@panary/shared-backend` +
`@panary/util-error-handling`.

> Die Zahl stand hier bis 2026-09-11 als „38", während die Aufzählung daneben
> schon immer 35 + 4 ergab. Sie ist nicht abzuschreiben, sondern zu messen:
>
> ```bash
> pnpm nx show projects --projects="tag:publishable" --json | node -p "JSON.parse(require('fs').readFileSync(0)).length"
> node tools/scripts/publishable-manifests.mjs --list | wc -l   # muss dieselbe Zahl liefern
> ```
>
> Laufen die beiden auseinander, ist ein publishable Projekt für den Release-Bump
> unsichtbar — genau der Fall, den das Gate unten abfängt.

Publishable wird ein Domain-Paket durch:
1. **Eltern-`package.json`** (`libs/domains/<name>/package.json`):
   `name: "@panary/<name>"`, `version`, `exports` (`./domain` →
   `./domain/dist/index.cjs.js`), `files: ["domain/dist", …]`, `publishConfig`
   (Registry), `peerDependencies`.
2. **Eltern-`project.json`** (`libs/domains/<name>/project.json`):
   `tags: ["type:domain-package", "domain:<name>", "publishable"]`, Build-Target
   `dependsOn: ["<name>-domain:build"]`, `nx-release-publish.packageRoot`.

Shared-Libs `libs/shared/common` (`@panary/shared-common`),
`libs/shared/util-error-handling` und `libs/shared/backend`
(`@panary/shared-backend`) bauen via `@nx/js:tsc` **in-place** nach
`<lib>/dist` (exports `./dist/src/index.js`, `packageRoot` = Lib-Verzeichnis,
`files: ["dist", …]`). `shared-backend` wurde am 2026-06-12 nachgezogen — der
alte Repo-Root-`outputPath` (`dist/libs/shared/backend`) brach die lokale
Workbench-Auflösung: der pnpm-Workspace-Link zeigt auf den Source-Ordner, dort
existierte das in `exports` referenzierte Artefakt nie.

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
- `libs/shared/data-access` hat ZWEI Entries: der Browser-Entry
  (`src/index.ts`, ng-packagr → `./data-access`) schließt
  `src/server.ts`/`service.factory.ts` (knex/mongodb) via tsconfig-`exclude`
  aus; der Server-Entry wird separat als CJS gebaut (`build-server`-Target,
  `@nx/js:tsc` → `data-access/dist-server/`) und als
  `./data-access/server`-Subpath exportiert. Dessen knex/mongodb-Abhängig-
  keiten sind BEWUSST keine Peers des Parents — der Subpath ist nur für
  api-edge/Edge-Runtime gedacht, nie für Cloud-Konsumenten.
- **In-Place-dist-Pakete (`shared-common`, `util-error-handling`):**
  `exports` bleibt package-root-relativ (`./dist/src/index.js`), aber
  `main`/`types` MÜSSEN output-relativ sein (`./src/index.js`). Grund: Der
  `@nx/js:node`-Executor (api-edge-Serve) mappt den Request via `NX_MAPPINGS`
  auf das **dist-Verzeichnis**; Pfad-Auflösung liest dort nur `main` (nie
  `exports`), und `@nx/js:tsc` kopiert authored Felder unverändert
  (`??=`-Semantik) nach `dist/package.json`. Bare-Specifier-Auflösung nutzt
  umgekehrt immer `exports` — `main` ist dort toter Ballast. Falsche Felder
  → `Cannot find module …/dist/dist/src/index.js` beim `nx serve api-edge`.

---

## Release-Ablauf (manuell ausgelöst, Tag triggert Publish)

```bash
cd panary-core
pnpm release          # Edge + POS + Libs: bumpt, committet, taggt, pusht
```

`pnpm release` (→ `tools/scripts/release-tag.sh` → `tools/scripts/bump-version.mjs`)
hebt in **einem** Schritt alles auf dieselbe Nummer: Root-`package.json`,
`apps/api-edge/package.json`, `tauri.conf.json`, die `LICENSE` (BSL Change Date)
und die **39 publishable Lib-Manifeste**. Der Release-Commit umfasst damit
**43 Dateien**; eine kleinere Zahl ist ein Befund, kein Glück.

Gegenprobe nach dem Lauf — außer der `Change Date`-Zeile der LICENSE darf nichts
Nicht-Versioniertes im Commit stehen:

```bash
git show HEAD -U0 | grep -E '^[+-]' | grep -v '^[+-][+-]' | grep -v '"version"'
```

### Lib-Release ohne Edge-/POS-Rollout

Wirkt eine Core-Änderung nur cloud-seitig (neuer Enum-Wert, Schema-Feld ohne
Edge-Konsument), ist ein `v*`-Tag zu teuer: Er triggert neben
`publish-libraries.yml` auch `build-edge-docker.yml` und `release-pos.yml`, also
einen Prod-Rollout auf alle Kunden binnen ~1 h — panary-core hat **keinen**
Staging-Kanal. Stattdessen:

```bash
node tools/scripts/bump-version.mjs            # schreibt sofort, kein Dry-Run
git add -A && git commit -m "chore(release): Versionen auf <X> anheben"
gh workflow run publish-libraries.yml --ref main -f dry-run=false
```

Kein Tag — der Release-Commit ist der einzige Marker. Der Dispatch-Pfad nutzt
`currentVersionResolver: "disk"`, publiziert also genau den committeten Stand.

### Das Gate gegen den stillen Fehlschlag

Bis 2026-09-11 pflegte die Lib-Version ein **zweiter**, eigenständig
auszulösender Pfad (`pnpm nx release version <X>`), während `pnpm release` nur
die App-Dateien anfasste. Wurde er vergessen, lief `publish-libraries.yml`
trotzdem: `nx release publish` versuchte die bereits veröffentlichte Vorversion
erneut hochzuladen und meldete dabei **success**. Gemessen an den `v26.8.*`-Tags
traf das `26.8.1`, `26.8.6`, `26.8.15` und `26.8.21`; im Repo stehen sieben
nachträgliche Heilungs-Commits.

Der Schaden war nicht kosmetisch: Zwischen Release und Heilung liefen Edge und
Cloud auf verschiedenen Schema-Ständen. Bei `26.8.21` ging es um das Feld
`discounts` im geteilten `receiptSchema` — geschlossen mit
`additionalProperties: false`. Ein Edge auf 26.8.21 schickte rabattierte Belege
mit dem Feld, eine Cloud auf 26.8.20-Libs wies sie bei der Validierung ab: Sync
TERMINAL, kein Retry, Operation weg.

Zwei Gegenmaßnahmen, beide in `publish-libraries.yml`:

| Schritt | Trigger | Prüft |
|---|---|---|
| `Lib-Versionen gegen Tag-Version pruefen` | nur Tag-Push | Jedes publishable Manifest trägt die Version aus `github.ref_name`. |
| `Publishable-Menge gegen nx abgleichen` | jeder Trigger | Scan-Menge (`publishable`-Tag der `project.json`) == `nx show projects --projects="tag:publishable"`. |

Der Versions-Check greift **nur** bei Tag-Push, weil der `workflow_dispatch`-Pfad
absichtlich den Stand aus den `package.json` publiziert (so wurde `26.8.21`
geheilt) — dort gibt es keine Tag-Version zum Vergleichen. Der Mengenabgleich
läuft dagegen immer: Ohne ihn wäre das Gate selbstbezüglich, weil Bump und
Prüfung dieselbe Scan-Logik benutzen und ein Projekt, das der Scan nicht kennt,
in beiden fehlte.

> **Versionsschema:** `YY.MM.INDEX`. App- und Lib-Version laufen seit
> 2026-09-11 zwangsläufig synchron — `bump-version.mjs` schreibt beide. Ein
> auseinanderlaufender Stand ist seither kein zulässiger Zwischenzustand mehr,
> sondern ein Befund.
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
