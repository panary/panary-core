// Spec zu android-xml-gate.mjs — Aufruf: node scripts/android-xml-gate.spec.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ANDROID_DIR, checkFiles, run, trackedXmlFiles } from './android-xml-gate.mjs'

const repo = mkdtempSync(join(tmpdir(), 'android-xml-gate-'))
const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
git('init', '-q')
mkdirSync(join(repo, ANDROID_DIR, 'app'), { recursive: true })
mkdirSync(join(repo, ANDROID_DIR, 'build'), { recursive: true })

// Leeres Projekt: fail-closed
assert.equal(trackedXmlFiles(repo).length, 0)
assert.equal(run(repo), 1, '0 Dateien muss scheitern')

// Ungetrackte Datei (z. B. build/) zaehlt nicht
writeFileSync(join(repo, ANDROID_DIR, 'build', 'kaputt.xml'), '<a><!-- x -- y --></a>')
assert.equal(trackedXmlFiles(repo).length, 0)

// Wohlgeformt: gruen
writeFileSync(join(repo, ANDROID_DIR, 'app', 'ok.xml'), '<a><!-- ok --></a>')
git('add', '-f', join(ANDROID_DIR, 'app', 'ok.xml'))
assert.deepEqual(trackedXmlFiles(repo), [`${ANDROID_DIR}/app/ok.xml`])
assert.equal(run(repo), 0)

// `--` im Kommentar (Vorfall #1016): rot, mit Datei und Zeile
writeFileSync(join(repo, ANDROID_DIR, 'app', 'kaputt.xml'), '<a>\n<!-- nosemgrep -- Grund -->\n</a>')
git('add', '-f', join(ANDROID_DIR, 'app', 'kaputt.xml'))
const { geprueft, fehler } = checkFiles(trackedXmlFiles(repo), repo)
assert.equal(geprueft, 2)
assert.equal(fehler.length, 1)
assert.match(fehler[0].meldung, /kaputt\.xml:2/)
assert.equal(run(repo), 1)

console.log('android-xml-gate.spec: ok')
