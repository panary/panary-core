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

Dazu `fonts.css` (Inter, IBM Plex Mono, lokal) und befristet `legacy-palette.css` (siehe unten), beide ebenfalls
nach `tailwindcss`. Die Dateien liegen im Paket (`fonts/`, ca. 240 kB, nur latin und latin-ext). Beträge und
Zahlenspalten: Tailwind `tabular-nums` (Inter `tnum`) oder `font-mono`.

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

## Schriften

`fonts.css` bringt Inter (variabel, 100–900) und IBM Plex Mono (400/500/600) als woff2 mit, ohne Netzwerkzugriff
(Tauri, Edge im LAN). Quelle und Lizenz (OFL 1.1, Text je Familie unter `fonts/`) siehe Kopf der Datei. Switzer ist
in POS, Core-Admin und Setup-Client entfernt.

## Legacy-Palette (Brücke)

Die Apps nutzen rund 5 600-mal `gray-*`/`slate-*` (`bg-gray-100`, `dark:bg-gray-800`, …). `legacy-palette.css` legt
beide Rampen auf warme Werte; die dunklen Stufen entsprechen den Flächen-Tokens (`gray-900` = `--surface-bg`
dunkel). Damit ist das dunkle Theme ohne Einzelmigration nie reines Schwarz. Die Datei entfällt je Bereich, wenn
die Klassen auf Token-Klassen umgestellt sind; neue Oberflächen nutzen sie nicht.

## Angular Material (POS)

`apps/pos-client/src/styles.scss` setzt die Material-Systemfarben (`--mat-sys-primary`, `-surface*`, `-outline*`,
`-error`) auf die Tokens. Eine Zuordnung genügt für beide Themes, weil die Tokens selbst wechseln.

## Setup-Client (Edge-Setup-Assistent)

`apps/setup-client/src/styles.css` bindet `tokens.css`, `theme.css` und `fonts.css` ein, bewusst **ohne**
`legacy-palette.css`: Der Assistent nutzt nur Token-Klassen (`bg-surface-*`, `text-ink*`, `border-line`,
`bg-action`, `danger-*`, `warn-*`). Wiederkehrende Bausteine liegen als `@layer components` ebendort
(`setup-input`, `setup-btn-primary`, `setup-btn-ghost`, `setup-icon-btn`, `setup-field-label`) mit den Touch-Maßen
`min-h-touch` (56 px), `min-h-touch-primary` (64 px) und `min-h-touch-min` (48 px). Icons über `<lib-icon>`
(Phosphor Bold). Alles liegt lokal im Bundle, der Assistent läuft ohne Netz. Der QR-Code bleibt auf weißem Grund,
sonst scannen ihn Handys im Dunkelmodus nicht.
