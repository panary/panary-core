#!/usr/bin/env node
// Erzeugt die POS-Icon-Registry (nur benötigte Phosphor-Bold-Pfade) und die Mapping-Tabelle der Doku.
// Quelle: tools/phosphor/pos-icon-mapping.mjs + @phosphor-icons/core (devDependency). Kein Runtime-Paket, kein CDN.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAPPING } from './pos-icon-mapping.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const assets = resolve(root, 'node_modules/@phosphor-icons/core/assets/bold')
const outTs = resolve(root, 'libs/shared/util-helpers/src/lib/icons.generated.ts')
const outDoc = resolve(root, 'docs/references/pos-icon-mapping.md')

const names = [...new Set(Object.values(MAPPING).map(([p]) => p))].sort()
const paths = {}
for (const name of names) {
  const svg = readFileSync(resolve(assets, `${name}-bold.svg`), 'utf8')
  const d = [...svg.matchAll(/<path d="([^"]+)"\/>/g)].map(m => m[1])
  const shapes = (svg.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/g) ?? []).length
  if (d.length === 0 || d.length !== shapes) throw new Error(`${name}: nur reine <path>-Icons werden unterstützt`)
  paths[name] = d.join(' ')
}

const body = names.map(n => `  '${n}': ${JSON.stringify(paths[n])},`).join('\n')
writeFileSync(
  outTs,
  `// Generiert von tools/phosphor/build-pos-icons.mjs — nicht von Hand ändern (\`pnpm icons:build\`).
// Phosphor Bold (MIT, https://phosphoricons.com), viewBox 0 0 256 256, nur die im POS benutzten Icons.
// Liegt in util-helpers, weil gebaute Libs (orders-data-access) die Registry brauchen, ui-common aber nicht erreichen.
export const ICON_PATHS = {
${body}
} as const satisfies Record<string, string>

export type IconName = keyof typeof ICON_PATHS

/** SVG-Pfad (\`d\`) eines POS-Icons, viewBox 0 0 256 256. */
export const iconPath = (name: IconName): string => ICON_PATHS[name]
`,
)

const rows = Object.entries(MAPPING)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([m, [p, note]]) => `| \`${m}\` | \`${p}\` | ${note} |`)
  .join('\n')
writeFileSync(
  outDoc,
  `---
type: Reference
title: POS-Icons — Mapping Material Symbols → Phosphor Bold
description: Tabelle aller im POS ersetzten Material-Symbols-Namen mit dem gewählten Phosphor-Bold-Icon, den Entscheidungen für fehlende Entsprechungen und der Anleitung, ein Icon zu ergänzen.
tags: [pos-client, icons, design-system]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-22T00:00:00.000Z }
sources:
  - id: generator
    resource: ../../tools/phosphor/build-pos-icons.mjs
    title: Generator dieser Tabelle
---

# POS-Icons: Material Symbols → Phosphor Bold

Der POS zeigt Icons über \`<lib-icon name="…">\` (\`@panary/shared/ui-common\`). Die Komponente zeichnet ein
Inline-SVG aus der Registry in \`@panary/shared/util-helpers\` (\`iconPath()\`), die nur die benutzten Phosphor-Bold-Pfade enthält (${names.length} Icons, kein Font,
kein CDN). Größe folgt \`font-size\` (\`1em\`), Farbe folgt \`currentColor\` — die bisherigen Klassen
(\`text-[1rem]\`, \`text-amber-600\`, \`animate-spin\`) gelten unverändert am \`<lib-icon>\`.

## Neues Icon ergänzen

1. Zeile in \`tools/phosphor/pos-icon-mapping.mjs\` (Material-Name bleibt Schlüssel, damit die Tabelle lückenlos bleibt)
   oder, für ein neues Icon ohne Material-Vorbild, mit dem Phosphor-Namen als Schlüssel.
2. \`pnpm icons:build\` — erzeugt \`icons.generated.ts\` und diese Tabelle neu.
3. Gebaute Libs (z. B. \`orders-data-access\`) können \`ui-common\` nicht importieren und zeichnen das SVG selbst:
   \`<svg viewBox="0 0 256 256" class="size-[1.25em] fill-current" aria-hidden="true"><path [attr.d]="iconPath('x')" /></svg>\`.
4. \`name="…"\` ist über \`IconName\` typgeprüft: ein Tippfehler bricht den Build, es gibt kein leeres Kästchen.

## Fehlende oder gedrehte Entsprechungen (Entscheidung core#824)

- \`merge_type\` (Kombi, in Material gedreht) → \`arrows-merge\`, ohne Drehung.
- \`remove_done\` → \`list-dashes\`: neutrale Liste, die Bedeutung trägt der Text der Taste.
- \`print_disabled\`, \`group_off\`, \`domain_disabled\`, \`search_off\`: kein „durchgestrichen"-Icon in Phosphor Bold;
  der Zustand steht im Text bzw. in der Farbe.

## Tabelle

| Material Symbols | Phosphor Bold | Anmerkung |
|---|---|---|
${rows}
`,
)
console.log(`${names.length} Icons -> ${outTs}`)
