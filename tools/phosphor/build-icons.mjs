#!/usr/bin/env node
// Erzeugt je Oberfläche eine Icon-Registry (nur benötigte Phosphor-Pfade) und die Mapping-Tabelle der Doku:
// POS in Phosphor Bold (core#824), Core-Admin in Phosphor Regular (core#825). Getrennte Registries, damit der POS
// keine Admin-Pfade mitbündelt (Initial-Budget, core#805). Quelle: *-icon-mapping.mjs + @phosphor-icons/core
// (devDependency). Kein Runtime-Paket, kein CDN.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAPPING as ADMIN_MAPPING } from './admin-icon-mapping.mjs'
import { MAPPING as POS_MAPPING } from './pos-icon-mapping.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const posDoc = count => `---
type: Reference
title: POS-Icons — Mapping Material Symbols → Phosphor Bold
description: Tabelle aller im POS ersetzten Material-Symbols-Namen mit dem gewählten Phosphor-Bold-Icon, den Entscheidungen für fehlende Entsprechungen und der Anleitung, ein Icon zu ergänzen.
tags: [pos-client, icons, design-system]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-22T00:00:00.000Z }
sources:
  - id: generator
    resource: ../../tools/phosphor/build-icons.mjs
    title: Generator dieser Tabelle
---

# POS-Icons: Material Symbols → Phosphor Bold

Der POS zeigt Icons über \`<lib-icon name="…">\` (\`@panary/shared/ui-common\`). Die Komponente zeichnet ein
Inline-SVG aus der Registry in \`@panary/shared/util-helpers\` (\`iconPath()\`), die nur die benutzten Phosphor-Bold-Pfade enthält (${count} Icons, kein Font,
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
`

const adminDoc = count => `---
type: Reference
title: Admin-Icons — Mapping Material Symbols → Phosphor Regular
description: Tabelle aller im Core-Admin ersetzten Material-Symbols-Namen mit dem gewählten Phosphor-Regular-Icon, Abgrenzung zur POS-Registry und Anleitung, ein Icon zu ergänzen.
tags: [admin-client, icons, design-system]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-22T00:00:00.000Z }
sources:
  - id: generator
    resource: ../../tools/phosphor/build-icons.mjs
    title: Generator dieser Tabelle
  - id: pos-mapping
    resource: ./pos-icon-mapping.md
    title: POS-Icons (Phosphor Bold)
---

# Admin-Icons: Material Symbols → Phosphor Regular

Der Core-Admin (\`apps/admin-client\`) zeigt Icons über \`<app-icon name="…">\`
(\`apps/admin-client/src/app/shared/icon/icon.ts\`). Die Komponente zeichnet ein Inline-SVG aus der
App-eigenen Registry \`icons.generated.ts\` daneben, die nur die benutzten Phosphor-Regular-Pfade enthält
(${count} Icons, kein Font, kein CDN). Größe folgt \`font-size\` (\`1em\`), Farbe folgt \`currentColor\`.
Die Material-Symbols-Schrift ist aus dem Admin entfernt.

## Warum eine eigene Registry statt \`<lib-icon>\`

\`<lib-icon>\` (\`@panary/shared/ui-common\`) zeichnet Phosphor **Bold** für den POS. Eine gemeinsame
Registry mit beiden Gewichten legte jeden Admin-Pfad in das POS-Initial-Bundle, das am Budget steht
(core#805). Die Admin-Registry liegt deshalb in der App selbst und erreicht den POS nie. Die Zuordnung
Material → Phosphor übernimmt der Admin, wo der POS sie schon getroffen hat (\`FROM_POS\` in
\`tools/phosphor/admin-icon-mapping.mjs\`) — beide Oberflächen sprechen dieselbe Bildsprache, nur das
Gewicht unterscheidet sich.

Geteilte Komponenten aus Libs, die \`<lib-icon>\` nutzen (Cloud-Status-Banner aus
\`@panary/shared/ui-cloud-status\`), zeigen auch im Admin Bold.

## Neues Icon ergänzen

1. Material-Name in \`FROM_POS\` aufnehmen, wenn der POS ihn schon abbildet; sonst Zeile in \`ADMIN_ONLY\`
   (\`tools/phosphor/admin-icon-mapping.mjs\`).
2. \`pnpm icons:build\` — erzeugt die Registry und diese Tabelle neu.
3. \`name="…"\` ist über \`AdminIconName\` typgeprüft: ein Tippfehler bricht den Build, es gibt kein leeres Kästchen.

## Tabelle

| Material Symbols | Phosphor Regular | Anmerkung |
|---|---|---|
`

const TARGETS = [
  {
    label: 'POS',
    mapping: POS_MAPPING,
    weight: 'bold',
    outTs: 'libs/shared/util-helpers/src/lib/icons.generated.ts',
    outDoc: 'docs/references/pos-icon-mapping.md',
    tsHeader: `// Generiert von tools/phosphor/build-icons.mjs — nicht von Hand ändern (\`pnpm icons:build\`).
// Phosphor Bold (MIT, https://phosphoricons.com), viewBox 0 0 256 256, nur die im POS benutzten Icons.
// Liegt in util-helpers, weil gebaute Libs (orders-data-access) die Registry brauchen, ui-common aber nicht erreichen.
export const ICON_PATHS = {`,
    tsFooter: `} as const satisfies Record<string, string>

export type IconName = keyof typeof ICON_PATHS

/** SVG-Pfad (\`d\`) eines POS-Icons, viewBox 0 0 256 256. */
export const iconPath = (name: IconName): string => ICON_PATHS[name]
`,
    doc: posDoc,
  },
  {
    label: 'Admin',
    mapping: ADMIN_MAPPING,
    weight: 'regular',
    outTs: 'apps/admin-client/src/app/shared/icon/icons.generated.ts',
    outDoc: 'docs/references/admin-icon-mapping.md',
    tsHeader: `// Generiert von tools/phosphor/build-icons.mjs — nicht von Hand ändern (\`pnpm icons:build\`).
// Phosphor Regular (MIT, https://phosphoricons.com), viewBox 0 0 256 256, nur die im Core-Admin benutzten Icons.
// Liegt in der App, damit kein Admin-Pfad ins POS-Bundle gerät (POS-Registry: @panary/shared/util-helpers).
export const ADMIN_ICON_PATHS = {`,
    tsFooter: `} as const satisfies Record<string, string>

export type AdminIconName = keyof typeof ADMIN_ICON_PATHS
`,
    doc: adminDoc,
  },
]

const svgFile = (weight, name) =>
  resolve(
    root,
    'node_modules/@phosphor-icons/core/assets',
    weight,
    weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`,
  )

function readPath(weight, name) {
  const svg = readFileSync(svgFile(weight, name), 'utf8')
  const d = [...svg.matchAll(/<path d="([^"]+)"\/>/g)].map(m => m[1])
  const shapes = (svg.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/g) ?? []).length
  if (d.length === 0 || d.length !== shapes)
    throw new Error(`${name} (${weight}): nur reine <path>-Icons werden unterstützt`)
  return d.join(' ')
}

for (const target of TARGETS) {
  const names = [...new Set(Object.values(target.mapping).map(([p]) => p))].sort()
  const body = names.map(n => `  '${n}': ${JSON.stringify(readPath(target.weight, n))},`).join('\n')
  writeFileSync(resolve(root, target.outTs), `${target.tsHeader}\n${body}\n${target.tsFooter}`)

  const rows = Object.entries(target.mapping)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, [p, note]]) => `| \`${m}\` | \`${p}\` | ${note} |`)
    .join('\n')
  writeFileSync(resolve(root, target.outDoc), `${target.doc(names.length)}${rows}\n`)
  console.log(`${target.label}: ${names.length} Icons -> ${target.outTs}`)
}
