#!/usr/bin/env node
/**
 * Tests fuer installer-drift.mjs.
 *
 * Reines Node-Skript, kein Vitest-Spec — gleiche Begruendung wie bei den uebrigen Gate-Specs:
 * kein Vitest-Projekt schliesst `scripts/` ein. Der Aufruf steht deshalb explizit in der CI.
 *
 * Geprueft wird die Entscheidung, nicht das Netz. Die beiden stillen Fehlschlaege, gegen die
 * das Skript gebaut ist: ein Netzwerk-Wackler, der als Abweichung ein Issue oeffnet oder als
 * Uebereinstimmung eines schliesst — und eine Abweichung, die je Lauf ein weiteres Issue anlegt.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import { aktion, blobHash, issueBody, vergleiche } from './installer-drift.mjs'

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

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

test('blobHash entspricht git hash-object', () => {
  const inhalt = '#!/bin/bash\necho hallo\n'
  const git = execFileSync('git', ['hash-object', '--stdin'], { input: inhalt, encoding: 'utf8' }).trim()
  assert.equal(blobHash(inhalt), git)
  assert.notEqual(blobHash(inhalt), blobHash(inhalt + ' '))
})

test('alles gleich → gleich', () => {
  const r = vergleiche([
    { datei: 'install.sh', repo: A, live: A },
    { datei: 'index.html', repo: B, live: B },
  ])
  assert.equal(r.zustand, 'gleich')
  assert.deepEqual(r.abweichend, [])
})

test('eine Datei weicht ab → abweichung, mit genau dieser Datei', () => {
  const r = vergleiche([
    { datei: 'install.sh', repo: A, live: B },
    { datei: 'index.html', repo: B, live: B },
  ])
  assert.equal(r.zustand, 'abweichung')
  assert.deepEqual(
    r.abweichend.map(e => e.datei),
    ['install.sh'],
  )
})

test('nicht erreichbar ohne Abweichung → unbekannt, nicht gleich', () => {
  const r = vergleiche([
    { datei: 'install.sh', repo: A, live: null, fehler: 'Timeout' },
    { datei: 'index.html', repo: B, live: B },
  ])
  assert.equal(r.zustand, 'unbekannt')
})

test('Abweichung bleibt sicher, auch wenn eine andere Datei nicht erreichbar ist', () => {
  const r = vergleiche([
    { datei: 'install.sh', repo: A, live: B },
    { datei: 'index.html', repo: B, live: null, fehler: 'HTTP 503' },
  ])
  assert.equal(r.zustand, 'abweichung')
})

test('leere Messung ist nie gleich', () => {
  assert.equal(vergleiche([]).zustand, 'unbekannt')
})

test('Abweichung oeffnet nur, wenn noch keins offen ist', () => {
  assert.equal(aktion('abweichung', []), 'oeffnen')
  assert.equal(aktion('abweichung', [12]), 'nichts')
})

test('Uebereinstimmung schliesst offene Issues, sonst nichts', () => {
  assert.equal(aktion('gleich', [12]), 'schliessen')
  assert.equal(aktion('gleich', []), 'nichts')
})

test('unbekannt oeffnet und schliesst nie', () => {
  assert.equal(aktion('unbekannt', []), 'nichts')
  assert.equal(aktion('unbekannt', [12]), 'nichts')
})

test('Issue-Body nennt die abweichende Datei und den main-Stand', () => {
  const body = issueBody(
    [
      { datei: 'install.sh', repo: A, live: B },
      { datei: 'index.html', repo: B, live: B },
    ],
    'c475ebcb0000000000000000000000000000000',
  )
  assert.match(body, /Betroffen: `install\.sh`\./)
  assert.match(body, /`c475ebcb`/)
  assert.match(body, /\*\*weicht ab\*\*/)
  // Keine Checkbox: das Issue ist eine Benachrichtigung, kein Fortschrittszaehler.
  assert.doesNotMatch(body, /- \[ \]/)
})

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen`)
  process.exit(1)
}
console.log('\ninstaller-drift: alle Tests gruen')
