#!/usr/bin/env node
// Android-XML-Gate: prueft jede getrackte XML-Datei des Capacitor-Android-Projekts auf Wohlgeformtheit.
//
// WARUM ES DIESES GATE GIBT
// Die CI baut kein Android (kein Gradle, kein SDK) und das Format-Gate ignoriert `apps/pos-client/android`
// (.prettierignore). Ein Manifest mit `--` in einem XML-Kommentar war deshalb ueber #839 in `main`, bis der
// naechste lokale `pnpm android:build` in `processDebugMainManifest` abbrach (#1016, behoben mit #1018).
//
// FAIL-CLOSED
// Dateiquelle ist `git ls-files`, nie ein Dateisystem-Glob (sonst zaehlen `build/` und `node_modules/` mit).
// 0 Dateien oder ein fehlendes `xmllint` sind ein Fehler, kein Exit 0 — ein Gate, das nichts misst, meldet gruen.
//
// WAS ES NICHT MISST
// Wohlgeformtheit ist nicht Gueltigkeit: fehlende Android-Attribute, falsche Namespaces und
// Manifest-Merge-Konflikte faengt nur ein echter Gradle-Lauf.
//
// Aufruf:
//   pnpm android-xml:gate

import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ANDROID_DIR = 'apps/pos-client/android'

/** Getrackte XML-Dateien unter dem Android-Projekt (repo-relativ). */
export function trackedXmlFiles(root = ROOT, dir = ANDROID_DIR) {
  const out = execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(f => f.endsWith('.xml'))
}

/** Prueft die Dateien mit xmllint. Liefert `{ geprueft, fehler }`; wirft, wenn xmllint fehlt. */
export function checkFiles(files, root = ROOT) {
  const fehler = []
  for (const file of files) {
    const res = spawnSync('xmllint', ['--noout', file], { cwd: root, encoding: 'utf8' })
    if (res.error)
      throw new Error(`xmllint nicht ausfuehrbar (${res.error.code ?? res.error.message}) — Gate misst nichts`)
    if (res.status !== 0) fehler.push({ file, meldung: (res.stderr || res.stdout).trim() })
  }
  return { geprueft: files.length, fehler }
}

export function run(root = ROOT) {
  const files = trackedXmlFiles(root)
  if (files.length === 0) {
    console.error(`android-xml-gate: keine getrackte XML-Datei unter ${ANDROID_DIR} gefunden — Gate misst nichts`)
    return 1
  }
  const { geprueft, fehler } = checkFiles(files, root)
  if (fehler.length > 0) {
    for (const f of fehler) console.error(`${f.file}\n${f.meldung}\n`)
    console.error(`android-xml-gate: ${fehler.length} von ${geprueft} Dateien nicht wohlgeformt`)
    return 1
  }
  console.log(`android-xml-gate: ${geprueft} Dateien unter ${ANDROID_DIR} wohlgeformt`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(run())
  } catch (e) {
    console.error(`android-xml-gate: ${e.message}`)
    process.exit(1)
  }
}
