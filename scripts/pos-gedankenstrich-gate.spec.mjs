// Spec zu pos-gedankenstrich-gate.mjs — Aufruf: node scripts/pos-gedankenstrich-gate.spec.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { I18N_DIR, INDEX_HTML, run, stringValues, TAURI_CONF } from './pos-gedankenstrich-gate.mjs'

const repo = mkdtempSync(join(tmpdir(), 'pos-gedankenstrich-gate-'))
const write = (datei, inhalt) => {
  mkdirSync(join(repo, datei, '..'), { recursive: true })
  writeFileSync(join(repo, datei), inhalt)
}
const quiet = fn => {
  const [log, err] = [console.log, console.error]
  console.log = console.error = () => undefined
  try {
    return fn()
  } finally {
    console.log = log
    console.error = err
  }
}

// Verschachtelte Werte samt Pfad, Schlüssel zählen nicht
assert.deepEqual(stringValues({ A: { B: 'x' }, C: ['y'] }), [
  { pfad: 'A.B', wert: 'x' },
  { pfad: 'C.0', wert: 'y' },
])

// Leeres Projekt: fail-closed (wirft)
assert.throws(() => run(repo), /keine i18n-Datei/)

// i18n da, aber tauri.conf.json fehlt: fail-closed
write(`${I18N_DIR}/de.json`, JSON.stringify({ STATUS: { OFFLINE: 'Offline · Nur Barzahlung möglich' } }))
assert.throws(() => run(repo), /tauri\.conf\.json fehlt/)

// Alles sauber: grün. Ein Em-Dash im SCHLÜSSEL zählt nicht.
write(TAURI_CONF, JSON.stringify({ productName: 'Panary Terminal', app: { windows: [{ title: 'Panary Terminal' }] } }))
write(INDEX_HTML, '<html><head><title>Panary Terminal</title></head></html>')
write(`${I18N_DIR}/en.json`, JSON.stringify({ 'A—B': 'ok' }))
assert.equal(
  quiet(() => run(repo)),
  0,
)

// Em-Dash in einem i18n-Wert: rot
write(`${I18N_DIR}/tr.json`, JSON.stringify({ PRINT: { ERROR: 'Yazdırma hatası — {{reason}}' } }))
assert.equal(
  quiet(() => run(repo)),
  1,
)
write(`${I18N_DIR}/tr.json`, JSON.stringify({ PRINT: { ERROR: 'Yazdırma hatası: {{reason}}' } }))

// Em-Dash im Fenstertitel (verschachtelt im Array): rot
write(
  TAURI_CONF,
  JSON.stringify({ productName: 'Panary Terminal', app: { windows: [{ title: 'Panary — Terminal' }] } }),
)
assert.equal(
  quiet(() => run(repo)),
  1,
)
write(TAURI_CONF, JSON.stringify({ productName: 'Panary Terminal', app: { windows: [{ title: 'Panary Terminal' }] } }))

// Em-Dash im <title>: rot. Fehlt der <title>: fail-closed
write(INDEX_HTML, '<title>Panary — Terminal</title>')
assert.equal(
  quiet(() => run(repo)),
  1,
)
write(INDEX_HTML, '<html></html>')
assert.throws(() => run(repo), /kein <title>/)

console.log('pos-gedankenstrich-gate.spec: ok')
