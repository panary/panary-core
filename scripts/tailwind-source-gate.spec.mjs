#!/usr/bin/env node
/**
 * Tests fuer tailwind-source-gate.mjs — Aufruf: node scripts/tailwind-source-gate.spec.mjs
 *
 * **Die Fixtures kompilieren echt.** Das Gate misst durch Tailwind hindurch, also
 * muessen seine Tests das auch — eine nachgebaute Glob-Semantik im Test pruefte genau
 * die Annahme, die das Gate bewusst nicht trifft. Die Fixtures liegen deshalb unter
 * `<repo>/.cache/` (gitignored) statt in `os.tmpdir()`: `@import 'tailwindcss'` loest
 * ueber node_modules auf, und die findet Tailwind nur im Repo-Baum.
 *
 * Drei Faelle muss man auseinanderhalten:
 *
 * - **wirkungslos** — der Glob findet nichts (der Bestand vor #1138),
 * - **falsche Dateien** — der Glob findet etwas, aber nicht das Erwartete; nur der
 *   Kanarienvogel schlaegt an,
 * - **Zeile geloescht** — die Zeile ist weg; das faengt die Pruefung gegen die volle
 *   Kompilierung.
 */

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  CANARIES,
  MIN_EXPECTED_CLASSES,
  REPO_ROOT,
  analyzeEntry,
  collectSourceLines,
  extractClasses,
  findEntryFiles,
  hasSourceNone,
} from './tailwind-source-gate.mjs'

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

const FIXTURE_ROOT = join(REPO_ROOT, '.cache', 'tailwind-source-gate-fixtures')

/**
 * Legt einen Fixture-Baum an und liefert den repo-relativen Pfad der Einstiegsdatei.
 *
 * Die Utilities sind arbitraere Werte (`z-[4242]`, `z-[4343]`), die sonst nirgends
 * vorkommen — ein Treffer kann nicht aus einer echten Quelle stammen.
 *
 * 🚨 **Die Basisklasse ist Pflicht, nicht Deko.** Mit `source(none)` und ohne Treffer
 * emittiert Tailwind nur Preflight (reine Element-Selektoren), die Basis waere leer
 * und `only \ base` gleich `only` — der Test koennte nicht mehr unterscheiden, ob das
 * Gate ueberhaupt gegen die Basis rechnet (in cloud am 2026-08-16 per Mutation belegt).
 */
const buildFixture = (name, sourceLines, extension = 'css') => {
  const dir = join(FIXTURE_ROOT, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'pkg', 'alpha', 'src'), { recursive: true })
  mkdirSync(join(dir, 'pkg', 'beta', 'src'), { recursive: true })
  mkdirSync(join(dir, 'css'), { recursive: true })
  writeFileSync(join(dir, 'pkg', 'alpha', 'src', 'a.html'), '<div class="z-[4242]"></div>')
  writeFileSync(join(dir, 'pkg', 'beta', 'src', 'b.spec.ts'), 'const x = "z-[4343]"')
  const entry = join(dir, 'css', `entry.${extension}`)
  const head = extension === 'scss' ? ['@use "sass:math";'] : []
  writeFileSync(
    entry,
    [...head, "@import 'tailwindcss' source(none);", '.fixture-basisklasse { color: red; }', ...sourceLines, ''].join(
      '\n',
    ),
  )
  return relative(REPO_ROOT, entry)
}

const readFixture = entry => readFileSync(join(REPO_ROOT, entry), 'utf8')

console.log('collectSourceLines')

await test('liest Wert und Zeilennummer jeder @source-Zeile', () => {
  const { sources } = collectSourceLines(
    ['@import "tailwindcss";', '@source "./app";', '@source "../libs";'].join('\n'),
  )
  assert.deepEqual(
    sources.map(s => [s.index, s.value]),
    [
      [1, './app'],
      [2, '../libs'],
    ],
  )
})

await test('markiert `@source not` als negativ — dort ist die Beitragspruefung falsch herum', () => {
  const { sources } = collectSourceLines('@source not "./app/legacy";')
  assert.equal(sources[0].negated, true)
  assert.equal(sources[0].value, './app/legacy')
})

await test('meldet eine @source-Zeile ohne abschliessendes Semikolon als unlesbar', () => {
  const { unparsable } = collectSourceLines('@source\n  "./app";')
  assert.equal(unparsable.length, 1)
  assert.equal(unparsable[0].index, 0)
})

console.log('\nhasSourceNone')

await test('erkennt `source(none)` in beiden Anfuehrungszeichen-Formen', () => {
  assert.equal(hasSourceNone("@import 'tailwindcss' source(none);"), true)
  assert.equal(hasSourceNone('@import "tailwindcss" source( none );'), true)
})

await test('lehnt den Bestand vor #1138 ab — CSS ohne Zusatz und SCSS-`@use`', () => {
  assert.equal(hasSourceNone("@import 'tailwindcss';"), false)
  assert.equal(hasSourceNone("@use 'tailwindcss';"), false)
  // Ein Kommentar, der die Form nur nennt, ist kein Import.
  assert.equal(hasSourceNone("/* @import 'tailwindcss' source(none); */\n@import 'tailwindcss';"), false)
})

console.log('\nextractClasses')

await test('zieht Klassennamen und loest Escapes auf', () => {
  const classes = extractClasses('.z-\\[99999\\]{z-index:99999}.grid{display:grid}')
  assert.ok(classes.has('z-[99999]'))
  assert.ok(classes.has('grid'))
})

await test('ignoriert At-Rules — @media zaehlt nicht als Selektor', () => {
  const classes = extractClasses('@media (min-width:40rem){.sm\\:grid{display:grid}}')
  assert.deepEqual([...classes], ['sm:grid'])
})

console.log('\nanalyzeEntry — Fixtures')

await test('ein Glob mit Dateimuster traegt bei', async () => {
  const entry = buildFixture('wirksam', ['@source "../pkg/*/src/**/*.html";'])
  const report = await analyzeEntry(entry, readFixture(entry), [])
  assert.equal(report.results.length, 1)
  assert.ok(report.results[0].added > 0, `erwartet > 0, war ${report.results[0].added}`)
  assert.ok(report.full.has('z-[4242]'))
  assert.ok(report.base > 0, 'die Fixture-Basis muss Klassen enthalten, sonst ist die Beitragsrechnung ungeprueft')
})

await test('der Bestandsfehler schlaegt an: Stern im Verzeichnis-Segment, Ende auf Verzeichnis', async () => {
  const entry = buildFixture('wirkungslos', ['@source "../pkg/*/src";'])
  const report = await analyzeEntry(entry, readFixture(entry), [])
  assert.equal(report.results[0].added, 0)
  assert.equal(report.full.has('z-[4242]'), false)
})

await test('mehrere Zeilen werden einzeln zugeordnet — nur die tote faellt auf', async () => {
  const entry = buildFixture('gemischt', ['@source "../pkg/*/src/**/*.html";', '@source "../pkg/*/src";'])
  const report = await analyzeEntry(entry, readFixture(entry), [])
  assert.ok(report.results[0].added > 0)
  assert.equal(report.results[1].added, 0)
})

await test('negative Zeilen werden uebersprungen statt falsch bewertet', async () => {
  const entry = buildFixture('negativ', ['@source "../pkg/*/src/**/*.html";', '@source not "../pkg/beta/**";'])
  const report = await analyzeEntry(entry, readFixture(entry), [])
  assert.equal(report.results[1].skipped, true)
  assert.equal(report.results.filter(r => r.added === 0).length, 0)
})

await test('SCSS-Einstiege laufen durch sass — wirksam und wirkungslos wie bei CSS', async () => {
  // pos-client ist der einzige SCSS-Einstieg. Ohne sass-Schritt saehe Tailwind
  // `@use`-Regeln und brache ab, bevor es eine Zeile misst.
  const entry = buildFixture('scss', ['@source "../pkg/*/src/**/*.html";', '@source "../pkg/*/src";'], 'scss')
  const report = await analyzeEntry(entry, readFixture(entry), [])
  assert.ok(report.results[0].added > 0)
  assert.equal(report.results[1].added, 0)
  assert.ok(report.full.has('z-[4242]'))
})

console.log('\nanalyzeEntry — Kanarienvoegel')

const canary = (entry, source) => ({ entry, source, className: 'z-[4242]', file: 'fixture a.html', why: 'Fixture' })

await test('gefundener Kanarienvogel erzeugt keinen Befund', async () => {
  const entry = buildFixture('kanarie-ok', ['@source "../pkg/*/src/**/*.html";'])
  const report = await analyzeEntry(entry, readFixture(entry), [canary(entry, '../pkg/*/src/**/*.html')])
  assert.deepEqual(report.canaryMisses, [])
  assert.deepEqual(report.canaryVanished, [])
  assert.deepEqual(report.uncovered, [])
})

await test('fehlender Kanarienvogel schlaegt an, obwohl der Glob beitraegt', async () => {
  // Der Glob findet Dateien (die .spec.ts der beta-Lib), aber nicht die erwartete.
  // Die Beitragspruefung allein waere hier gruen.
  const entry = buildFixture('kanarie-falsche-datei', ['@source "../pkg/*/src/**/*.spec.ts";'])
  const report = await analyzeEntry(entry, readFixture(entry), [canary(entry, '../pkg/*/src/**/*.spec.ts')])
  assert.ok(report.results[0].added > 0, 'der Glob soll etwas finden — sonst prueft der Test die falsche Sache')
  assert.equal(report.canaryMisses.length, 1)
})

await test('geloeschte Zeile: der Kanarienvogel fehlt in der vollen Kompilierung', async () => {
  const entry = buildFixture('kanarie-zeile-weg', ['@source "../pkg/*/src/**/*.spec.ts";'])
  const report = await analyzeEntry(entry, readFixture(entry), [canary(entry, '../pkg/*/src/**/*.html')])
  assert.equal(report.canaryVanished.length, 1)
})

await test('ein Kanarienvogel gilt nur fuer seine Einstiegsdatei', async () => {
  // Alle drei Clients deklarieren `@source "./app"` — ohne Bindung an den Einstieg
  // schluege der Admin-Kanarienvogel im pos-client an.
  const entry = buildFixture('kanarie-fremd', ['@source "../pkg/*/src/**/*.spec.ts";'])
  const report = await analyzeEntry(entry, readFixture(entry), [
    canary('apps/anderer/styles.css', '../pkg/*/src/**/*.spec.ts'),
  ])
  assert.deepEqual(report.canaryMisses, [])
  assert.deepEqual(report.canaryVanished, [])
  assert.equal(report.uncovered.length, 1)
})

console.log('\nEchtbestand')

const ENTRIES = [
  'apps/admin-client/src/styles.css',
  'apps/pos-client/src/styles.scss',
  'apps/setup-client/src/styles.css',
]

await test('findEntryFiles findet genau die drei Clients', () => {
  assert.deepEqual(findEntryFiles().sort(), ENTRIES)
})

for (const entry of ENTRIES) {
  await test(`${entry} laeuft gruen — source(none), jede Zeile traegt bei, jeder Kanarienvogel sitzt`, async () => {
    const css = readFileSync(join(REPO_ROOT, entry), 'utf8')
    assert.equal(hasSourceNone(css), true)
    const report = await analyzeEntry(entry, css)
    assert.deepEqual(report.unparsable, [])
    assert.ok(report.total >= MIN_EXPECTED_CLASSES, `nur ${report.total} Klassen, Untergrenze ${MIN_EXPECTED_CLASSES}`)
    assert.deepEqual(
      report.results.filter(item => !item.skipped && item.added === 0).map(item => item.raw.trim()),
      [],
    )
    assert.deepEqual(
      [...report.canaryMisses, ...report.canaryVanished].map(c => c.className),
      [],
    )
  })
}

await test('jeder Kanarienvogel ist einer Quelle seiner Einstiegsdatei zugeordnet', () => {
  const orphans = CANARIES.filter(item => {
    const css = readFileSync(join(REPO_ROOT, item.entry), 'utf8')
    return !collectSourceLines(css).sources.some(source => source.value === item.source)
  })
  assert.deepEqual(
    orphans.map(c => `${c.entry}: ${c.className} → ${c.source}`),
    [],
  )
})

rmSync(FIXTURE_ROOT, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\nAlle Tests gruen.')
