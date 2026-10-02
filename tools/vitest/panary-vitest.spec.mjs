#!/usr/bin/env node
/**
 * Tests fuer tools/vitest/panary-vitest.ts — reines Node-Skript, Aufruf steht in der CI.
 *
 * Der Helfer soll stilles Gruen verhindern; faellt er selbst still aus, merkt es niemand.
 * Die TS-Datei wird mit dem TypeScript-Compiler nach CommonJS uebersetzt und mit dem
 * echten `__dirname` des Helfers geladen, damit der Resolver die echte `tsconfig.base.json` liest.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const { outputText } = ts.transpileModule(readFileSync(join(HERE, 'panary-vitest.ts'), 'utf-8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const mod = { exports: {} }
new Function('require', 'module', 'exports', '__dirname', outputText)(require, mod, mod.exports, HERE)
const { panarySourcesForVitest, forbidDeclarationLoads, panaryVitestPlugins } = mod.exports

let failures = 0
const test = async (name, fn) => {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures++
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

const baseText = readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf-8')
const basePaths = JSON.parse(baseText.replace(/^\s*\/\/.*$/gm, '')).compilerOptions.paths

await test('panaryVitestPlugins: Resolver zuerst, dann Waechter, beide enforce pre', () => {
  const plugins = panaryVitestPlugins()
  assert.deepEqual(
    plugins.map(p => p.name),
    ['panary-sources-for-vitest', 'panary-forbid-declaration-loads'],
  )
  assert.ok(plugins.every(p => p.enforce === 'pre'))
})

await test('Resolver: jeder @panary/*-Schluessel zeigt exakt auf die Quelle aus tsconfig.base.json', () => {
  const resolver = panarySourcesForVitest()
  const keys = Object.keys(basePaths).filter(k => k.startsWith('@panary/'))
  assert.ok(keys.length > 20, `nur ${keys.length} Schluessel — tsconfig.base.json falsch gelesen?`)
  for (const key of keys) assert.equal(resolver.resolveId(key), join(ROOT, basePaths[key][0]), key)
})

await test('Resolver: Unterpfade und fremde Importe bleiben unberuehrt (kein Alias-Verhalten, #402)', () => {
  const resolver = panarySourcesForVitest()
  assert.equal(resolver.resolveId('@panary/users/domain/unterpfad'), null)
  assert.equal(resolver.resolveId('vitest'), null)
  assert.equal(resolver.resolveId('./src/index'), null)
})

await test('Waechter: .d.ts, .d.mts und .d.cts brechen ab, mit Datei, Importeur und Regelverweis', async () => {
  const guard = forbidDeclarationLoads()
  const id = '/w/libs/domains/users/domain/dist/index.d.ts'
  const ctx = { resolve: async () => ({ id }) }
  await guard.resolveId.call(ctx, '@panary/users/domain', '/w/libs/x/src/a.spec.ts', {})
  assert.throws(
    () => guard.load(id),
    error => error.message.includes(id) && error.message.includes('/w/libs/x/src/a.spec.ts') && error.message.includes('CLAUDE.md §2.1'),
  )
  for (const ext of ['d.mts', 'd.cts']) assert.throws(() => guard.load(`/w/dist/index.${ext}`), /Typdatei/)
})

await test('Waechter: eine .d.ts mit Query-String bricht ebenfalls ab', () => {
  assert.throws(() => forbidDeclarationLoads().load('/w/dist/index.d.ts?v=123'), /Typdatei/)
})

await test('Waechter: normale Quellen laufen durch, auch Namen mit „d.ts“ im Wortinneren', () => {
  const guard = forbidDeclarationLoads()
  for (const id of ['/w/src/index.ts', '/w/src/odd.tsx', '/w/src/add.ts.json', '/w/src/foo.d.tsx.ts'])
    assert.equal(guard.load(id), null, id)
})

await test('Waechter: ohne Importer-Wissen meldet er „(unbekannt)“ statt zu scheitern', () => {
  assert.throws(() => forbidDeclarationLoads().load('/w/dist/index.d.ts'), /Importeur: \(unbekannt\)/)
})

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\npanary-vitest.spec.mjs: alle Tests bestanden.')
