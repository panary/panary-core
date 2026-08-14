#!/usr/bin/env node
// Ueberschreibungs-Gate: bricht ab, sobald eine `project.json` ein Target selbst
// deklariert, das ein Nx-Plugin ohnehin inferiert.
//
// WARUM ES DIESES GATE GIBT
// Generatoren schreiben `"lint": { "executor": "@nx/eslint:lint" }` unbesehen in
// jede frische project.json. Das laeuft gruen und sieht harmlos aus — es
// ueberschreibt aber das inferierte Target samt dessen Cache-Inputs. In #206
// waren so 46 Projekte betroffen; sie erbten stattdessen die Inputs aus
// `targetDefaults`, und dort standen `.eslintrc.json` und `.eslintignore` —
// zwei Dateien, die es im Repo gar nicht gibt (Flat Config).
//
// Gefehlt haben `^default` (eine Aenderung in einer Abhaengigkeit invalidierte
// den Lint-Cache nicht) und `externalDependencies: ["eslint"]` (ein
// eslint-Versionswechsel ebenso wenig).
//
// ⚠️ NICHT gefehlt hat die projektlokale `eslint.config.mjs`. Das stand bis
// 2026-08-14 hier und in #206 und war falsch: `default` ist in nx.json als
// `{projectRoot}/**/*` definiert, die Datei liegt im projectRoot und war damit
// erfasst — nachgemessen in #209 am wiederhergestellten alten Stand von
// `libs/shared/ui-notifications`. Der Aufraeum-Grund bleibt, der belegte Schaden
// ist ein anderer. Wer die Begruendung dieses Gates weitererzaehlt, erzaehle die
// gemessene.
//
// Dieselbe Klasse wie #204 (Target hiess anders als die CI rief) und #202
// (Target existierte gar nicht): nicht "etwas ist kaputt", sondern "niemand
// sieht, dass etwas anderes passiert als gedacht".
//
// WARUM OHNE BASELINE
// Der Bestand ist 0 — nach #206 deklariert kein Projekt mehr eines der
// geschuetzten Targets. Eine Baseline waere Maschinerie ohne Inhalt, und ein
// hartes Gate ist das staerkere Versprechen (dieselbe Abwaegung wie beim
// Typecheck-Gate, ADR 0022). Das Leerstands-Gate nebenan braucht seine Baseline,
// weil dort 45 Faelle Bestand sind; hier gibt es nichts einzufrieren.
//
// WELCHE TARGETS GESCHUETZT SIND
// Die Namen werden aus `nx.json` gelesen, nicht hartkodiert: Wird ein
// `targetName` umbenannt (wie `eslint:lint` -> `lint` in #204), zieht das Gate
// automatisch mit, statt still den falschen Namen zu bewachen.
//
// Ausgenommen ist nur noch `build`: 98 Faelle im Bestand (@nx/rollup:rollup,
// @nx/angular:package, @nx/esbuild:esbuild, @nx/js:tsc,
// @angular/build:application) — echte Build-Konfigurationen mit eigenen
// Optionen. Eine Executor-Allowlist waere dort wirkungslos, weil viele davon
// generisches `nx:run-commands` fahren; ein Gate haette fast nur Fehlalarme und
// wuerde weggeklickt.
//
// `test` war bis #213 ebenfalls ausgenommen — mit der Begruendung "5 Faelle,
// null echte Funde". Diese Einschaetzung war zu grob: Zwei der fuenf waren
// echte Drift, und zwar teure. `businessdays-aggregator` und
// `orders-feature-pos-order-dialog` deklarierten `test` mit `@nx/vite:test`,
// demselben Executor, den das Plugin ohnehin nutzt — und fuer den es KEIN
// `targetDefaults` gibt. Das Target erbte damit weder `cache: true` noch
// `inputs`: Gemessen am Aggregator (162 Tests) lief der unveraenderte zweite
// Lauf jedes Mal neu durch, waehrend das inferierte Target meldet "Nx read the
// output from the cache". Die beiden Projekte haben ihre Tests also bei jedem
// CI-Lauf neu ausgefuehrt.
//
// Statt `test` pauschal freizugeben, steht dort jetzt eine Executor-Allowlist
// (ERLAUBTE_EXECUTOREN): Die drei Angular-Apps fahren bewusst
// `@angular/build:unit-test` — dafuer existiert ein targetDefaults-Eintrag, sie
// cachen korrekt. Eine vierte Angular-App muss deshalb nichts quittieren,
// waehrend ein `@nx/vite:test` weiterhin anschlaegt.
//
// Aufruf:
//   pnpm targets:overrides:gate

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Target-Namen, die gar nicht geprueft werden — Begruendung im Kopfkommentar.
 * Die Liste ist bewusst kurz und soll es bleiben: Jeder Eintrag ist ein Stueck
 * Abdeckung, das aufgegeben wird. `test` stand hier bis #213 und ist raus,
 * seit die Executor-Allowlist unten den legitimen Fall genauer trifft.
 */
export const UNGESCHUETZT = new Set(['build'])

/**
 * Executoren, die fuer einen geschuetzten Target-Namen erlaubt bleiben.
 *
 * Genauer als ein pauschales Freigeben des Namens: `test` wird bewacht, aber die
 * drei Angular-Apps duerfen ihren eigenen Test-Builder behalten. Sie fahren
 * `@angular/build:unit-test` statt Vitest, und dafuer existiert ein
 * `targetDefaults`-Eintrag — sie cachen also korrekt, anders als die beiden
 * `@nx/vite:test`-Faelle aus #213.
 *
 * Ein Eintrag hier ist eine Ausnahme mit Namen und Grund, kein Freibrief fuer den
 * ganzen Target-Namen. Wer einen hinzufuegt, sollte belegen koennen, dass der
 * Executor etwas tut, was die Inferenz nicht kann.
 */
export const ERLAUBTE_EXECUTOREN = { test: ['@angular/build:unit-test'] }

/**
 * Sammelt aus den Plugin-Optionen einer nx.json alle Namen, unter denen Targets
 * inferiert werden.
 *
 * Erkannt werden Schluessel, die auf `targetName` oder `DepsName` enden — das
 * deckt `targetName`, `testTargetName`, `ciTargetName`, `buildTargetName`,
 * `buildDepsName` und `watchDepsName` ab, aber nicht `configName`
 * (`tsconfig.lib.json`) oder `testMode` (`watch`), die keine Targets benennen.
 * Die Suche laeuft rekursiv, weil `@nx/js/typescript` seine Namen eine Ebene
 * tiefer fuehrt (`options.typecheck.targetName`).
 *
 * ⚠️ Das `[Tt]` ist nicht kosmetisch: `@nx/vitest` schreibt `testTargetName` und
 * `ciTargetName` mit grossem T. Ein Muster auf `/targetName$/` uebersieht beide,
 * und das Gate haette `test-ci` still nie bewacht — es haette gruen gemeldet und
 * dabei eine Luecke gehabt, also genau den Fehler begangen, gegen den es gebaut
 * ist. Gefunden hat das der Spec, nicht der erste Lauf gegen den Bestand: Der war
 * gruen, weil dort ohnehin kein Projekt ein `test-ci` deklariert.
 */
export const inferredTargetNames = nxJson => {
  const namen = new Set()
  const walk = wert => {
    if (!wert || typeof wert !== 'object') return
    if (Array.isArray(wert)) return wert.forEach(walk)
    for (const [schluessel, v] of Object.entries(wert)) {
      if (typeof v === 'string' && /([Tt]argetName|DepsName)$/.test(schluessel)) namen.add(v)
      else walk(v)
    }
  }
  walk(nxJson.plugins ?? [])
  return namen
}

/** Die inferierten Namen ohne die bewusst ungeschuetzten. */
export const protectedTargetNames = nxJson =>
  new Set([...inferredTargetNames(nxJson)].filter(name => !UNGESCHUETZT.has(name)))

/**
 * Findet in den gelesenen project.json-Inhalten alle Targets, die einen
 * geschuetzten Namen selbst deklarieren — ohne die, deren Executor fuer diesen
 * Namen ausdruecklich erlaubt ist (ERLAUBTE_EXECUTOREN).
 *
 * `projekte` ist eine Liste aus `{ datei, inhalt }`, damit der Spec ohne
 * Dateisystem auskommt.
 */
export const findOverrides = (projekte, geschuetzt, erlaubt = ERLAUBTE_EXECUTOREN) => {
  const treffer = []
  for (const { datei, inhalt } of projekte) {
    for (const [target, definition] of Object.entries(inhalt.targets ?? {})) {
      if (!geschuetzt.has(target)) continue
      const executor = definition?.executor ?? '(ohne executor)'
      if (erlaubt[target]?.includes(executor)) continue
      treffer.push({ projekt: inhalt.name ?? '(ohne name)', target, executor, datei })
    }
  }
  return treffer.sort((a, b) => a.projekt.localeCompare(b.projekt) || a.target.localeCompare(b.target))
}

const readProjects = () => {
  const ausgabe = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*project.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return ausgabe
    .split('\n')
    .filter(Boolean)
    .map(datei => ({ datei, inhalt: JSON.parse(readFileSync(resolve(ROOT, datei), 'utf8')) }))
}

const main = () => {
  const nxJson = JSON.parse(readFileSync(resolve(ROOT, 'nx.json'), 'utf8'))
  const geschuetzt = protectedTargetNames(nxJson)

  // Plausibilitaetssperre, zweifach. Eine leere Messung heisst hier nicht "alles
  // sauber", sondern "es wurde nichts gemessen" — und ein Gate, das dann gruen
  // meldet, ist schlimmer als keines (vgl. das abgeschnittene nx-Log vom
  // 2026-08-08, das ein Gate mit Exit 0 gruen melden liess).
  if (geschuetzt.size === 0) {
    console.error(
      'FEHLER: In nx.json wurden keine inferierten Target-Namen gefunden — Messung nicht verwertbar.\n' +
        'Entweder fehlt der plugins-Block, oder die Optionen heissen anders als erwartet.',
    )
    process.exit(1)
  }

  const projekte = readProjects()
  if (projekte.length === 0) {
    console.error('FEHLER: Keine project.json gefunden — Messung nicht verwertbar.')
    process.exit(1)
  }

  const treffer = findOverrides(projekte, geschuetzt)
  const bewacht = [...geschuetzt].sort().join(', ')

  if (treffer.length > 0) {
    console.error(`${treffer.length} explizite(s) Target, das ein Plugin ohnehin inferiert:\n`)
    for (const t of treffer) console.error(`  ! ${t.projekt} — "${t.target}" (${t.executor})\n    ${t.datei}`)
    console.error(
      '\nEin solches Target ueberschreibt das inferierte samt dessen Cache-Inputs.\n' +
        'Beim lint-Target fehlten dadurch `^default` (Aenderung in einer Abhaengigkeit)\n' +
        'und `externalDependencies: ["eslint"]` (Versionswechsel) — der Cache galt\n' +
        'weiter, obwohl sich etwas Relevantes geaendert hatte (panary/panary-core#206,\n' +
        'Messung in #209). Beim test-Target fehlte `cache` ganz: die Tests liefen bei\n' +
        'jedem CI-Lauf neu (#213).\n' +
        'Loeschen — bleibt danach "targets": {} uebrig, den Schluessel gleich mit.',
    )
    process.exit(1)
  }

  console.log(`Kein explizites Target ueberschreibt eine Plugin-Inferenz (bewacht: ${bewacht}).`)
  // Die Ausnahmen mitdrucken: Eine Abdeckung, die man nur im Quelltext nachlesen
  // kann, wird ueberschaetzt. `build` fehlt in "bewacht" — ohne diese Zeile faellt
  // das niemandem auf, der nur die gruene Ausgabe sieht.
  const erlaubtText = Object.entries(ERLAUBTE_EXECUTOREN)
    .map(([target, executoren]) => `${target}: ${executoren.join(', ')}`)
    .join(' | ')
  console.log(`Ungeprueft: ${[...UNGESCHUETZT].sort().join(', ')}. Erlaubte Ausnahmen — ${erlaubtText}.`)
  console.log(`${projekte.length} project.json geprueft.`)
}

if (process.argv[1] && process.argv[1].endsWith('inferred-target-overrides.mjs')) main()
