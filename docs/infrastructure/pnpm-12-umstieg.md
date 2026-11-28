---
type: Guide
title: pnpm 12 — Umstieg von 10.34.3 und was sich am Repo geändert hat
description: panary-core läuft seit panary/panary-core#1535 auf pnpm 12.22.0. Overrides und Build-Freigaben stehen in pnpm-workspace.yaml statt in package.json, pmOnFail ignore hält das Lockfile einteilig für osv-scanner, die CI-Workspace-Dateien stellen allowBuilds um, und das globale pnpm 10 kann nicht auf 12 umschalten.
tags: [infra, ci, pnpm, supply-chain, dependencies]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-28T18:00:00.000Z }
---

# pnpm 12 — Umstieg von 10.34.3

`packageManager` steht auf `pnpm@12.22.0` (panary/panary-core#1535), der neuesten 12.x mit abgelaufener
7-Tage-Karenz am 2026-11-28. Zwischen 10 und 12 liegen zwei Majors; hier steht, was davon das Repo trifft und wie
es gemessen wurde. Entscheidung und Vorgeschichte der Supply-Chain-Keys: [ADR 0012](../adr/0012-pnpm-supply-chain-haertung.md).

## Vorher / Nachher

| Thema | Vorher (pnpm 10) | Nachher (pnpm 12) |
|---|---|---|
| Overrides (60 Floors) | `package.json` → `pnpm.overrides` | `pnpm-workspace.yaml` → `overrides` |
| Build-Freigaben | `pnpm.onlyBuiltDependencies: [better-sqlite3]`, Rest still „Ignored build scripts“ | `allowBuilds`: `better-sqlite3: true`, jedes andere Paket mit Install-Script ausdrücklich `false` |
| Lockfile | ein YAML-Dokument | unverändert ein Dokument, dank `pmOnFail: ignore` |
| CI-Workspace-Dateien (Edge-Image, POS-Release) | hängen `onlyBuiltDependencies` an, schreiben Linking-Keys in `.npmrc` | stellen `allowBuilds` um, hängen `linkWorkspacePackages` & Co. als YAML an |
| `.npmrc` | Registry + Workspace-Keys (in der CI) | nur Registry und Auth |

## Was gemessen wurde (2026-11-28, pnpm 12.22.0)

- **Feld `pnpm` wird ignoriert.** pnpm 12 meldet es nur als Warnung. `pnpm install --frozen-lockfile` bricht dann
  mit `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` ab; mit `--no-frozen-lockfile`, wie ihn `ci.yml` nutzt, wären die
  Floors **still** neu aufgelöst worden.
- **Umzug ohne Hash-Änderung.** Mit den Overrides in `pnpm-workspace.yaml` (gleiche Werte, gleiche Reihenfolge,
  per Skript gegen `HEAD:package.json` verglichen) läuft `--frozen-lockfile` durch. Der Config-Hash im Lockfile
  passt also, und das Lockfile ist byte-gleich zu `main`.
- **Build-Scripts.** Ohne Eintrag in `allowBuilds` endet der Install mit `ERR_PNPM_IGNORED_BUILDS`
  (`strictDepBuilds` ist Default). Gesperrt sind dieselben neun Pakete, die pnpm 10 als „Ignored build scripts“ meldete.
- **Boot-Dokument.** Bei gesetztem `packageManager` schreibt pnpm 12 ein erstes YAML-Dokument
  (`packageManagerDependencies`, `@pnpm/exe.*`) vor das Lockfile. osv-scanner 2.3.8 las davon nur dieses Dokument:
  **16 statt 1768 Pakete**, bei grünem Ergebnis. `pmOnFail: ignore` unterdrückt das Dokument. Preis: pnpm prüft die
  eigene Version nicht mehr gegen `packageManager`; den Pin setzen `pnpm/action-setup` und `Dockerfile.edge`.
- **Edge-Kontext.** `tools/docker/prepare-edge-context.sh` gegen eine Kopie des Worktrees: Exit 0, 71
  Workspace-Links, kein `@panary/*` aus der Registry, osv-scanner sieht 1768 Pakete.

## Lokal: globales pnpm muss 12 sein

Das global per npm installierte pnpm 10.34.3 kann **nicht** auf 12 umschalten:
`Failed to switch pnpm to v12.22.0 … ENOEXEC`. pnpm 12 kommt als natives Binary, dessen Install-Script pnpm 10
beim Umschalten nicht ausführt. Ein frischer Download ändert nichts. Umgekehrt schaltet ein globales pnpm 12 in
Repos mit `pnpm@10.34.3` (panary-cloud, Workbench-Root) sauber auf 10 herunter. Ohne globales pnpm 12 scheitern
im core-Verzeichnis `wt.sh new core`, lefthook, `pnpm nx` und `sandbox.sh`.

## Nicht abgedeckt

- Ob Dependabot Overrides in `pnpm-workspace.yaml` nachzieht und pnpm 12 versteht, zeigt erst sein nächster
  Montagslauf.
- Die Windows- und macOS-Schritte in `release-pos.yml` laufen nur im Release-Dispatch; die PowerShell-Umstellung
  ist dort zum ersten Mal ausgeführt.
- Das Cache-Mount-Ziel `/root/.local/share/pnpm/store` in `Dockerfile.edge` ist nicht gegen pnpm 12 gemessen. Ein
  falsches Ziel kostet Bauzeit, keine Korrektheit.
