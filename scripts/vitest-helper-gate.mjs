#!/usr/bin/env node
// Vitest-Helfer-Gate: jede Lib, deren `tsconfig.lib.json` per `paths`-Override auf ein
// FREMDES dist zeigt, MUSS in ihrer `vitest.config.mts` `panaryVitestPlugins()` aus
// `tools/vitest/panary-vitest.ts` VOR `nxViteTsPaths()` einhaengen (CLAUDE.md §2.1, #404).
//
// WARUM ES DIESES GATE GIBT
// Der Helfer schuetzt nur, wo er eingebaut ist. Eine neue Lib mit Override faellt sonst
// still durch: `nxViteTsPaths()` laedt, sobald das dist liegt, eine `.d.ts` statt Code, und
// ob ein dist liegt, entscheidet die Task-Reihenfolge — also gruen oder rot je nach Lauf.
// Der `feathers-service`-Generator uebernimmt die `vitest.config.mts` von `@nx/js`
// unveraendert; dieses Gate faengt auch nachtraeglich hinzugekommene Overrides.
//
// WAS ES NICHT MISST
// Libs ohne `vitest.config.*` (kein Test-Target, nichts zu laden) und Overrides, die nicht auf
// ein dist zeigen. Ob der Helfer inhaltlich greift, belegt `tools/vitest/panary-vitest.spec.mjs`.
//
// Aufruf:
//   pnpm vitest-helper:gate

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Override `"@panary/x": ["../…/dist/…"]` — umbruchfest (der Suchbefehl aus dem Leitfaden). */
export const hasDistOverride = tsconfigText =>
  /"@panary\/[^"]+": *\[ *"\.\.\/[^"]*\/dist\//.test(tsconfigText.replace(/\n/g, ''))

/** Steht `panaryVitestPlugins(` im `plugins`-Array vor `nxViteTsPaths(`? */
export const usesHelperBeforeTsPaths = rawConfigText => {
  const configText = rawConfigText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const helper = configText.indexOf('...panaryVitestPlugins()')
  const tsPaths = configText.indexOf('nxViteTsPaths()', configText.indexOf('plugins:'))
  return helper !== -1 && tsPaths !== -1 && helper < tsPaths
}

export function findViolations(root = ROOT, trackedFiles) {
  const files =
    trackedFiles ??
    execFileSync('git', ['ls-files', '*tsconfig.lib.json'], { cwd: root, encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean)
  const violations = []
  let checked = 0
  for (const file of files) {
    if (!hasDistOverride(readFileSync(join(root, file), 'utf-8'))) continue
    const dir = dirname(file)
    const config = ['vitest.config.mts', 'vitest.config.ts'].map(n => join(dir, n)).find(p => existsSync(join(root, p)))
    if (!config) continue
    checked++
    if (!usesHelperBeforeTsPaths(readFileSync(join(root, config), 'utf-8'))) violations.push(config)
  }
  return { checked, violations }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checked, violations } = findViolations()
  if (checked === 0) {
    console.error('vitest-helper-gate: 0 Libs mit dist-Override gefunden — Suche zu eng, das Gate misst nichts.')
    process.exit(1)
  }
  if (violations.length === 0) {
    console.log(`vitest-helper-gate: ${checked} Libs mit dist-Override, alle binden panaryVitestPlugins() ein.`)
    process.exit(0)
  }
  console.error(`vitest-helper-gate: ${violations.length} von ${checked} Libs mit dist-Override ohne Helfer:`)
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    "\nEinbau: import { panaryVitestPlugins } from '<relativ>/tools/vitest/panary-vitest' und\n" +
      '`plugins: [...panaryVitestPlugins(), nxViteTsPaths(), …]` — Regel: CLAUDE.md §2.1.',
  )
  process.exit(1)
}
