#!/usr/bin/env node
/**
 * pos-px-audit — größenrelevante px-Werte im POS-Scope finden (PNRY-FEAT-POS-UI-SCALE-001)
 *
 * Die fluide UI-Skalierung des POS-Clients basiert auf rem-Werten relativ zur
 * Root-Fontsize. Harte px-Werte in Größen-Deklarationen skalieren nicht mit und
 * sind deshalb Regressionen. Dieses Script scannt den POS-Scope und meldet:
 *   (a) Tailwind-Arbitrary-Values mit px in größenrelevanten Utilities (z. B. h-[64px])
 *   (b) CSS-Deklarationen mit px für font-size, padding, margin, height, width,
 *       min-/max-*, gap, top/right/bottom/left, line-height, flex-basis
 *
 * Bewusst NICHT gemeldet (Whitelist):
 *   - border-, outline-, box-shadow-, text-shadow-, backdrop-filter-,
 *     letter-spacing- und stroke-width-Deklarationen (Hairlines/Effekte)
 *   - exakte 1px-Werte
 *   - max()-Ausdrücke mit 48px-Floor (Touch-Untergrenze)
 *   - @media-Zeilen (Breakpoints bleiben px)
 *   - Zeilen mit Marker-Kommentar `px-ok` (/* px-ok *\/ bzw. <!-- px-ok -->)
 *
 * Verwendung (aus panary-core/):
 *   node tools/pos-px-audit.mjs      # oder: pnpm audit:pos-px
 *
 * Exit-Code: 1 bei Findings, 0 wenn clean.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(new URL('.', import.meta.url)))

const FILE_EXTENSIONS = ['.html', '.scss', '.ts']
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.nx', 'target'])

/* Größenrelevante Tailwind-Utility-Präfixe für Arbitrary-Values mit px */
const TAILWIND_SIZE_PREFIXES = [
  'min-h',
  'min-w',
  'max-h',
  'max-w',
  'grid-cols',
  'grid-rows',
  'translate-x',
  'translate-y',
  'translate',
  'inset-x',
  'inset-y',
  'inset',
  'leading',
  'basis',
  'size',
  'gap-x',
  'gap-y',
  'gap',
  'text',
  'top',
  'right',
  'bottom',
  'left',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'p',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'm',
  'h',
  'w',
]

/* Größenrelevante CSS-Properties (Whitelist-Properties wie border/box-shadow fehlen bewusst) */
const CSS_SIZE_PROPERTIES = [
  'font-size',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'height',
  'width',
  'min-height',
  'min-width',
  'max-height',
  'max-width',
  'gap',
  'row-gap',
  'column-gap',
  'top',
  'right',
  'bottom',
  'left',
  'line-height',
  'flex-basis',
]

const tailwindRegex = new RegExp(
  `(?:^|[\\s"'\`(:])-?(?:${TAILWIND_SIZE_PREFIXES.join('|')})-\\[[^\\]]*\\d+px[^\\]]*\\]`,
  'g',
)

/* Angular-Style-Bindings mit px-Einheit ([style.width.px]="100", [style.top.px]=…) —
   umgehen sonst beide anderen Muster, weil der Zahlenwert ohne px-Suffix im Binding steht */
const styleBindingPxRegex = /\[style\.[a-zA-Z-]+\.px\]\s*=/g

const cssRegex = new RegExp(`(?:^|[;{\\s])(?:${CSS_SIZE_PROPERTIES.join('|')})\\s*:\\s*[^;}\\n]*\\d+px[^;}\\n]*`, 'gi')

/** true, wenn der Fund über die Whitelist entschärft ist */
const isWhitelisted = (line, match) => {
  if (line.includes('px-ok')) return true
  if (/@media/.test(line)) return true
  /* max()-Ausdruck mit 48px-Floor (Touch-Untergrenze) ist bewusst px-basiert */
  if (match.includes('max(') && match.includes('48px')) return true
  /* Nur exakte 1px-Werte (Hairlines) — jede andere px-Zahl bleibt ein Finding */
  const pxValues = [...match.matchAll(/(\d*\.?\d+)px/g)].map(m => Number(m[1]))
  if (pxValues.length > 0 && pxValues.every(v => v === 1)) return true
  return false
}

const walk = (dir, files = []) => {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(join(dir, entry.name), files)
    } else if (FILE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

/* Scope: POS-App, POS-Libs und feature-pos-* der Domains — nur src-Verzeichnisse */
const collectScopeFiles = () => {
  const files = []
  walk(join(repoRoot, 'apps/pos-client/src'), files)
  /* libs/apps/pos-client/**\/src/** — nur Dateien unterhalb eines src/-Ordners */
  const posLibFiles = walk(join(repoRoot, 'libs/apps/pos-client'))
  files.push(...posLibFiles.filter(f => f.split('/').includes('src')))
  /* libs/domains/<domain>/feature-pos-*\/src/** */
  const domainsDir = join(repoRoot, 'libs/domains')
  let domains = []
  try {
    domains = readdirSync(domainsDir, { withFileTypes: true }).filter(e => e.isDirectory())
  } catch {
    /* kein libs/domains — Scope bleibt leer */
  }
  for (const domain of domains) {
    const domainPath = join(domainsDir, domain.name)
    const children = readdirSync(domainPath, { withFileTypes: true })
    for (const child of children) {
      /* 'feature-pos' ohne Suffix (z. B. products/feature-pos) gehört ebenfalls zum Scope */
      if (child.isDirectory() && (child.name === 'feature-pos' || child.name.startsWith('feature-pos-'))) {
        walk(join(domainPath, child.name, 'src'), files)
      }
    }
  }
  return files
}

const findings = []
for (const file of collectScopeFiles()) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    for (const regex of [tailwindRegex, cssRegex, styleBindingPxRegex]) {
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(line)) !== null) {
        const snippet = match[0].trim()
        if (!isWhitelisted(line, snippet)) {
          findings.push({ file: relative(repoRoot, file), line: index + 1, snippet })
        }
      }
    }
  })
}

if (findings.length === 0) {
  console.log('pos-px-audit: keine größenrelevanten px-Findings im POS-Scope.')
  process.exit(0)
}

for (const f of findings) {
  console.log(`${f.file}:${f.line}  ${f.snippet}`)
}

/* Zusammenfassung je Top-Scope — macht sichtbar, welche Pakete noch aufräumen müssen */
const byScope = new Map()
for (const f of findings) {
  const scope = f.file
    .split('/')
    .slice(0, f.file.startsWith('libs/domains') ? 4 : 3)
    .join('/')
  byScope.set(scope, (byScope.get(scope) ?? 0) + 1)
}
console.log(`\npos-px-audit: ${findings.length} Finding(s) gesamt`)
for (const [scope, count] of [...byScope.entries()].sort()) {
  console.log(`  ${scope}: ${count}`)
}
process.exit(1)
