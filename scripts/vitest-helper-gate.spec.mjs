#!/usr/bin/env node
/**
 * Tests fuer vitest-helper-gate.mjs — reines Node-Skript, Aufruf steht VOR dem Gate in der CI
 * (gleiche Begruendung wie bei den uebrigen Gate-Specs).
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findViolations, hasDistOverride, usesHelperBeforeTsPaths } from './vitest-helper-gate.mjs'

let failures = 0
const test = (name, fn) => {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures++
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

const OVERRIDE =
  '{\n "compilerOptions": { "paths": {\n  "@panary/users/domain":\n   [\n    "../../users/domain/dist/index.d.ts"\n   ]\n } }\n}'
const SOURCE_PATH =
  '{ "compilerOptions": { "paths": { "@panary/users/domain": ["../../users/domain/src/index.ts"] } } }'
const OUT_DIR = '{ "compilerOptions": { "outDir": "../../../dist/out-tsc" } }'
const WITH_HELPER = "plugins: [...panaryVitestPlugins(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],"
const WITHOUT_HELPER = "plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],"
const WRONG_ORDER = 'plugins: [nxViteTsPaths(), ...panaryVitestPlugins()],'

test('hasDistOverride erkennt den Override auch bei Zeilenumbruechen', () => {
  assert.equal(hasDistOverride(OVERRIDE), true)
})

test('hasDistOverride: Quell-Pfad und outDir sind kein Override', () => {
  assert.equal(hasDistOverride(SOURCE_PATH), false)
  assert.equal(hasDistOverride(OUT_DIR), false)
})

test('usesHelperBeforeTsPaths: mit Helfer davor ok, ohne und in falscher Reihenfolge nicht', () => {
  assert.equal(usesHelperBeforeTsPaths(WITH_HELPER), true)
  assert.equal(usesHelperBeforeTsPaths(WITHOUT_HELPER), false)
  assert.equal(usesHelperBeforeTsPaths(WRONG_ORDER), false)
})

test('usesHelperBeforeTsPaths: ein Kommentar mit dem Namen genuegt nicht', () => {
  assert.equal(usesHelperBeforeTsPaths(`// panaryVitestPlugins() fehlt\n${WITHOUT_HELPER}`), false)
})

test('findViolations: meldet nur Libs mit Override, Config und fehlendem Helfer', () => {
  const root = mkdtempSync(join(tmpdir(), 'vitest-helper-gate-'))
  try {
    const lib = (name, tsconfig, vitest) => {
      mkdirSync(join(root, name), { recursive: true })
      writeFileSync(join(root, name, 'tsconfig.lib.json'), tsconfig)
      if (vitest) writeFileSync(join(root, name, 'vitest.config.mts'), vitest)
      return `${name}/tsconfig.lib.json`
    }
    const files = [
      lib('gut', OVERRIDE, WITH_HELPER),
      lib('schlecht', OVERRIDE, WITHOUT_HELPER),
      lib('ohne-override', SOURCE_PATH, WITHOUT_HELPER),
      lib('ohne-config', OVERRIDE, null),
    ]
    const { checked, violations } = findViolations(root, files)
    assert.equal(checked, 2)
    assert.deepEqual(violations, ['schlecht/vitest.config.mts'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('findViolations: im echten Repo bindet jede Lib mit Override den Helfer ein', () => {
  const { checked, violations } = findViolations()
  assert.ok(checked >= 20, `nur ${checked} Libs gefunden — Suche zu eng?`)
  assert.deepEqual(violations, [])
})

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\nvitest-helper-gate.spec.mjs: alle Tests bestanden.')
