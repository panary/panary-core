---
title: pnpm-Supply-Chain-Härtung — eigene pnpm-workspace.yaml für panary-core
date: 2026-07-22
category: Infrastruktur
domains: [ci, infra, security]
status: aktiv
---

# pnpm-Supply-Chain-Härtung in panary-core

ADR + Betriebsanleitung. Schließt die Lücke, dass die Karenz für frisch
veröffentlichte npm-Pakete in `panary-core` **nie tatsächlich aktiv war**,
obwohl `panary-cloud` und der Workbench-Root sie seit dem 2026-07-07 tragen.

## Problem

`panary-core` hatte keine `pnpm-workspace.yaml`. Vorhanden waren nur:

- Dependabot-`cooldown: default-days: 7` in allen drei Ecosystems
- `min-release-age=7` in `.npmrc` — greift laut Kommentar in der Datei selbst
  **nur für die npm-CLI**; pnpm liest den Key nicht

Damit installierte die Core-CI ohne jede Karenz. Aufgefallen beim OSV-Sweep am
2026-07-22 (PR #55): `fast-uri@3.1.4` (3 Tage alt) und `@hono/node-server@2.0.11`
(1 Tag alt) ließen sich problemlos aufnehmen, während dieselben Bumps in
`panary-cloud` befristete `minimumReleaseAgeExclude`-Einträge brauchten.

Historisch entstand die Härtung in zwei Schritten (Core-PR #39 am 2026-07-01:
nur Dependabot-Cooldown + `.npmrc`; Cloud-Commit `bdaf0ba8` am 2026-07-07: die
drei pnpm-Keys). Core blieb grün, weil die semgrep-Regeln dieser Klasse ohne
`pnpm-workspace.yaml` gar nicht feuern können — die Härtung wurde dort also nie
umgesetzt, sie war nur unsichtbar abwesend.

## Untersuchte Optionen

### Verworfen: Keys in `package.json` unter `pnpm.*`

Naheliegend, weil Core dort bereits `pnpm.overrides` und
`pnpm.onlyBuiltDependencies` trägt. **Funktioniert nicht.** Empirisch verifiziert
mit pnpm 10.34.3 gegen drei identische Probe-Projekte
(`hono@^4.12.0`, `4.12.31` war 4 Tage alt):

| Konfiguration                                    | aufgelöst         |
| ------------------------------------------------ | ----------------- |
| ohne Härtung                                     | `hono@4.12.31`    |
| `minimumReleaseAge` in `pnpm-workspace.yaml`     | `hono@4.12.30` ✅ |
| `minimumReleaseAge` in `package.json` → `pnpm.*` | `hono@4.12.31` ❌ |

pnpm liest `minimumReleaseAge` **ausschließlich** aus einer
`pnpm-workspace.yaml`. Eine eigene Datei in `panary-core/` ist damit
alternativlos.

### Verworfen: vollständige Neuerzeugung des Lockfiles unter der Karenz

Wäre der sauberste Zustand (keine unreifen Pins im committeten Lockfile),
erzeugt aber **4458 Zeilen Drift** und hebt nebenbei dutzende transitive
Versionen an (eslint 9.39.4→9.39.5, @typescript-eslint 8.62→8.64 …). Zu
riskant für eine reine Infra-Änderung.

## Entscheidung

Eine **Settings-only-`pnpm-workspace.yaml`** im Repo-Root von `panary-core` —
bewusst **ohne `packages:`-Key**.

```yaml
minimumReleaseAge: 10080 # 7 Tage
minimumReleaseAgeExclude:
  - '@panary/*' # First-Party, eigene Publish-Pipeline
  - 'fast-uri' # befristet, s.u.
  - '@hono/node-server' # befristet, s.u.
  - 'brace-expansion' # befristet, s.u.
  - 'tar' # befristet, s.u.
blockExoticSubdeps: true
trustPolicy: no-downgrade
trustPolicyIgnoreAfter: 43200 # 30 Tage
```

### Warum kein `packages:`-Glob

Ein Glob würde den Standalone-Install (`ci.yml`, `publish-libraries.yml`,
`build-pos-windows.yml`) vom heutigen Single-Package-Modus auf einen echten
Workspace umstellen: ~46 zusätzliche Lockfile-Importer und
`tools/scripts/link-core-packages.sh` als Redundanz. Das ist eine eigene
Migration, keine Supply-Chain-Härtung.

### Warum der Workbench-Modus nicht bricht

pnpms nearest-ancestor-Regel sucht den Workspace-Root **ab dem cwd aufwärts** —
eine verschachtelte `pnpm-workspace.yaml` in einem Unterverzeichnis schließt
dieses nicht aus dem Eltern-Workspace aus. Belegt durch `panary-cloud`, das seit
Option A eine eigene Datei hat und trotzdem vollständig als Workspace-Member des
Workbench-Roots geführt wird (`pnpm -r list` am Workbench-Root zeigt
`panary-cloud` + alle Sub-Pakete). Im Workbench-Modus gewinnen ohnehin die
Root-Settings; der Workbench-Root trägt denselben Satz.

### Warum `pnpm.overrides` in der package.json bleibt

Dependabot pflegt die Override-Liste dort, und ein Umzug änderte den
Lockfile-Config-Hash. pnpm liest beide Quellen — ein `overrides:`-Key in der
`pnpm-workspace.yaml` würde die package.json-Variante still überstimmen.
Verifiziert: mit der Settings-only-Datei bleibt das Lockfile byte-identisch.

Im **Workbench-Modus** warnt pnpm, dass `pnpm.overrides`/
`pnpm.onlyBuiltDependencies` aus `panary-core/package.json` nicht greifen — das
ist korrekt und unverändert: dort gewinnt der Workbench-Root. Standalone greifen
sie.

## Voraussetzung: pnpm-Pin

Die Keys wirken erst ab pnpm 10.16 (`minimumReleaseAge`), 10.21 (`trustPolicy`)
bzw. 10.26 (`blockExoticSubdeps`). `origin/main` stand auf **pnpm@10.12.1** —
alle drei wären wirkungslos gewesen. Der Pin ist deshalb Teil dieser Änderung
(`package.json` + corepack-Pin in `tools/docker/Dockerfile.edge`, der auf
`pnpm@latest` stand und auf pnpm 11 gesprungen wäre).

## Die vier Install-Pfade

| Pfad                                                       | Workspace-Datei                         | Lockfile                   | Karenz                |
| ---------------------------------------------------------- | --------------------------------------- | -------------------------- | --------------------- |
| Workbench (lokal)                                          | Workbench-Root                          | geteilt (Symlink)          | Root-Settings         |
| `ci.yml`, `publish-libraries.yml`, `build-pos-windows.yml` | committete Datei                        | committet, unverändert     | aktiv                 |
| `build-edge-docker.yml`                                    | committete Datei **+ angehängte Globs** | committet, wird erweitert  | **ausgehängt** (s.u.) |
| `release-pos-windows.yml`                                  | committete Datei **+ angehängte Globs** | gelöscht, frisch aufgelöst | aktiv                 |

Die beiden Release-Workflows schrieben die Datei bisher inline **neu**. Das
hätte die Härtung stillschweigend weggeworfen, sobald sie im Repo liegt. Sie
hängen ihre `packages:`/`onlyBuiltDependencies:`-Blöcke jetzt **an** und prüfen
vorher, dass die Datei existiert und die Keys noch nicht trägt (YAML verbietet
Duplikate).

### Warum die Karenz im Edge-Docker-Build ausgehängt ist

`build-edge-docker.yml` behält das committete Lockfile und ergänzt es um die
~46 Importer aus den Globs. Dabei prüft pnpm bereits gepinnte Versionen erneut —
und jede Lockfile-Version, die jünger als 7 Tage ist, lässt den Build mit
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` scheitern. Am 2026-07-22 waren das
**8+ Pakete** (`autoprefixer`, `enhanced-resolve`, sämtliche
`@parcel/watcher-*`-Plattformvarianten) — direkte Folge des tags zuvor
gemergten nx-Bumps. Sie einzeln auszunehmen wäre unwartbares Whack-a-mole.

Der Schritt hängt die Karenz deshalb gezielt per
`--config.minimumReleaseAge=0` aus. `blockExoticSubdeps` und `trustPolicy`
bleiben aktiv. Die Begründung ist inhaltlich, nicht nur pragmatisch: **die
Karenz ist ein Gate für den Eintritt neuer Versionen** (lokales
`pnpm add/update`, Dependabot-PRs über `ci.yml`), **nicht für den Konsum eines
bereits gereviewten Lockfiles**.

`release-pos-windows.yml` löscht das Lockfile unbedingt und löst vollständig neu
auf — dort darf pnpm frei auf reife Versionen ausweichen, die Karenz bleibt
aktiv.

### Warum `trustPolicyIgnoreAfter`

`trustPolicy: no-downgrade` allein bricht jede vollständige Neuauflösung an
etablierten Alt-Paketen ab, die vor der Provenance-Ära veröffentlicht wurden —
konkret `chokidar@4.0.3` (2024-12-18, via `mocha`) mit
`ERR_PNPM_TRUST_DOWNGRADE`. 43200 Minuten = 30 Tage begrenzt die Prüfung auf
Versionen, die jünger als 30 Tage sind — genau das Fenster, in dem eine
Paketübernahme relevant ist.

## Betrieb

### Befristete Einträge in `minimumReleaseAgeExclude`

Diese Einträge stehen dort, weil die CVE-Overrides in `package.json` exakt auf
eine Version zeigen, die die Karenz noch blockiert (kein reifer Backport
verfügbar). **Nach Ablauf entfernen** — danach ist der Eintrag ein stiller
Verzicht auf die Karenz für dieses Paket:

- `fast-uri` 3.1.4 (2026-07-19) → reif ab **2026-07-26**
- `@hono/node-server` 2.0.11 (2026-07-21) → reif ab **2026-07-28**
- `tar` 7.5.21 (2026-07-21) → reif ab **2026-07-28** _(OSV-Sweep PR #57)_
- `brace-expansion` 5.0.8 (2026-07-23) → reif ab **2026-07-30** _(OSV-Sweep PR #57)_

`postcss` (ebenfalls PR #57, `^8.5.18`) braucht **kein** Exclude — reife
Versionen (8.5.18/8.5.19) erfüllen den Range. Faustregel: nur Advisories, deren
**einzige** gepatchte Version jünger als 7 Tage ist, brauchen einen befristeten
Eintrag.

### Fehlerbild `ERR_PNPM_NO_MATURE_MATCHING_VERSION`

Tritt auf bei `pnpm add`/`pnpm update` und in `release-pos-windows.yml`. Zwei
Ursachen unterscheiden:

1. **Ein `pnpm.overrides`-Eintrag zeigt auf eine zu junge Version** (typisch nach
   einem OSV-/CVE-Sweep). → Paket **befristet** in `minimumReleaseAgeExclude`
   aufnehmen, mit Ablaufdatum als Kommentar.
2. **Das committete Lockfile pinnt eine zu junge transitive Version** (typisch in
   den ersten 7 Tagen nach einem Dependabot-Bump). → Wenn möglich abwarten; das
   Problem löst sich mit dem Reifen der Version von selbst.

> Konkret am 2026-07-22: `pnpm add` in Core scheitert an
> `autoprefixer@10.5.4` (6 Tage alt, aus dem nx-Bump in PR #49). Reif ab
> **2026-07-23**, danach kein Eingriff nötig.

### Synchron halten

Drei Listen tragen denselben Satz und driften sonst auseinander:

- `panary-core/pnpm-workspace.yaml` (diese Datei)
- `panary-cloud/pnpm-workspace.yaml`
- `_WORKBENCH_PANARY/pnpm-workspace.yaml` (lokal, nicht in Git)

`trustPolicyIgnoreAfter` fehlt derzeit in Cloud und im Workbench-Root — dort
tritt das `chokidar`-Problem auf, sobald jemand das Lockfile vollständig neu
erzeugt.

## Verifikation (2026-07-22, pnpm 10.34.3)

Alle Läufe in einem git-Worktree **außerhalb** des Workbench-Baums
(`/private/tmp/…`), sonst greift die nearest-ancestor-Regel auf den
Workbench-Root.

- Settings-only-Datei akzeptiert; Lockfile bleibt byte-identisch
- Karenz nachweislich scharf (Probe-Matrix oben)
- CI-Pfad (`--no-frozen-lockfile` gegen committetes Lockfile): kein Churn
- Edge-Docker-Pfad end-to-end simuliert (echter `run`-Block aus dem Workflow
  extrahiert): erfolgreich, Drift gegenüber dem committeten Lockfile
  vergleichbar mit dem Kontrolllauf auf unverändertem `origin/main`
  (975 Zeilen) — die Drift ist **vorbestehend**, nicht durch diese Änderung
  verursacht
- Vollständige Neuauflösung mit Globs: erfolgreich mit nur den beiden
  befristeten Excludes
- `.github/workflows/*.yml` + `pnpm-workspace.yaml` als YAML valide

## Nicht betroffen

`apps/pos-client/src-tauri/` ist ein Cargo-Ökosystem — von pnpm-Keys
unberührt. Die Cargo-Karenz läuft über `cooldown` im Dependabot-Cargo-Eintrag.

## Verwandt

- `documentation/library-publishing.md` — warum `@panary/*` vom Cooldown
  ausgenommen ist
- `documentation/edge-build-platforms.md` — Edge-Docker-Build
- `panary-cloud/documentation/` — Cloud-Pendant der Härtung
