---
type: Guide
title: Tailwind-Quellensuche — source(none), @source-Globs und das tailwind:gate
description: Warum pos-client, admin-client und setup-client Tailwind mit source(none) laden, welche Form ein @source-Glob haben muss, damit er überhaupt etwas findet, und was pnpm tailwind:gate misst und nicht sieht.
tags: [ci, infra, tailwind, pos-client, admin-client, setup-client, gates]
status: stable
generated: { by: claude-code/opus-5-5, at: 2026-10-27T23:00:00Z }
sources:
  - { id: core-1138, resource: 'https://github.com/panary/panary-core/issues/1138', title: 'core#1138' }
  - { id: cloud-293, resource: 'https://github.com/panary/panary-cloud/issues/293', title: 'cloud#293' }
---

# Tailwind-Quellensuche

## Was passiert war

`nx serve pos-client` blieb am 2026-10-27 dauerhaft bei `❯ Building...` stehen; ein Prozess lief die ganze
Nacht, ein zweiter hing nach 7 min genauso. Der Build-Worker steckte in
`tailwindcss_oxide::scanner::detect_sources`. Die automatische Quellensuche von Tailwind 4 wurzelt in
`process.cwd()` — das ist der Repo-Root, weil `.postcssrc.json` kein `base` setzt — und lief dabei durch
`.nx/cache` (15.560 Einträge). Nach Verschieben des Caches lieferte der pos-client nach 15 s HTTP 200
([core#1138](https://github.com/panary/panary-core/issues/1138)). Dieselbe Klasse wie
[cloud#293](https://github.com/panary/panary-cloud/issues/293) im admin-dashboard.

## Die Einbindung

Alle drei Clients schalten die automatische Suche ab. Gescannt wird nur, was die `@source`-Zeilen nennen:

```css
/* admin-client, setup-client: styles.css */
@import 'tailwindcss' source(none);
@source "./app";
@source "../../../libs/domains/*/*/src/**/*.{html,ts}";
@source "../../../libs/shared/*/src/**/*.{html,ts}";
@source "../../../libs/apps/*/*/src/**/*.{html,ts}";
```

**pos-client (SCSS)** kann `source(none)` nicht an `@use 'tailwindcss'` hängen — `@use` kennt den Zusatz
nicht und muss vor jeder anderen Regel stehen. Deshalb steht dort ein Plain-CSS-`@import` **nach** den
`@use`-Regeln. Sass reicht ihn unverändert an PostCSS durch und hebt ihn an den Anfang der Ausgabe;
gemessen steht er dort vor den Token-Dateien, die Kaskade bleibt also wie vorher.

### Die Form der Globs ist nicht Kosmetik

- **Dateimuster am Ende ist Pflicht.** Ein `@source` mit Stern in einem Verzeichnis-Segment, das auf ein
  Verzeichnis endet (der Bestand bis #1138: `libs/shared/*/src`), matcht in Tailwind 4 **nichts** — ohne
  Warnung. Das fiel nie auf, weil die automatische Suche ohnehin alles mitnahm.
- **`**` erst unter `src/`.** Am Lib-Root liegen pnpm-Links (`node_modules/@panary/*`), die Symlink-Zyklen
  bilden; ein `**` weiter oben rekursiert dort endlos.
- **Nur `*.{html,ts}`.** Klassen in Komponenten-`.scss` oder `.css` werden nicht gefunden — dort gehören
  keine Utility-Klassen hin, `@apply` braucht ohnehin `@reference`.

### Was sich an der Klassenmenge änderte

Gemessen mit demselben sass und `@tailwindcss/postcss` wie im Build, ohne nx:

| Einstieg                           | vorher | nachher |
| ---------------------------------- | -----: | ------: |
| `apps/pos-client/src/styles.scss`  |   1374 |    1039 |
| `apps/admin-client/src/styles.css` |   1369 |    1298 |
| `apps/setup-client/src/styles.css` |   1361 |    1054 |

Vorher hatte jede App die Klassen **aller** Apps, dazu Treffer aus `docs/`, `.claude/` und `api-edge`. Jede
weggefallene Klasse wurde einzeln ihrer Fundstelle zugeordnet: Sie stammt aus einer anderen App, aus Doku
oder ist ein CSS-Eigenschaftswert (`ease-in-out`, `isolation: isolate`, `flex-shrink: 0`). Keine kommt
als Klasse in Code der jeweiligen App oder der Libs vor.

## `pnpm tailwind:gate`

`scripts/tailwind-source-gate.mjs`, in der CI mit seiner Spec. Es misst **durch Tailwind hindurch**, baut
also keine Glob-Semantik nach:

1. **`source(none)` vorhanden** — fehlt der Zusatz, ist das ein Verstoß, auch wenn alles andere grün wäre.
2. **Beitrag je `@source`-Zeile** (leave-one-in): einmal ohne jede Zeile kompilieren, dann je einmal mit genau
   einer. Bringt eine Zeile nichts über die Basis hinaus, ist sie wirkungslos.
3. **Kanarienvögel** je Einstieg und Quelle: eine Utility, die nur diese Quelle findet. Sie muss von ihrer
   Quelle gefunden werden und in der vollen Kompilierung stehen — das fängt „Glob trifft die falschen
   Dateien" und „Zeile gelöscht".

Unterschiede zum cloud-Gate: `.scss` läuft vorher durch das sass von `@angular/build`, und Kanarienvögel sind
an die Einstiegsdatei gebunden, weil alle drei Clients `@source "./app"` deklarieren.

`@source "./app"` im pos-client trägt nur 3 Klassen bei, Wörter aus Kommentar- und CSS-Text von `app.ts`;
dort liegen keine Templates mit Utilities. Bis panary/panary-core#129 waren es 10, alle aus dem gelöschten
Nx-Gerüst `nx-welcome.ts`. Meldet das Gate die Zeile als wirkungslos, gehört sie entfernt.

### Was das Gate nicht sieht

- **Neue Libs außerhalb der Globs.** Eine Lib unter einem Pfad, den keine Zeile abdeckt, bleibt
  unsichtbar; alle bestehenden Zeilen tragen weiter bei.
- **Dynamisch zusammengesetzte Klassen** (`'bg-' + farbe`) sieht Tailwind nie.
- **Klassen in Dateien außerhalb von `*.{html,ts}`** (Komponenten-`.scss`, `.css`, `.json`).
- **Teilbäume.** Je Lib-Quelle gibt es genau einen Kanarienvogel; ein Glob, der nur einen Teil der Libs
  trifft, bleibt grün, solange der Kanarienvogel in diesem Teil liegt.
- **Die Reihenfolge im pos-client.** Dass Sass den Tailwind-Import vor die Token-Dateien hebt, ist am
  2026-10-27 gemessen, aber nicht abgesichert.
- **Ob `nx serve` schnell startet.** Das Gate misst die Klassenmenge, nicht die Scan-Zeit.

Verwandt: [Design-Tokens — Aufbau und Einbindung](../architecture/design-tokens.md),
[Die vier Target-Gates](nx-target-gates.md).
