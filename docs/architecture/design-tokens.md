---
type: Architecture
title: Design-Tokens — Aufbau und Einbindung
description: Welche Tokens @panary/design-tokens bereitstellt (Warm hell/dunkel, Kasse, Touch-Skala), wie sie in Tailwind v4 abgebildet und in Apps eingebunden werden.
tags: [design-system, pos, admin]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-21T22:00:00Z }
---

# Design-Tokens — Aufbau und Einbindung

Entscheidung und Begründung: [ADR 0058](../adr/0058-design-token-paket-panary-design-tokens.md). Code:
`libs/shared/design-tokens/`.

## Einbindung

Nach `tailwindcss`, per relativem Pfad (Pfad ab `apps/<app>/src/`):

```css
/* admin-client: styles.css */
@import 'tailwindcss';
@import '../../../libs/shared/design-tokens/tokens.css';
@import '../../../libs/shared/design-tokens/theme.css';
```

```scss
// pos-client: styles.scss
@use 'tailwindcss';
@use '../../../libs/shared/design-tokens/tokens.css';
@use '../../../libs/shared/design-tokens/theme.css';
```

Dunkel gilt bei `<html data-theme="dark">` oder bei System-Dunkel ohne `data-theme="light"`.

## Tokens

| Gruppe | Tokens | Herkunft |
|---|---|---|
| Flächen | `--surface-bg\|panel\|panel-elevated\|sidebar\|input\|rail`, `--scrim` | cloud Warm/Dark; `rail`, `scrim` aus dem Konzept |
| Linien, Text | `--border-default\|soft\|strong`, `--text-primary\|muted\|faint` | cloud |
| Aktion | `--primary` (Mint), `--on-primary` (Navy), `--brand-navy` | Kasse: Mint trägt Navy-Schrift, beide Themes gleich |
| Akzent | `--accent`, `--accent-dark`, `--accent-ink`, `--accent-soft`, `--accent-border` | cloud; `--accent-ink` #157a4e hell / #2dd4a4 dunkel für Text |
| Status | `--danger`, `--danger-ink\|soft\|line`, `--warn-*`, `--info-*` | Konzept |
| Kasse | `--pos-key`, `--pos-key-line` | Konzept |
| Schrift | `--font-family-sans\|mono`, `--font-size-xs…2xl` (rem) | cloud, in rem damit sie mit der Wurzelschrift (Dichte) skalieren |
| Form | `--r-control` 0,5rem, `--r-card` 0,75rem, `--r-pill`, `--elevation-card` | Konzept |
| Touch | `--touch-min` 3rem, `--touch` 3,5rem, `--touch-primary` 4rem | Konzept §4 |

`--text-faint` ist Hilfstext/Platzhalter und wird nur mit 3:1 geprüft, nicht als Fließtext.

## Tailwind-Namen (`theme.css`)

`bg-surface-bg|panel|elevated|sidebar|input|rail`, `border-line|line-soft|line-strong`, `text-ink|ink-muted|ink-faint`,
`bg-action text-on-action`, `text-accent-ink bg-accent-soft border-accent-line`, `danger|warn|info`-Varianten,
`bg-pos-key border-pos-key-line`, `rounded-control|card|pill`, `shadow-card`, `h-touch w-touch min-h-touch-min`
(Spacing-Namespace: `touch-min`, `touch`, `touch-primary`).

Die Namen `--color-primary`, `--color-surface`, `--color-border`, `--radius-*` und `--text-*` besetzt das Paket
bewusst nicht; cloud nutzt sie anders. Die Ausnahme sind `--font-sans` und `--font-mono`: Sie ersetzen
die Tailwind-Defaults mit Inter und IBM Plex Mono.

## Kontrast

`src/tokens.spec.ts` prüft je Theme u. a. Text auf Flächen (≥ 4,5:1), `--on-primary` auf `--primary` und die
Status-Paare. Neue Text-/Flächenpaare gehören in die Liste `pairs` des Specs.
