#!/usr/bin/env node
// Leerstands-Gate: friert ein, WELCHE Projekte ein `test`-Target ohne eine
// einzige Spec-Datei haben, und bricht ab, sobald ein weiteres dazukommt.
//
// WARUM ES DIESES GATE GIBT
// Seit #159 hat jedes Projekt mit eigenem Code ein `test`-Target — 45 der 86
// davon ohne einen einzigen Test. Das war Absicht (ohne Target laeuft eine
// spaeter angelegte Spec still ins Leere, siehe #155), erzeugt aber ein neues
// Problem: In der CI-Ausgabe ist ein leeres Target von einem vollen nicht zu
// unterscheiden. Beide melden gruen. Ohne Messung waechst der Leerstand
// unsichtbar weiter — genau die Klasse Fehler, gegen die auch das
// Typecheck-Gate (#110/#111) gebaut wurde: nicht "etwas ist kaputt", sondern
// "niemand sieht, dass nichts passiert".
//
// WAHL DES BASELINE-FORMATS
// Baseline ist die sortierte LISTE der leeren Projekte, kein Gesamtzaehler.
// Ein reiner Zaehler waere blind gegen den haeufigsten Fall: Projekt A bekommt
// seine erste Spec (-1), Projekt B wird neu und leer angelegt (+1) — netto 45,
// und niemand sieht es. Dieselbe Ueberlegung wie in
// `panary-cloud/scripts/mongo-raw-gate.mjs`, wo ein Zaehler aus demselben Grund
// verworfen wurde. Projektnamen statt Pfaden, weil eine Umbenennung dann als
// "neu" aufschlaegt und einmal quittiert werden muss, statt still durchzulaufen.
//
// RICHTUNG
// Wachstum bricht ab. Schrumpfen bricht NICHT ab — wer die erste Spec fuer ein
// Projekt schreibt, soll nicht mit einem roten Build bestraft werden. Es wird
// aber gemeldet, damit die Baseline nachgezogen wird; sonst verrottet sie zu
// einer Liste von Projekten, die laengst getestet sind, und ein spaeteres
// Leerraeumen faellt nicht mehr auf.
//
// WAS ES NICHT MISST
// Ob die vorhandenen Specs auch tatsaechlich vom `test`-Target geglobt werden.
// Geprueft: Die einzigen Projekte mit Specs, aber ohne per-Datei-`test-ci`-
// Targets sind admin-client, setup-client und pos-client — die fahren
// `@angular/build:unit-test`, der solche Targets grundsaetzlich nicht anlegt.
// Ein Check darauf haette also drei Fehlalarme und null echte Funde.
//
// Aufruf:
//   pnpm empty-targets:gate         # pruefen (so faehrt es die CI)
//   pnpm empty-targets:gate:update  # Baseline neu schreiben

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const BASELINE_PATH = 'empty-test-targets-baseline.json'

export const SPEC_RE = /\.(spec|test)\.(ts|mts|cts|tsx|js|mjs|cjs|jsx)$/
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage'])

/**
 * Spec-Dateien unterhalb von `root`, OHNE die, die einem verschachtelten
 * Projekt gehoeren.
 *
 * Der Schnitt ist hier aktuell wirkungslos (kein Projekt mit test-Target
 * enthaelt ein anderes), steht aber trotzdem: In panary-core sind
 * Projektverzeichnisse geschachtelt — `libs/domains/orders` ist ein eigenes
 * Projekt UND enthaelt `orders/domain`, `orders/data-access` usw. Eine
 * rekursive Zaehlung ohne diesen Schnitt rechnet dem Eltern-Projekt die Specs
 * seiner Kinder zu. Beim Aufraeumen in #159 hat genau das aus 0 dringenden
 * Faellen 29 gemacht.
 */
export const countSpecFiles = (root, allRoots, fs = { existsSync, readdirSync, statSync }) => {
  const nested = allRoots.filter(r => r !== root && r.startsWith(root + '/'))
  let count = 0
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (nested.some(n => path === n || path.startsWith(n + '/'))) continue
      if (fs.statSync(path).isDirectory()) walk(path)
      else if (SPEC_RE.test(path)) count++
    }
  }
  walk(root)
  return count
}

/** Projekte mit `test`-Target und null Spec-Dateien — sortiert, damit der Diff lesbar bleibt. */
export const collectEmpty = projects =>
  projects
    .filter(p => p.hasTest && p.specCount === 0)
    .map(p => p.name)
    .sort()

/**
 * @returns `added` = neu leer (bricht ab), `resolved` = hat inzwischen Specs
 *          (bricht NICHT ab, aber die Baseline sollte schrumpfen).
 */
export const diffAgainstBaseline = (current, baseline) => {
  const known = new Set(baseline)
  const now = new Set(current)
  return {
    added: current.filter(name => !known.has(name)),
    resolved: baseline.filter(name => !now.has(name)),
  }
}

/** Nx-Graph in einem Aufruf — 86 einzelne `nx show project` waeren zu langsam fuer ein Gate. */
const readProjects = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nx-graph-'))
  const file = join(dir, 'graph.json')
  try {
    execFileSync('pnpm', ['nx', 'graph', '--file=' + file], { cwd: ROOT, stdio: 'ignore' })
    const graph = JSON.parse(readFileSync(file, 'utf8'))
    const nodes = graph.graph?.nodes ?? graph.nodes
    if (!nodes || Object.keys(nodes).length === 0) {
      throw new Error('Nx-Graph ist leer — Messung nicht verwertbar.')
    }
    return Object.entries(nodes).map(([name, node]) => ({
      name,
      root: node.data.root,
      hasTest: Boolean(node.data.targets?.test),
    }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const readBaseline = () => {
  const path = join(ROOT, BASELINE_PATH)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')).emptyTestTargets ?? []
}

const writeBaseline = names => {
  writeFileSync(
    join(ROOT, BASELINE_PATH),
    JSON.stringify(
      {
        _hinweis:
          'Projekte mit test-Target, aber ohne eine einzige Spec-Datei. Neu schreiben mit `pnpm empty-targets:gate:update`. Hintergrund: scripts/empty-test-targets.mjs',
        emptyTestTargets: names,
      },
      null,
      2,
    ) + '\n',
  )
}

const main = () => {
  const update = process.argv.includes('--update')

  const projects = readProjects()
  const allRoots = projects.map(p => p.root)
  const measured = projects.map(p => ({
    ...p,
    specCount: p.hasTest
      ? countSpecFiles(
          join(ROOT, p.root),
          allRoots.map(r => join(ROOT, r)),
        )
      : 0,
  }))
  const withTest = measured.filter(p => p.hasTest)
  const current = collectEmpty(measured)

  // Plausibilitaetssperre: Eine leere Messung bedeutet hier nicht "alles gut",
  // sondern "der Graph kam nicht durch". Ein Gate, das dann gruen meldet, ist
  // schlimmer als keines (vgl. das abgeschnittene nx-Log vom 2026-08-08).
  if (withTest.length === 0) {
    console.error('FEHLER: Kein einziges Projekt mit test-Target gefunden — Messung nicht verwertbar.')
    process.exit(1)
  }

  const quote = `${current.length} von ${withTest.length} test-Targets ohne eine einzige Spec-Datei`

  if (update) {
    writeBaseline(current)
    console.log(`Baseline geschrieben: ${quote}.`)
    return
  }

  const baseline = readBaseline()
  if (baseline === null) {
    console.error(`FEHLER: ${BASELINE_PATH} fehlt. Einmalig anlegen mit \`pnpm empty-targets:gate:update\`.`)
    process.exit(1)
  }

  const { added, resolved } = diffAgainstBaseline(current, baseline)

  console.log(`Leerstand: ${quote}.`)

  if (resolved.length > 0) {
    console.log(`\n${resolved.length} Projekt(e) haben inzwischen Specs — Baseline bitte nachziehen:`)
    for (const name of resolved) console.log(`  + ${name}`)
    console.log('  → pnpm empty-targets:gate:update')
  }

  if (added.length > 0) {
    console.error(`\n${added.length} NEUES leeres test-Target:`)
    for (const name of added) console.error(`  ! ${name}`)
    console.error(
      '\nEin Target ohne Spec meldet in der CI gruen, ohne etwas zu pruefen.\n' +
        'Entweder eine Spec nachziehen — oder, wenn der Leerstand beabsichtigt ist,\n' +
        'mit `pnpm empty-targets:gate:update` quittieren und im PR begruenden.',
    )
    process.exit(1)
  }

  console.log('Kein neues leeres test-Target.')
}

if (process.argv[1] && process.argv[1].endsWith('empty-test-targets.mjs')) main()
