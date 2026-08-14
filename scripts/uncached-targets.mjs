#!/usr/bin/env node
// Cache-Gate: friert ein, WELCHE Targets Ausgaben erzeugen, ohne cachebar zu
// sein, und bricht ab, sobald ein weiteres dazukommt.
//
// WARUM ES DIESES GATE GIBT
// Nx cacht nur Targets mit `cache: true` — entweder lokal in der project.json
// oder ueber einen `targetDefaults`-Eintrag fuer ihren Executor. Fehlt beides,
// laeuft das Target bei JEDEM Lauf neu, und man sieht es nicht: Die Ausgabe ist
// dieselbe, nur langsamer. Bis #216 traf das 52 build-Targets
// (@nx/rollup:rollup, @nx/angular:package) — beide Executors hatten schlicht
// keinen targetDefaults-Eintrag. Gemessen an `orders-domain` ueber vier
// unveraenderte Laeufe: `> nx run orders-domain:build` ohne `[local cache]`,
// waehrend die Abhaengigkeit `common:build` (@nx/js:tsc, hat targetDefaults)
// jedes Mal aus dem Cache kam.
//
// Dieselbe Klasse traf schon #213 (zwei test-Targets mit @nx/vite:test, auch
// ohne targetDefaults). Es ist also kein Einzelfall, sondern das Muster:
// **Ein neuer Executor bringt sein Caching nicht mit.** Genau das faengt dieses
// Gate.
//
// WAS ES PRUEFT
// Jedes Target einer project.json, das `outputs` deklariert — denn nur wer
// Artefakte erzeugt, hat vom Cache etwas — und weder lokal `cache` setzt noch
// einen targetDefaults-Eintrag fuer seinen Executor hat.
//
// `cache: false` gilt als Antwort, nicht als Fund: Wer es ausdruecklich
// abschaltet, hat sich entschieden.
//
// WAHL DES BASELINE-FORMATS
// Baseline ist die sortierte LISTE aus `<projekt>:<target>`, kein Zaehler —
// gleiche Begruendung wie beim Leerstands-Gate nebenan: Ein Zaehler ist blind
// dagegen, dass A cachebar wird (-1) und B neu und ungecacht dazukommt (+1).
//
// WAS IM BESTAND STEHT UND WARUM
// Die 36 Eintraege sind die Domain-Aggregate (`orders`, `users`, …). Ihr
// build-Target fuehrt nur ein `echo` aus und dient als Sammelpunkt; es
// deklariert die dist-Verzeichnisse seiner KINDER als outputs. Es zu cachen
// braechte nichts (das echo dauert Millisekunden) und wuerde die
// Kind-Artefakte ein zweites Mal in den Cache legen. Sie stehen deshalb in der
// Baseline statt in einer Ausnahme-Regel: Eine Liste sagt "diese hier, geprueft",
// eine Regel wuerde auch alles Kuenftige mit durchlassen.
//
// RICHTUNG
// Wachstum bricht ab. Schrumpfen bricht NICHT ab, wird aber gemeldet, damit die
// Baseline nachgezogen wird — sonst verrottet sie zu einer Liste von Targets,
// die laengst cachen.
//
// WAS ES NICHT MISST
// Ob die `outputs` VOLLSTAENDIG sind. Ein Target, das mehr schreibt als es
// deklariert, cacht falsch und stellt bei einem Treffer ein unvollstaendiges
// dist/ wieder her — die gefaehrlichere Fehlerklasse, und dieses Gate sieht sie
// nicht. Gegenprobe dafuer ist manuell: dist loeschen, Task laufen lassen,
// Artefakte vergleichen (so in #216 fuer orders-domain gemacht: 18 Dateien,
// byte-identisch wiederhergestellt).
//
// Aufruf:
//   pnpm targets:uncached:gate         # pruefen (so faehrt es die CI)
//   pnpm targets:uncached:gate:update  # Baseline neu schreiben

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const BASELINE_PATH = 'uncached-targets-baseline.json'

/**
 * Entscheidet fuer ein einzelnes Target, ob es ungecacht Ausgaben erzeugt.
 *
 * `targetDefaults` ist der Block aus nx.json; nachgeschlagen wird unter dem
 * Executor-Namen, weil dieses Repo seine Defaults dort fuehrt (nicht unter dem
 * Target-Namen).
 */
export const istUngecachtMitAusgaben = (definition, targetDefaults) => {
  // Ohne Ausgaben bringt Caching nichts — kein Fund.
  if (!definition?.outputs?.length) return false
  // Ein lokales `cache` ist die Antwort, in beide Richtungen: `true` heisst
  // gecacht, `false` heisst bewusst nicht. Beides ist eine Entscheidung und
  // damit kein Fund.
  if (definition.cache !== undefined) return false
  // Sonst entscheidet der targetDefaults-Eintrag des Executors. Fehlt der
  // Executor ganz, kann nichts greifen.
  if (!definition.executor) return true
  return targetDefaults?.[definition.executor]?.cache !== true
}

/** Sammelt `<projekt>:<target>` fuer alle Targets, die ungecacht Ausgaben erzeugen. */
export const collectUncached = (projekte, targetDefaults) => {
  const treffer = []
  for (const { datei, inhalt } of projekte) {
    for (const [target, definition] of Object.entries(inhalt.targets ?? {})) {
      if (!istUngecachtMitAusgaben(definition, targetDefaults)) continue
      treffer.push({
        id: `${inhalt.name ?? '(ohne name)'}:${target}`,
        executor: definition.executor ?? '(ohne executor)',
        datei,
      })
    }
  }
  return treffer.sort((a, b) => a.id.localeCompare(b.id))
}

/** Vergleicht die aktuelle Liste mit der Baseline. */
export const diffAgainstBaseline = (current, baseline) => {
  const jetzt = new Set(current)
  const frueher = new Set(baseline)
  return {
    added: current.filter(id => !frueher.has(id)),
    resolved: baseline.filter(id => !jetzt.has(id)),
  }
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

const readBaseline = () => {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, BASELINE_PATH), 'utf8'))
  } catch {
    return null
  }
}

const main = () => {
  const update = process.argv.includes('--update')
  const nxJson = JSON.parse(readFileSync(resolve(ROOT, 'nx.json'), 'utf8'))
  const targetDefaults = nxJson.targetDefaults ?? {}

  const projekte = readProjects()

  // Plausibilitaetssperre: Eine leere Messung heisst hier nicht "alles cachebar",
  // sondern "es wurde nichts gelesen". Ein Gate, das dann gruen meldet, ist
  // schlimmer als keines (vgl. das abgeschnittene nx-Log vom 2026-08-08).
  if (projekte.length === 0) {
    console.error('FEHLER: Keine project.json gefunden — Messung nicht verwertbar.')
    process.exit(1)
  }
  const mitOutputs = projekte.flatMap(p => Object.values(p.inhalt.targets ?? {}).filter(t => t?.outputs?.length)).length
  if (mitOutputs === 0) {
    console.error('FEHLER: Kein einziges Target mit outputs gefunden — Messung nicht verwertbar.')
    process.exit(1)
  }

  const treffer = collectUncached(projekte, targetDefaults)
  const current = treffer.map(t => t.id)
  const quote = `${current.length} von ${mitOutputs} Targets mit outputs sind nicht cachebar`

  if (update) {
    writeFileSync(resolve(ROOT, BASELINE_PATH), `${JSON.stringify(current, null, 2)}\n`)
    console.log(`Baseline geschrieben: ${quote}.`)
    return
  }

  const baseline = readBaseline()
  if (baseline === null) {
    console.error(`FEHLER: ${BASELINE_PATH} fehlt. Einmalig anlegen mit \`pnpm targets:uncached:gate:update\`.`)
    process.exit(1)
  }

  const { added, resolved } = diffAgainstBaseline(current, baseline)
  console.log(`Ungecacht: ${quote}.`)

  if (resolved.length > 0) {
    console.log(`\n${resolved.length} Target(s) cachen inzwischen — Baseline bitte nachziehen:`)
    for (const id of resolved) console.log(`  + ${id}`)
    console.log('  → pnpm targets:uncached:gate:update')
  }

  if (added.length > 0) {
    const details = new Map(treffer.map(t => [t.id, t]))
    console.error(`\n${added.length} NEUES Target erzeugt Ausgaben, ohne cachebar zu sein:`)
    for (const id of added) {
      const t = details.get(id)
      console.error(`  ! ${id} (${t.executor})\n    ${t.datei}`)
    }
    console.error(
      '\nEs laeuft damit bei jedem CI-Lauf neu, ohne dass man es der Ausgabe ansieht.\n' +
        'Meist fehlt nur ein targetDefaults-Eintrag fuer den Executor in nx.json:\n' +
        '  "<executor>": { "cache": true, "dependsOn": ["^build"], "inputs": ["production", "^production"] }\n' +
        'Vor dem Aktivieren pruefen, ob die `outputs` VOLLSTAENDIG sind — sonst stellt\n' +
        'ein Cache-Treffer ein unvollstaendiges dist/ wieder her (Gegenprobe: dist\n' +
        'loeschen, Task laufen lassen, Artefakte vergleichen).\n' +
        'Ist das Target bewusst ungecacht, mit `pnpm targets:uncached:gate:update`\n' +
        'quittieren und im PR begruenden.',
    )
    process.exit(1)
  }

  console.log('Kein neues ungecachtes Target mit Ausgaben.')
}

if (process.argv[1] && process.argv[1].endsWith('uncached-targets.mjs')) main()
