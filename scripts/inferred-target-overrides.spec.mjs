#!/usr/bin/env node
/**
 * Tests fuer inferred-target-overrides.mjs.
 *
 * Bewusst ein reines Node-Skript und kein Vitest-Spec — gleiche Begruendung wie bei
 * `empty-test-targets.spec.mjs` und `docs-log.spec.mjs`: `vitest.workspace.ts` globt
 * nur `**\/vite.config.*` und `**\/vitest.config.*`, kein Projekt schliesst `scripts/`
 * ein. Der Aufruf steht deshalb explizit in der CI, und zwar VOR dem Gate selbst.
 *
 * Der Kern dieser Tests ist das Auslesen der Target-Namen aus nx.json. Genau dort
 * sitzt der Fehler, gegen den das Gate gebaut wurde: In #204 hiess das inferierte
 * Lint-Target `eslint:lint`, waehrend CI und Gewohnheit `lint` riefen — 40 Projekte
 * wurden nie gelintet, und niemand sah es. Ein Gate, das die Namen hartkodiert,
 * bewacht nach der naechsten Umbenennung still den falschen Namen und meldet
 * weiterhin gruen. Deshalb wird hier vor allem geprueft, dass die Namen aus der
 * Konfiguration kommen und dass eine unlesbare Konfiguration NICHT als "sauber"
 * durchgeht.
 */

import assert from 'node:assert/strict'

import {
  ERLAUBTE_EXECUTOREN,
  findOverrides,
  inferredTargetNames,
  protectedTargetNames,
  UNGESCHUETZT,
} from './inferred-target-overrides.mjs'

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

/** Die reale Plugin-Struktur aus panary-core, gekuerzt auf das Wesentliche. */
const NX_JSON = {
  plugins: [
    {
      plugin: '@nx/js/typescript',
      options: {
        typecheck: { targetName: 'typecheck' },
        build: {
          targetName: 'build',
          configName: 'tsconfig.lib.json',
          buildDepsName: 'build-deps',
          watchDepsName: 'watch-deps',
        },
      },
    },
    { plugin: '@nx/eslint/plugin', options: { targetName: 'lint' } },
    { plugin: '@nx/vitest', options: { testTargetName: 'test', ciTargetName: 'test-ci', testMode: 'watch' } },
  ],
}

console.log('inferredTargetNames()')

test('findet die Namen aller drei Plugins, auch eine Ebene tief', () => {
  assert.deepEqual([...inferredTargetNames(NX_JSON)].sort(), [
    'build',
    'build-deps',
    'lint',
    'test',
    'test-ci',
    'typecheck',
    'watch-deps',
  ])
})

test('nimmt configName und testMode NICHT fuer Target-Namen', () => {
  const namen = inferredTargetNames(NX_JSON)
  assert.equal(namen.has('tsconfig.lib.json'), false, 'configName darf kein Target-Name sein')
  assert.equal(namen.has('watch'), false, 'testMode darf kein Target-Name sein')
})

test('zieht bei einer Umbenennung mit — der Fall aus #204', () => {
  const umbenannt = { plugins: [{ plugin: '@nx/eslint/plugin', options: { targetName: 'eslint:lint' } }] }
  assert.equal(inferredTargetNames(umbenannt).has('eslint:lint'), true)
  assert.equal(inferredTargetNames(umbenannt).has('lint'), false)
})

test('liefert leer, wenn der plugins-Block fehlt — die Plausibilitaetssperre greift darauf', () => {
  assert.equal(inferredTargetNames({}).size, 0)
  assert.equal(inferredTargetNames({ plugins: [] }).size, 0)
})

console.log('protectedTargetNames()')

test('nimmt nur build aus, behaelt den Rest inklusive test', () => {
  assert.deepEqual([...protectedTargetNames(NX_JSON)].sort(), [
    'build-deps',
    'lint',
    'test',
    'test-ci',
    'typecheck',
    'watch-deps',
  ])
})

test('UNGESCHUETZT bleibt klein — jeder Eintrag ist aufgegebene Abdeckung', () => {
  assert.deepEqual([...UNGESCHUETZT].sort(), ['build'])
})

test('ERLAUBTE_EXECUTOREN ist festgenagelt — Wachstum ist stille Abdeckungsaufgabe', () => {
  assert.deepEqual(ERLAUBTE_EXECUTOREN, { test: ['@angular/build:unit-test'] })
})

console.log('findOverrides()')

const geschuetzt = protectedTargetNames(NX_JSON)

test('findet das explizite lint-Target aus #206', () => {
  const treffer = findOverrides(
    [{ datei: 'libs/x/project.json', inhalt: { name: 'x', targets: { lint: { executor: '@nx/eslint:lint' } } } }],
    geschuetzt,
  )
  assert.equal(treffer.length, 1)
  assert.equal(treffer[0].projekt, 'x')
  assert.equal(treffer[0].target, 'lint')
  assert.equal(treffer[0].executor, '@nx/eslint:lint')
})

test('laesst ein konfiguriertes build-Target durch (rollup, angular:package …)', () => {
  const treffer = findOverrides(
    [
      {
        datei: 'libs/y/project.json',
        inhalt: { name: 'y', targets: { build: { executor: '@nx/rollup:rollup', options: { main: 'src/index.ts' } } } },
      },
    ],
    geschuetzt,
  )
  assert.deepEqual(treffer, [])
})

test('laesst das Angular-test-Target der Apps durch (Executor-Allowlist)', () => {
  const treffer = findOverrides(
    [
      {
        datei: 'apps/a/project.json',
        inhalt: { name: 'a', targets: { test: { executor: '@angular/build:unit-test', options: {} } } },
      },
    ],
    geschuetzt,
  )
  assert.deepEqual(treffer, [])
})

test('faengt das @nx/vite:test-Target — die teure Drift aus #213', () => {
  const treffer = findOverrides(
    [
      {
        datei: 'libs/domains/businessdays/aggregator/project.json',
        inhalt: {
          name: 'businessdays-aggregator',
          targets: { test: { executor: '@nx/vite:test', options: { configFile: 'vitest.config.ts' } } },
        },
      },
    ],
    geschuetzt,
  )
  assert.equal(treffer.length, 1)
  assert.equal(treffer[0].target, 'test')
  assert.equal(treffer[0].executor, '@nx/vite:test')
})

test('die Allowlist gilt je Target-Name, nicht global', () => {
  // Derselbe Executor unter einem anderen geschuetzten Namen bleibt ein Treffer —
  // sonst wuerde eine Ausnahme fuer `test` versehentlich `lint` mitoeffnen.
  const treffer = findOverrides(
    [{ datei: 'a/project.json', inhalt: { name: 'a', targets: { lint: { executor: '@angular/build:unit-test' } } } }],
    geschuetzt,
  )
  assert.equal(treffer.length, 1, 'Allowlist von test darf lint nicht freigeben')
})

test('ein Target ohne executor faellt nicht versehentlich unter die Allowlist', () => {
  const treffer = findOverrides([{ datei: 'a/project.json', inhalt: { name: 'a', targets: { test: {} } } }], geschuetzt)
  assert.equal(treffer.length, 1)
  assert.equal(treffer[0].executor, '(ohne executor)')
})

test('greift unabhaengig von den Optionen — auch ein konfiguriertes lint faellt auf', () => {
  const treffer = findOverrides(
    [
      {
        datei: 'libs/z/project.json',
        inhalt: { name: 'z', targets: { lint: { executor: 'x', options: { fix: true } } } },
      },
    ],
    geschuetzt,
  )
  assert.equal(treffer.length, 1, 'auch mit Optionen ueberschreibt es die Inferenz')
})

test('kommt ohne targets-Schluessel und ohne name aus', () => {
  assert.deepEqual(findOverrides([{ datei: 'a/project.json', inhalt: { name: 'a' } }], geschuetzt), [])
  const ohneName = findOverrides([{ datei: 'b/project.json', inhalt: { targets: { typecheck: {} } } }], geschuetzt)
  assert.equal(ohneName[0].projekt, '(ohne name)')
  assert.equal(ohneName[0].executor, '(ohne executor)')
})

test('meldet mehrere Treffer stabil sortiert', () => {
  const treffer = findOverrides(
    [
      { datei: 'b/project.json', inhalt: { name: 'zeta', targets: { lint: {} } } },
      { datei: 'a/project.json', inhalt: { name: 'alpha', targets: { typecheck: {}, lint: {} } } },
    ],
    geschuetzt,
  )
  assert.deepEqual(
    treffer.map(t => `${t.projekt}:${t.target}`),
    ['alpha:lint', 'alpha:typecheck', 'zeta:lint'],
  )
})

console.log(failures === 0 ? '\nAlle Tests gruen.' : `\n${failures} Test(s) fehlgeschlagen.`)
process.exit(failures === 0 ? 0 : 1)
