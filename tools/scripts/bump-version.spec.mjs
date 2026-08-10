// Tests für bump-version.mjs (panary/panary-core, nach dem v26.8.10-Release).
//
// Anlass: Das Skript schrieb die drei Manifeste über
// `JSON.parse` → `JSON.stringify(…, 2)` zurück und formatierte dabei die
// **ganze** Datei neu. In `tauri.conf.json` wurden alle einzeiligen Arrays zu
// Mehrzeilern — rund 20 Zeilen Rauschen in jedem Release-Commit. Aufgefallen
// ist es nur, weil die Gegenprobe „der Release-Commit enthält ausschließlich
// Versionszeilen" tatsächlich gefahren wurde.
//
// Ausführen: node --test tools/scripts/bump-version.spec.mjs

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'bump-version.mjs')

// Ein Ausschnitt der echten tauri.conf.json — die kompakten Arrays sind der
// Punkt: An ihnen zeigte sich der Formatierungsschaden.
const TAURI_CONF = `{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Panary POS",
  "version": "26.8.9",
  "bundle": {
    "targets": ["nsis", "deb", "appimage"],
    "icon": ["icons/32x32.png", "icons/icon.icns"],
    "windows": {
      "nsis": {
        "languages": ["German"]
      }
    }
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/panary/panary-core/releases/latest/download/latest.json"]
    }
  }
}
`

const LICENSE = `Business Source License 1.1

Licensor:             Panary
Change Date:          2030-01-01 (Four years from the release date)
Change License:       Apache License, Version 2.0

Copyright (c) 2024-2025 Panary
`

/** Legt ein Wegwerf-Repo an, dessen Layout das Skript erwartet. */
function makeFixture(rootVersion) {
  const dir = mkdtempSync(join(tmpdir(), 'bump-version-'))
  mkdirSync(join(dir, 'tools/scripts'), { recursive: true })
  mkdirSync(join(dir, 'apps/api-edge'), { recursive: true })
  mkdirSync(join(dir, 'apps/pos-client/src-tauri'), { recursive: true })

  writeFileSync(join(dir, 'package.json'), `{\n  "name": "panary-core",\n  "version": "${rootVersion}"\n}\n`)
  writeFileSync(join(dir, 'apps/api-edge/package.json'), `{\n  "name": "api-edge",\n  "version": "${rootVersion}"\n}\n`)
  writeFileSync(join(dir, 'apps/pos-client/src-tauri/tauri.conf.json'), TAURI_CONF)
  writeFileSync(join(dir, 'LICENSE'), LICENSE)
  // Das Skript leitet ROOT aus seinem eigenen Pfad ab (../..).
  writeFileSync(join(dir, 'tools/scripts/bump-version.mjs'), readFileSync(SCRIPT, 'utf8'))
  return dir
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8')
const run = dir => execFileSync('node', [join(dir, 'tools/scripts/bump-version.mjs')], { encoding: 'utf8' }).trim()

describe('bump-version — Versionsberechnung', () => {
  let dir
  before(() => {
    dir = makeFixture('26.8.9')
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('zählt im selben Monat hoch und meldet die neue Version auf stdout', () => {
    const now = new Date()
    const expected = `${String(now.getFullYear()).slice(2)}.${now.getMonth() + 1}.`
    const out = run(dir)
    assert.ok(out.startsWith(expected), `erwartet Präfix ${expected}, war ${out}`)
    // Teilstring statt Regex: Die gesuchte Zeichenfolge ist wörtlich bekannt,
    // eine Regex bräuchte hier nur Escaping und brächte nichts. Der frühere
    // `out.replace(/\./g, '\\.')` maskierte ausschließlich Punkte und war damit
    // unvollständiges Escaping (CodeQL `js/incomplete-sanitization`) — harmlos,
    // solange `out` eine Versionsnummer ist, aber eine Konstruktion, die bei
    // jeder Wiederverwendung neu geprüft werden müsste.
    assert.ok(read(dir, 'package.json').includes(`"version": "${out}"`))
    assert.ok(read(dir, 'apps/api-edge/package.json').includes(`"version": "${out}"`))
  })
})

describe('bump-version — Formatierung bleibt erhalten', () => {
  let dir
  let before_
  before(() => {
    dir = makeFixture('26.8.9')
    before_ = read(dir, 'apps/pos-client/src-tauri/tauri.conf.json')
    run(dir)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('lässt einzeilige Arrays in tauri.conf.json einzeilig', () => {
    const after_ = read(dir, 'apps/pos-client/src-tauri/tauri.conf.json')
    assert.match(after_, /"targets": \["nsis", "deb", "appimage"\]/)
    assert.match(after_, /"icon": \["icons\/32x32\.png", "icons\/icon\.icns"\]/)
    assert.match(after_, /"languages": \["German"\]/)
    assert.match(after_, /"endpoints": \["https:\/\/github\.com/)
  })

  test('ändert in tauri.conf.json GENAU eine Zeile', () => {
    // Der eigentliche Nachweis: Zeilenweiser Vergleich vorher/nachher. Unter
    // dem alten JSON.stringify-Round-Trip wären es ~20 gewesen.
    const after_ = read(dir, 'apps/pos-client/src-tauri/tauri.conf.json')
    const a = before_.split('\n')
    const b = after_.split('\n')
    assert.equal(a.length, b.length, 'Zeilenzahl darf sich nicht ändern')
    const changed = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y)
    assert.equal(changed.length, 1, `erwartet 1 geänderte Zeile, waren ${changed.length}`)
    assert.match(changed[0][0], /"version"/)
  })

  test('rührt Reihenfolge und Rest der Datei nicht an', () => {
    const after_ = read(dir, 'apps/pos-client/src-tauri/tauri.conf.json')
    assert.equal(before_.replace(/"version": "[^"]*"/, ''), after_.replace(/"version": "[^"]*"/, ''))
  })
})

describe('bump-version — LICENSE', () => {
  let dir
  before(() => {
    dir = makeFixture('26.8.9')
    run(dir)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('setzt das Change Date auf heute + 4 Jahre', () => {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const expected = `${now.getFullYear() + 4}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    assert.match(read(dir, 'LICENSE'), new RegExp(`^Change Date: +${expected} \\(Four years`, 'm'))
  })

  test('zieht das Copyright-Jahr nach, ohne das Startjahr zu verlieren', () => {
    assert.match(read(dir, 'LICENSE'), new RegExp(`\\(c\\) 2024-${new Date().getFullYear()} Panary`))
  })
})

describe('bump-version — Absicherung', () => {
  test('bricht ab, statt eine Datei ohne version-Zeile stillschweigend zu lassen', () => {
    // Ein Release, das die Version nicht anhebt, ist schlimmer als ein
    // Abbruch: Der Publish-Workflow versucht dann, eine bereits
    // veröffentlichte Version erneut zu pushen.
    const dir = makeFixture('26.8.9')
    writeFileSync(join(dir, 'apps/api-edge/package.json'), '{\n  "name": "api-edge"\n}\n')
    assert.throws(() => run(dir), /keine Top-Level-"version"-Zeile/)
    rmSync(dir, { recursive: true, force: true })
  })

  test('ignoriert verschachtelte version-Schlüssel', () => {
    // Nur die Top-Level-Eigenschaft (zwei Leerzeichen Einrückung) darf sich
    // ändern — eine tiefer liegende "version" bleibt unangetastet.
    const dir = makeFixture('26.8.9')
    writeFileSync(
      join(dir, 'package.json'),
      '{\n  "name": "panary-core",\n  "version": "26.8.9",\n  "nested": {\n    "version": "1.0.0"\n  }\n}\n',
    )
    run(dir)
    assert.match(read(dir, 'package.json'), /"version": "1\.0\.0"/)
    rmSync(dir, { recursive: true, force: true })
  })
})
