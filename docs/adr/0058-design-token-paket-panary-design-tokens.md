---
type: ADR
title: Design-Token-Paket @panary/design-tokens
description: Warum POS, Core-Admin und Cloud-Admin ihre Farben, Schriften, Radien und Touch-Masse aus einem publishable CSS-Paket in core beziehen und wie es eingebunden wird.
tags: [design-system, pos, admin, publishing]
status: stable
decision: accepted
generated: { by: claude-code/sonnet-5.5, at: 2026-10-21T22:00:00Z }
---

# Design-Token-Paket @panary/design-tokens

## Problem

POS und Core-Admin sollen aussehen wie panary-cloud (Anker [#819](https://github.com/panary/panary-core/issues/819)).
Die Werte leben bisher nur in `panary-cloud/apps/admin-dashboard/src/styles.css`; core hätte sie kopieren müssen
und die Kopien würden auseinanderlaufen. Zusätzlich braucht die Kasse eigene Tokens (Touch-Skala, Tastenfläche,
Mint/Navy als Aktionsfarbe), die in cloud nicht vorkommen.

## Entscheidung

- Ein Paket `@panary/design-tokens` unter `libs/shared/design-tokens`, `publishable` nach ADR 0002 (fixe Version,
  `publish-libraries.yml`). Reines CSS, kein Build-Schritt, `files: ["*.css"]`. cloud konsumiert es per Pin-Bump
  ([#1436](https://github.com/panary/panary-cloud/issues/1436)).
- `tokens.css` setzt nur Custom Properties: Warm hell als `:root`, Warm dunkel unter `[data-theme='dark']` und unter
  `@media (prefers-color-scheme: dark)` für `:root:not([data-theme='light'])`. Es gibt nur Warm-Themes. Die
  Storefront-Tokens (`--st-*`) gehören nicht dazu.
- `theme.css` bildet die Tokens per `@theme inline` auf Tailwind-Namen ab. Es vermeidet Namen, die Tailwind-Standards
  oder cloud-Tokens überschreiben würden (`--color-primary`, `--color-surface`, `--radius-sm`, `--text-*`);
  die Aktionsfarbe heißt `action`.
- **Einbindung per relativem Pfad**, nicht per Paketname: `@import '../../../libs/shared/design-tokens/tokens.css'`
  (admin-client, CSS) bzw. `@use` (pos-client, SCSS). Gemessen in [#820](https://github.com/panary/panary-core/issues/820):
  Der Paketname löst nur bei vorhandenem `node_modules/@panary/…`-Link auf; ohne Link bricht der Build ab. Der
  relative Pfad funktioniert im Worktree, im Workbench-Checkout, im Docker-Build und in der Tauri-Pipeline ohne
  Link und ohne Lockfile-Eintrag. Das Paket hat deshalb auch keinen Eintrag in `tsconfig.base.json`.
- Ein Vitest-Spec (`src/tokens.spec.ts`) rechnet WCAG-Kontraste der Text-/Flächenpaare für beide Themes aus
  den Hex-Werten und prüft, dass die beiden Dunkel-Blöcke identisch bleiben.

## Konsequenzen

- Werte sind bis zur Umstellung von cloud ([#1436](https://github.com/panary/panary-cloud/issues/1436)) doppelt
  vorhanden; das Paket ist ab dann die Quelle. Pixelgleichheit von cloud ist dort zu prüfen.
- Dunkel steht zweimal in `tokens.css`, weil CSS eine Selektor-Liste mit `@media` nicht teilen kann. Der Spec
  fängt Drift.
- Das Paket wird mit dem nächsten `v*`-Tag veröffentlicht; Konsumenten in core brauchen keinen Publish.
- Fonts (Inter, IBM Plex Mono) liefert das Paket nicht; die Apps binden sie selbst ein.
