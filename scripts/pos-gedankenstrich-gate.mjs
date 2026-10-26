#!/usr/bin/env node
// POS-Gedankenstrich-Gate: kein Em-Dash („—“) in sichtbaren Texten des POS-Clients.
//
// WARUM ES DIESES GATE GIBT
// Michael am 2026-10-26: Im POS stehen keine Gedankenstriche mehr, auffälligstes Beispiel war der
// App-Name „Panary — Terminal“. Gemessen waren 36 Texte je Sprache (#1106). Die Ersetzungsregel nach
// Satzbau steht in `.claude/rules/code-style.md` §9.2.
//
// WAS ES MISST
// - die Werte (nicht die Schlüssel) in `apps/pos-client/src/assets/i18n/*.json`,
// - `apps/pos-client/src-tauri/tauri.conf.json` (App-Name, Fenstertitel),
// - den `<title>` in `apps/pos-client/src/index.html`.
//
// WAS ES NICHT MISST
// Fest verdrahtete Texte in `.ts`/`.html`: Dort stehen Gedankenstriche massenhaft in Kommentaren, ein
// Muster ohne Parser trennt beides nicht zuverlässig. Für sie gilt allein die Regel.
//
// FAIL-CLOSED
// Keine i18n-Datei, eine fehlende Pflichtdatei oder kaputtes JSON sind ein Fehler, kein Exit 0.
//
// Aufruf:
//   pnpm pos-gedankenstrich:gate

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const EM_DASH = '—'
export const I18N_DIR = 'apps/pos-client/src/assets/i18n'
export const TAURI_CONF = 'apps/pos-client/src-tauri/tauri.conf.json'
export const INDEX_HTML = 'apps/pos-client/src/index.html'

/** Alle String-Werte eines JSON-Objekts mit ihrem Pfad (`A.B.C`). */
export function stringValues(node, path = []) {
  if (typeof node === 'string') return [{ pfad: path.join('.'), wert: node }]
  if (Array.isArray(node)) return node.flatMap((v, i) => stringValues(v, [...path, String(i)]))
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => stringValues(v, [...path, k]))
  return []
}

/** Treffer einer JSON-Datei als `{ datei, pfad, wert }`. */
export function jsonFunde(root, datei) {
  const json = JSON.parse(readFileSync(join(root, datei), 'utf8'))
  return stringValues(json)
    .filter(v => v.wert.includes(EM_DASH))
    .map(v => ({ datei, ...v }))
}

/** Treffer im `<title>` der index.html. */
export function titleFunde(root, datei = INDEX_HTML) {
  const html = readFileSync(join(root, datei), 'utf8')
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  if (title === undefined) throw new Error(`${datei}: kein <title> gefunden — Gate misst nichts`)
  return title.includes(EM_DASH) ? [{ datei, pfad: 'title', wert: title.trim() }] : []
}

export function run(root = ROOT) {
  const i18nDir = join(root, I18N_DIR)
  const i18n = existsSync(i18nDir)
    ? readdirSync(i18nDir)
        .filter(f => f.endsWith('.json'))
        .map(f => `${I18N_DIR}/${f}`)
    : []
  if (i18n.length === 0) throw new Error(`keine i18n-Datei unter ${I18N_DIR} — Gate misst nichts`)
  for (const pflicht of [TAURI_CONF, INDEX_HTML]) {
    if (!existsSync(join(root, pflicht))) throw new Error(`${pflicht} fehlt — Gate misst nichts`)
  }

  const funde = [...[...i18n, TAURI_CONF].flatMap(datei => jsonFunde(root, datei)), ...titleFunde(root)]
  const geprueft = i18n.length + 2
  if (funde.length > 0) {
    for (const f of funde) console.error(`${f.datei} ${f.pfad}: ${f.wert}`)
    console.error(
      `pos-gedankenstrich-gate: ${funde.length} Text(e) mit „${EM_DASH}“ in ${geprueft} Dateien. ` +
        'Ersetzen nach Satzbau, siehe .claude/rules/code-style.md §9.2',
    )
    return 1
  }
  console.log(`pos-gedankenstrich-gate: ${geprueft} Dateien ohne „${EM_DASH}“`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(run())
  } catch (e) {
    console.error(`pos-gedankenstrich-gate: ${e.message}`)
    process.exit(1)
  }
}
