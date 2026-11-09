#!/usr/bin/env node
/**
 * Tests fuer nx-cache-mass.mjs (#1402).
 *
 * Reines Node-Skript wie die uebrigen Specs unter scripts/: Kein Vitest-Projekt schliesst
 * `scripts/` ein, der Aufruf steht deshalb explizit in der CI.
 *
 * Geprueft wird vor allem, dass das Nx-Mass ueber ALLE Zeilen von cache_outputs summiert.
 * Nx vergleicht `SELECT SUM(size) FROM cache_outputs` mit dem Deckel, auch die Zeilen mit
 * `is_cache_entry = 0` (Terminal-Ausgaben ungecachter Tasks). Eine Summe nur ueber Eintraege
 * meldete „unter dem Deckel", wo Nx schon verdraengt.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { auswerten, formatGroesse, parseDeckel, zeile } from './nx-cache-mass.mjs'

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

const GB = 1024 ** 3
const platte = (hashVerzeichnisse = [], scheinbar = 0, belegt = 0) => ({ hashVerzeichnisse, scheinbar, belegt })

console.log('parseDeckel()')
test('1GB wie Nx', () => assert.equal(parseDeckel('1GB'), GB))
test('Leerzeichen und MB', () => assert.equal(parseDeckel('512 MB'), 512 * 1024 ** 2))
test('Zahl ohne Einheit sind Bytes', () => assert.equal(parseDeckel('2048'), 2048))
test('Dezimalzahl', () => assert.equal(parseDeckel('1.5GB'), 1.5 * GB))
test('ungesetzt', () => assert.equal(parseDeckel(undefined), undefined))
test('unlesbar', () => assert.equal(parseDeckel('viel'), undefined))

console.log('formatGroesse()')
test('GB mit zwei Stellen', () => assert.equal(formatGroesse(2.25 * GB), '2.25 GB'))
test('MB ganzzahlig', () => assert.equal(formatGroesse(140 * 1024 ** 2), '140 MB'))

console.log('auswerten()')
const zeilen = [
  { hash: '11', size: 600, is_cache_entry: 1 },
  { hash: '22', size: 300, is_cache_entry: 1 },
  { hash: '33', size: 200, is_cache_entry: 0 },
]
test('Nx-Mass summiert alle Zeilen, auch is_cache_entry = 0', () => {
  const e = auswerten(zeilen, platte(), 1000)
  assert.equal(e.nxMass, 1100)
  assert.equal(e.nxMassEintraege, 900)
  assert.equal(e.ueberDeckel, true)
})
test('Eintraege zaehlen nur is_cache_entry = 1', () => {
  const e = auswerten(zeilen, platte(), 1000)
  assert.equal(e.eintraege, 2)
  assert.equal(e.zeilen, 3)
})
test('genau auf dem Deckel ist nicht darueber', () => {
  assert.equal(auswerten(zeilen, platte(), 1100).ueberDeckel, false)
})
test('ohne Deckel nie darueber', () => {
  assert.equal(auswerten(zeilen, platte(), undefined).ueberDeckel, false)
})
test('Hash-Verzeichnis ohne DB-Zeile ist verwaist', () => {
  const e = auswerten(zeilen, platte(['11', '22', '99']), 1000)
  assert.equal(e.verwaist, 1)
  assert.equal(e.hashVerzeichnisse, 3)
})
test('Hash als Zahl aus der DB passt zum Verzeichnisnamen', () => {
  const e = auswerten([{ hash: 11, size: 1, is_cache_entry: 1 }], platte(['11']), 10)
  assert.equal(e.verwaist, 0)
})

console.log('zeile()')
test('nennt Nx-Mass, Deckel und beide Plattenmasse', () => {
  const z = zeile(auswerten(zeilen, platte(['11'], 900, 8192), 1000))
  assert.match(z, /^2 Einträge laut DB \(3 Zeilen\)/)
  assert.match(z, /Nx-Maß 1 KB von Deckel 1 KB — ÜBER DEM DECKEL/)
  assert.match(z, /Platte 1 KB Dateigröße \/ 8 KB belegt/)
  assert.match(z, /1 Hash-Verzeichnisse, davon 0 ohne DB-Zeile/)
})
test('ohne Deckel steht das da', () => {
  assert.match(zeile(auswerten([], platte(), undefined)), /von kein Deckel gesetzt/)
})

console.log('Aufruf')
const skript = fileURLToPath(new URL('./nx-cache-mass.mjs', import.meta.url))
test('kaputte DB endet mit Exit 0 und Meldung', () => {
  const r = spawnSync(process.execPath, [skript, tmpdir(), '/gibt/es/nicht.db', '1GB'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^Messung fehlgeschlagen: /)
})
test('echte SQLite-DB und Verzeichnis', () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'nx-cache-mass-'))
  try {
    const cache = join(dir, 'cache')
    mkdirSync(join(cache, '11'), { recursive: true })
    mkdirSync(join(cache, '77'))
    mkdirSync(join(cache, 'terminalOutputs'))
    writeFileSync(join(cache, '11', 'a.js'), 'x'.repeat(100))
    const db = new DatabaseSync(join(dir, 'x-v4.db'))
    db.exec('CREATE TABLE cache_outputs (hash TEXT PRIMARY KEY, code INTEGER, size INTEGER, is_cache_entry BOOLEAN)')
    db.exec("INSERT INTO cache_outputs VALUES ('11', 0, 100, 1), ('44', 0, 5, 0)")
    db.close()
    const r = spawnSync(process.execPath, [skript, cache, join(dir, 'x-v4.db'), '1GB'], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^1 Einträge laut DB \(2 Zeilen\), Nx-Maß 0 KB von Deckel 1\.00 GB, /)
    assert.match(r.stdout, /2 Hash-Verzeichnisse, davon 1 ohne DB-Zeile/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\nAlle Tests gruen.')
