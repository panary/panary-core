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

import {
  alterAuswerten,
  alterText,
  auswerten,
  formatAlter,
  formatGroesse,
  parseDeckel,
  parseSqliteUtc,
  zeile,
} from './nx-cache-mass.mjs'

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

console.log('Alter (#1407)')
const H = 3600 * 1000
const D = 24 * H
const JETZT = Date.UTC(2026, 10, 16, 0, 30, 0)
test('SQLite-Zeitstempel ohne Zone ist UTC, nicht Ortszeit', () => {
  assert.equal(parseSqliteUtc('2026-11-15 23:59:30'), Date.UTC(2026, 10, 15, 23, 59, 30))
})
test('ISO mit Z und Millisekunden', () => {
  assert.equal(parseSqliteUtc('2026-11-15T23:59:30.250Z'), Date.UTC(2026, 10, 15, 23, 59, 30, 250))
})
test('Unlesbares ist NaN', () => assert.ok(Number.isNaN(parseSqliteUtc('gestern'))))
test('Alter unter einem Tag in h, darüber in d', () => {
  assert.equal(formatAlter(0.1 * H), '0.1 h')
  assert.equal(formatAlter(2.4 * D), '2.4 d')
  assert.equal(formatAlter(-5 * H), '0.0 h')
})
test('gemischte Zeitstempel: MIN/MAX werden zu Altern', () => {
  const a = alterAuswerten(
    {
      aeltesterZugriff: '2026-11-13 14:54:00',
      juengsterZugriff: '2026-11-16 00:24:00',
      aeltesteAnlage: '2026-11-09 02:54:00',
    },
    JETZT,
  )
  assert.equal(alterText(a), 'ältester Zugriff vor 2.4 d, jüngster vor 0.1 h, älteste Anlage vor 6.9 d')
})
test('kurz vor Mitternacht UTC: 31 Minuten, nicht Stunden daneben', () => {
  const a = alterAuswerten(
    {
      aeltesterZugriff: '2026-11-15 23:59:00',
      juengsterZugriff: '2026-11-15 23:59:00',
      aeltesteAnlage: '2026-11-15 23:59:00',
    },
    JETZT,
  )
  assert.equal(a.juengsterZugriff, 31 * 60 * 1000)
  assert.match(alterText(a), /jüngster vor 0\.5 h/)
})
test('leere DB: keine Zeilen, kein Absturz', () => {
  const a = alterAuswerten({ aeltesterZugriff: null, juengsterZugriff: null, aeltesteAnlage: null }, JETZT)
  assert.equal(alterText(a), 'Alter: keine Zeilen')
})
test('unlesbarer Zeitstempel: nicht messbar mit Grund', () => {
  const a = alterAuswerten({ aeltesterZugriff: 'x', juengsterZugriff: 'x', aeltesteAnlage: 'x' }, JETZT)
  assert.match(alterText(a), /^Alter nicht messbar: aeltesterZugriff unlesbar/)
})
test('Zeilen mit NULL-Zeitstempeln sind nicht „keine Zeilen"', () => {
  const a = alterAuswerten({ aeltesterZugriff: null, juengsterZugriff: null, aeltesteAnlage: null, zeilen: 3 }, JETZT)
  assert.equal(alterText(a), 'Alter nicht messbar: Zeitstempel leer (NULL)')
})
test('Zeitstempel Stunden in der Zukunft: nicht messbar statt 0.0 h', () => {
  const a = alterAuswerten(
    {
      aeltesterZugriff: '2026-11-16 01:30:00',
      juengsterZugriff: '2026-11-16 01:30:00',
      aeltesteAnlage: '2026-11-16 01:30:00',
    },
    JETZT,
  )
  assert.match(alterText(a), /^Alter nicht messbar: aeltesterZugriff liegt in der Zukunft/)
})
test('wenige Minuten Uhrabweichung bleiben 0.0 h', () => {
  const a = alterAuswerten(
    {
      aeltesterZugriff: '2026-11-16 00:32:00',
      juengsterZugriff: '2026-11-16 00:32:00',
      aeltesteAnlage: '2026-11-16 00:32:00',
    },
    JETZT,
  )
  assert.match(alterText(a), /^ältester Zugriff vor 0\.0 h/)
})
test('unlesbarer Rohwert wird gekürzt und ohne Zeilenumbruch ausgegeben', () => {
  const a = alterAuswerten(
    { aeltesterZugriff: 'a\nb%' + 'x'.repeat(80), juengsterZugriff: 'x', aeltesteAnlage: 'x' },
    JETZT,
  )
  const t = alterText(a)
  assert.ok(!t.includes('\n') && !t.includes('%'), t)
  assert.ok(t.length < 120, t)
})
test('zeile() hängt das Alter hinten an', () => {
  const a = alterAuswerten(
    {
      aeltesterZugriff: '2026-11-15 00:30:00',
      juengsterZugriff: '2026-11-16 00:30:00',
      aeltesteAnlage: '2026-11-15 00:30:00',
    },
    JETZT,
  )
  assert.match(
    zeile(auswerten(zeilen, platte(), 1000, a)),
    /ohne DB-Zeile, ältester Zugriff vor 1\.0 d, jüngster vor 0\.0 h, älteste Anlage vor 1\.0 d$/,
  )
})
test('zeile() ohne Alter bleibt wie bisher', () => {
  assert.match(zeile(auswerten(zeilen, platte(), 1000)), /ohne DB-Zeile$/)
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
    // Schema wie Nx 23.3.1 (CREATE TABLE IF NOT EXISTS cache_outputs … accessed_at/created_at DEFAULT CURRENT_TIMESTAMP)
    db.exec(
      'CREATE TABLE cache_outputs (hash TEXT PRIMARY KEY, code INTEGER, size INTEGER, is_cache_entry BOOLEAN, ' +
        'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    )
    // Zeitstempel relativ zu jetzt, von SQLite selbst in UTC erzeugt: Zugriffe 3 h und 30 min, Anlage 2 d
    db.exec(`INSERT INTO cache_outputs VALUES
      ('11', 0, 100, 1, datetime('now', '-2 days'), datetime('now', '-3 hours')),
      ('44', 0, 5, 0, datetime('now', '-3 hours'), datetime('now', '-30 minutes'))`)
    db.close()
    // TZ erzwingen: Der CI-Runner läuft in UTC und sähe eine Ortszeit-Lesart sonst nie.
    const r = spawnSync(process.execPath, [skript, cache, join(dir, 'x-v4.db'), '1GB'], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'Europe/Berlin' },
    })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^1 Einträge laut DB \(2 Zeilen\), Nx-Maß 0 KB von Deckel 1\.00 GB, /)
    assert.match(r.stdout, /2 Hash-Verzeichnisse, davon 1 ohne DB-Zeile/)
    assert.match(r.stdout, /ältester Zugriff vor 3\.0 h, jüngster vor 0\.5 h, älteste Anlage vor 2\.0 d\n$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Tabelle ohne accessed_at: Größen bleiben, Alter nicht messbar', () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'nx-cache-mass-'))
  try {
    const cache = join(dir, 'cache')
    mkdirSync(cache)
    const db = new DatabaseSync(join(dir, 'x-v4.db'))
    db.exec('CREATE TABLE cache_outputs (hash TEXT PRIMARY KEY, code INTEGER, size INTEGER, is_cache_entry BOOLEAN)')
    db.exec("INSERT INTO cache_outputs VALUES ('11', 0, 100, 1)")
    db.close()
    const r = spawnSync(process.execPath, [skript, cache, join(dir, 'x-v4.db'), '1GB'], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^1 Einträge laut DB \(1 Zeilen\), Nx-Maß 0 KB von Deckel 1\.00 GB, /)
    assert.match(r.stdout, /, Alter nicht messbar: .*accessed_at/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('leere Tabelle: Alter keine Zeilen', () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'nx-cache-mass-'))
  try {
    const cache = join(dir, 'cache')
    mkdirSync(cache)
    const db = new DatabaseSync(join(dir, 'x-v4.db'))
    db.exec(
      'CREATE TABLE cache_outputs (hash TEXT PRIMARY KEY, code INTEGER, size INTEGER, is_cache_entry BOOLEAN, ' +
        'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    )
    db.close()
    const r = spawnSync(process.execPath, [skript, cache, join(dir, 'x-v4.db'), '1GB'], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^0 Einträge laut DB \(0 Zeilen\).*, Alter: keine Zeilen\n$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\nAlle Tests gruen.')
