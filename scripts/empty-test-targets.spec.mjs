#!/usr/bin/env node
/**
 * Tests fuer empty-test-targets.mjs.
 *
 * Bewusst ein reines Node-Skript und kein Vitest-Spec — gleiche Begruendung wie bei
 * `docs-log.spec.mjs`: `vitest.workspace.ts` globt nur `**\/vite.config.*` und
 * `**\/vitest.config.*`, kein Projekt schliesst `scripts/` ein. Der Aufruf steht
 * deshalb explizit in der CI.
 *
 * Der Kern dieser Tests ist der Schnitt verschachtelter Projektwurzeln. In
 * panary-core ist `libs/domains/orders` ein eigenes Projekt UND enthaelt
 * `orders/domain`, `orders/data-access` usw. Eine rekursive Zaehlung ohne diesen
 * Schnitt rechnet dem Eltern-Projekt die Specs seiner Kinder zu — beim Aufraeumen
 * in #159 wurden daraus aus 0 dringenden Faellen 29. Genau dieser Fehler darf im
 * Gate nicht wieder auftauchen, denn er wuerde ein leeres Target als voll melden.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectEmpty, countSpecFiles, diffAgainstBaseline, SPEC_RE } from './empty-test-targets.mjs'

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

/** Legt eine Verzeichnisstruktur aus `{ 'a/b.ts': '' }` an und liefert die Wurzel. */
const scaffold = files => {
  const dir = mkdtempSync(join(tmpdir(), 'empty-targets-'))
  for (const path of files) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, '')
  }
  return dir
}

console.log('SPEC_RE')

test('erkennt die ueblichen Spec-Endungen', () => {
  for (const name of ['a.spec.ts', 'a.test.ts', 'a.spec.tsx', 'a.test.mts', 'a.spec.js']) {
    assert.ok(SPEC_RE.test(name), name)
  }
})

test('nimmt normale Quelldateien nicht', () => {
  for (const name of ['a.ts', 'spec.ts', 'a.spec.md', 'specimen.ts', 'a.testing.ts']) {
    assert.ok(!SPEC_RE.test(name), name)
  }
})

console.log('\ncountSpecFiles')

test('zaehlt Specs unterhalb der Projektwurzel', () => {
  const dir = scaffold(['src/a.ts', 'src/a.spec.ts', 'src/lib/b.spec.ts'])
  assert.equal(countSpecFiles(dir, [dir]), 2)
})

test('zaehlt Specs eines VERSCHACHTELTEN Projekts NICHT mit', () => {
  // Der Fall aus #159: das Eltern-Projekt hat nichts Eigenes, das Kind ist voll.
  const dir = scaffold(['domain/src/a.spec.ts', 'data-access/src/b.spec.ts'])
  const child1 = join(dir, 'domain')
  const child2 = join(dir, 'data-access')
  assert.equal(countSpecFiles(dir, [dir, child1, child2]), 0, 'Eltern-Projekt muss leer sein')
  assert.equal(countSpecFiles(child1, [dir, child1, child2]), 1)
})

test('zaehlt eigene Specs auch dann, wenn es zusaetzlich Kinder gibt', () => {
  const dir = scaffold(['src/eigen.spec.ts', 'domain/src/kind.spec.ts'])
  assert.equal(countSpecFiles(dir, [dir, join(dir, 'domain')]), 1)
})

test('schliesst nur echte Nachfahren aus, nicht Namensvettern', () => {
  // `domain` ist ein verschachteltes Projekt, `domain-extra.spec.ts` gehoert
  // dagegen dem Eltern-Projekt. Ohne den Pfadtrenner im Praefix-Vergleich
  // (`startsWith(n)` statt `startsWith(n + '/')`) faellt die Datei faelschlich
  // unter das Kind und das Eltern-Projekt sieht leerer aus, als es ist.
  const dir = scaffold(['domain/src/kind.spec.ts', 'domain-extra.spec.ts'])
  assert.equal(countSpecFiles(dir, [dir, join(dir, 'domain')]), 1)
})

test('ignoriert node_modules, dist und Punkt-Verzeichnisse', () => {
  const dir = scaffold([
    'node_modules/paket/x.spec.ts',
    'dist/y.spec.ts',
    '.cache/z.spec.ts',
    'coverage/c.spec.ts',
    'src/echt.spec.ts',
  ])
  assert.equal(countSpecFiles(dir, [dir]), 1)
})

test('ein fehlendes Verzeichnis ist 0, kein Absturz', () => {
  assert.equal(countSpecFiles(join(tmpdir(), 'gibt-es-sicher-nicht-' + process.pid), []), 0)
})

console.log('\ncollectEmpty')

test('nimmt nur Projekte mit test-Target und ohne Specs, sortiert', () => {
  const result = collectEmpty([
    { name: 'zeta', hasTest: true, specCount: 0 },
    { name: 'alpha', hasTest: true, specCount: 0 },
    { name: 'beta', hasTest: true, specCount: 3 },
    { name: 'gamma', hasTest: false, specCount: 0 },
  ])
  assert.deepEqual(result, ['alpha', 'zeta'])
})

test('ohne test-Target zaehlt ein Projekt nicht als leer', () => {
  // Sonst wuerden die 36 Umbrella-Pakete das Gate dauerhaft rot faerben.
  assert.deepEqual(collectEmpty([{ name: 'orders', hasTest: false, specCount: 0 }]), [])
})

console.log('\ndiffAgainstBaseline')

test('meldet ein neu hinzugekommenes leeres Target als added', () => {
  const { added, resolved } = diffAgainstBaseline(['a', 'b'], ['a'])
  assert.deepEqual(added, ['b'])
  assert.deepEqual(resolved, [])
})

test('meldet ein befuelltes Projekt als resolved, nicht als added', () => {
  const { added, resolved } = diffAgainstBaseline(['a'], ['a', 'b'])
  assert.deepEqual(added, [])
  assert.deepEqual(resolved, ['b'])
})

test('unveraenderter Bestand ergibt beide Listen leer', () => {
  const { added, resolved } = diffAgainstBaseline(['a', 'b'], ['b', 'a'])
  assert.deepEqual(added, [])
  assert.deepEqual(resolved, [])
})

test('Tausch bei gleicher Gesamtzahl faellt auf', () => {
  // Der Grund, warum die Baseline eine Liste ist und kein Zaehler: Hier bleibt
  // die Summe 2, aber `c` ist neu leer. Ein Zaehler saehe netto null.
  const { added, resolved } = diffAgainstBaseline(['a', 'c'], ['a', 'b'])
  assert.deepEqual(added, ['c'])
  assert.deepEqual(resolved, ['b'])
})

console.log(failures ? `\n${failures} Test(s) fehlgeschlagen.` : '\nAlle Tests gruen.')
process.exit(failures ? 1 : 0)
