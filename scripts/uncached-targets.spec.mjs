#!/usr/bin/env node
/**
 * Tests fuer uncached-targets.mjs.
 *
 * Bewusst ein reines Node-Skript und kein Vitest-Spec — gleiche Begruendung wie bei
 * `empty-test-targets.spec.mjs` und `inferred-target-overrides.spec.mjs`:
 * `vitest.workspace.ts` globt nur `**\/vite.config.*` und `**\/vitest.config.*`, kein
 * Projekt schliesst `scripts/` ein. Der Aufruf steht deshalb explizit in der CI, VOR
 * dem Gate.
 *
 * Der Kern dieser Tests ist die Entscheidungslogik `istUngecachtMitAusgaben`. Sie hat
 * drei Wege, ein Target freizusprechen (keine outputs / lokales cache / targetDefaults),
 * und jeder davon ist eine Moeglichkeit, versehentlich zu viel durchzulassen. Ein Gate,
 * das zu viel freispricht, meldet gruen und misst nichts — derselbe Fehler, den das
 * Ueberschreibungs-Gate in #210 beim ersten Versuch gemacht hat (grosses T in
 * `testTargetName`).
 */

import assert from 'node:assert/strict'

import { collectUncached, diffAgainstBaseline, istUngecachtMitAusgaben } from './uncached-targets.mjs'

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

/** Der reale targetDefaults-Block aus panary-core, gekuerzt. */
const DEFAULTS = {
  '@nx/js:tsc': { cache: true, dependsOn: ['^build'], inputs: ['production', '^production'] },
  '@nx/rollup:rollup': { cache: true, dependsOn: ['^build'], inputs: ['production', '^production'] },
}

console.log('istUngecachtMitAusgaben()')

test('faengt den Fall aus #216: outputs, kein cache, kein targetDefaults', () => {
  const t = { executor: '@nx/angular:package', outputs: ['{workspaceRoot}/libs/x/dist'] }
  assert.equal(istUngecachtMitAusgaben(t, DEFAULTS), true)
})

test('spricht frei, wenn der Executor einen targetDefaults-Eintrag mit cache:true hat', () => {
  const t = { executor: '@nx/rollup:rollup', outputs: ['{workspaceRoot}/libs/x/dist'] }
  assert.equal(istUngecachtMitAusgaben(t, DEFAULTS), false)
})

test('ein targetDefaults-Eintrag OHNE cache:true spricht NICHT frei', () => {
  const defaults = { 'x:y': { dependsOn: ['^build'] } }
  const t = { executor: 'x:y', outputs: ['out'] }
  assert.equal(istUngecachtMitAusgaben(t, defaults), true, 'nur cache:true zaehlt, nicht die blosse Existenz')
})

test('lokales cache:true spricht frei', () => {
  assert.equal(istUngecachtMitAusgaben({ executor: 'x:y', outputs: ['out'], cache: true }, {}), false)
})

test('lokales cache:false spricht ebenfalls frei — bewusst abgeschaltet ist eine Antwort', () => {
  assert.equal(istUngecachtMitAusgaben({ executor: 'x:y', outputs: ['out'], cache: false }, {}), false)
})

test('ohne outputs kein Fund — Caching braeuchte dort nichts wiederherzustellen', () => {
  assert.equal(istUngecachtMitAusgaben({ executor: 'x:y' }, {}), false)
  assert.equal(istUngecachtMitAusgaben({ executor: 'x:y', outputs: [] }, {}), false)
})

test('outputs ohne executor gilt als Fund, nicht als Freispruch', () => {
  assert.equal(istUngecachtMitAusgaben({ outputs: ['out'] }, DEFAULTS), true)
})

test('kommt mit fehlender Definition und fehlenden Defaults klar', () => {
  assert.equal(istUngecachtMitAusgaben(undefined, DEFAULTS), false)
  assert.equal(istUngecachtMitAusgaben({ executor: 'x:y', outputs: ['out'] }, undefined), true)
})

console.log('collectUncached()')

test('bildet <projekt>:<target> und sortiert stabil', () => {
  const treffer = collectUncached(
    [
      { datei: 'b/project.json', inhalt: { name: 'zeta', targets: { build: { executor: 'e', outputs: ['o'] } } } },
      {
        datei: 'a/project.json',
        inhalt: {
          name: 'alpha',
          targets: { build: { executor: 'e', outputs: ['o'] }, docs: { executor: 'e', outputs: ['o'] } },
        },
      },
    ],
    {},
  )
  assert.deepEqual(
    treffer.map(t => t.id),
    ['alpha:build', 'alpha:docs', 'zeta:build'],
  )
})

test('prueft ALLE Targets, nicht nur build — der naechste Fall kann anders heissen', () => {
  // #213 war ein test-Target, #216 ein build-Target. Eine Einschraenkung auf `build`
  // haette den naechsten Fall wieder uebersehen.
  const treffer = collectUncached(
    [
      {
        datei: 'a/project.json',
        inhalt: { name: 'a', targets: { test: { executor: '@nx/vite:test', outputs: ['cov'] } } },
      },
    ],
    DEFAULTS,
  )
  assert.deepEqual(
    treffer.map(t => t.id),
    ['a:test'],
  )
})

test('ueberspringt Projekte ohne targets', () => {
  assert.deepEqual(collectUncached([{ datei: 'a/project.json', inhalt: { name: 'a' } }], {}), [])
})

console.log('diffAgainstBaseline()')

test('meldet Wachstum als added und Schrumpfen als resolved', () => {
  const { added, resolved } = diffAgainstBaseline(['a:build', 'c:build'], ['a:build', 'b:build'])
  assert.deepEqual(added, ['c:build'])
  assert.deepEqual(resolved, ['b:build'])
})

test('unveraendert heisst leer in beide Richtungen', () => {
  const { added, resolved } = diffAgainstBaseline(['a:build'], ['a:build'])
  assert.deepEqual([added, resolved], [[], []])
})

console.log(failures === 0 ? '\nAlle Tests gruen.' : `\n${failures} Test(s) fehlgeschlagen.`)
process.exit(failures === 0 ? 0 : 1)
