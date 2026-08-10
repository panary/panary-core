#!/usr/bin/env node
/**
 * Tests fuer docs-log.mjs.
 *
 * Bewusst ein reines Node-Skript und kein Vitest-Spec — gleiche Begruendung wie bei
 * `typecheck-gate.spec.mjs`: `vitest.workspace.ts` globt nur `**\/vite.config.*` und
 * `**\/vitest.config.*`, kein Projekt schliesst `scripts/` ein. Der Aufruf steht
 * deshalb explizit in der CI.
 *
 * Der Kern dieser Tests ist die Link-Tiefe. Die Migration hat genau dort einen Fehler
 * gemacht, den erst der Round-Trip gegen den Bestand aufdeckte: Links, die schon ein
 * ../ trugen (repo-uebergreifend nach panary-core), wurden nicht mitverschoben und
 * zeigten danach eine Ebene zu hoch. Sechs Bulletpunkte im Bestand waren betroffen.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseName, readFragments, render, unshiftLinks } from './docs-log.mjs'

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

console.log('parseName')

test('nimmt das Schema <datum>-<nr>-<slug>', () => {
  assert.deepEqual(parseName('2026-08-09-137-redactions-paginate.md'), {
    date: '2026-08-09',
    nr: 137,
    slug: 'redactions-paginate',
  })
})

test('nimmt zweistellige Bestands-Nummern', () => {
  assert.equal(parseName('2026-08-04-02-rate-limiting.md').nr, 2)
})

test('weist ab, was nicht passt', () => {
  for (const bad of ['log.md', 'index.md', '2026-08-09-fehlt-die-nummer.md', '2026-8-9-1-x.md']) {
    assert.equal(parseName(bad), null, bad)
  }
})

console.log('unshiftLinks')

test('entfernt genau eine Ebene', () => {
  assert.equal(unshiftLinks('[a](../security/x.md)'), '[a](security/x.md)')
})

test('entfernt bei repo-uebergreifenden Links auch nur eine Ebene', () => {
  // Die Gegenprobe zum Migrationsfehler: aus ../../../panary-core/… muss
  // ../../panary-core/… werden, nicht ../panary-core/….
  assert.equal(
    unshiftLinks('[a](../../../panary-core/docs/adr/0021-x.md)'),
    '[a](../../panary-core/docs/adr/0021-x.md)',
  )
})

test('laesst http-Links und Anker in Ruhe', () => {
  const body = '[a](https://github.com/panary/panary-cloud/pull/1) und [b](#abschnitt)'
  assert.equal(unshiftLinks(body), body)
})

console.log('readFragments / render')

const dir = mkdtempSync(join(tmpdir(), 'docs-log-'))
mkdirSync(join(dir, 'log.d'))
const logD = join(dir, 'log.d')
writeFileSync(join(logD, '2026-08-09-02-zweiter.md'), '* **Update**: zweiter\n')
writeFileSync(join(logD, '2026-08-09-01-erster.md'), '* **Update**: erster\n')
writeFileSync(join(logD, '2026-08-10-01-neuer-tag.md'), '* **Creation**: [x](../adr/x.md)\n')

test('liest alle Fragmente', () => {
  assert.equal(readFragments(logD).fragments.length, 3)
})

test('sortiert Tage absteigend, innerhalb des Tages <nr> absteigend', () => {
  const out = render(readFragments(logD).fragments)
  const order = out.split('\n').filter(l => l.startsWith('## ') || l.startsWith('* '))
  assert.deepEqual(order, [
    '## 2026-08-10',
    '* **Creation**: [x](adr/x.md)',
    '## 2026-08-09',
    '* **Update**: zweiter',
    '* **Update**: erster',
  ])
})

test('meldet kaputte Dateinamen und leere Dateien, ohne abzubrechen', () => {
  writeFileSync(join(logD, 'kaputt.md'), '* **Update**: x\n')
  writeFileSync(join(logD, '2026-08-11-01-leer.md'), '   \n')
  const { fragments, problems } = readFragments(logD)
  assert.equal(fragments.length, 3, 'die intakten Fragmente kommen weiterhin durch')
  assert.equal(problems.length, 2)
  assert.match(problems.join('\n'), /kaputt\.md/)
  assert.match(problems.join('\n'), /leer/)
})

test('meldet einen fehlenden Bullet-Anfang', () => {
  writeFileSync(join(logD, '2026-08-12-01-kein-bullet.md'), '## Ueberschrift statt Bullet\n')
  const { problems } = readFragments(logD)
  assert.match(problems.join('\n'), /kein Bullet/)
})

test('leeres Verzeichnis ist ein Problem, kein Absturz', () => {
  const { fragments, problems } = readFragments(join(dir, 'gibt-es-nicht'))
  assert.deepEqual(fragments, [])
  assert.equal(problems.length, 1)
})

console.log(failures ? `\n${failures} Test(s) fehlgeschlagen.` : '\nAlle Tests gruen.')
process.exit(failures ? 1 : 0)
