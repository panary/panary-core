#!/usr/bin/env node
/**
 * Gate: jede `@source`-Zeile der Tailwind-Einstiegsdateien traegt etwas bei.
 *
 * **Warum.** Seit core#1138 laden pos-client, admin-client und setup-client Tailwind
 * mit `source(none)` — gescannt wird ausschliesslich, was die `@source`-Zeilen
 * deklarieren. Vorher wurzelte die automatische Quellensuche im Repo-Root und lief
 * durch `.nx/cache`; bei 15.560 Cache-Eintraegen blieb `nx serve pos-client` die
 * ganze Nacht bei „Building..." stehen. Mit `source(none)` entscheidet die
 * Korrektheit der `@source`-Zeilen darueber, ob das CSS existiert. Und sie scheitern
 * **still**: Ein `@source` mit Stern in einem VERZEICHNIS-Segment, das auf ein
 * Verzeichnis endet (der Bestand vor #1138: `libs/shared/<stern>/src`), matcht in
 * Tailwind 4 nichts — ohne Warnung, ohne Fehler, bei gruenem Build. In cloud lieferte
 * genau das 1666 statt 3162 Klassen (panary/panary-cloud#293, #301); dieses Gate ist
 * die core-Fassung des dortigen `scripts/tailwind-source-gate.mjs`.
 *
 * **Wie gemessen wird: durch Tailwind hindurch, nie daneben.** Das Gate baut die
 * Glob-Semantik nicht in Node nach — es kompiliert die Einstiegsdatei mit
 * `@tailwindcss/postcss` und vergleicht Klassenmengen. `.scss`-Einstiege (pos-client)
 * laufen vorher durch dasselbe sass, das `@angular/build` benutzt, wie im echten Build.
 *
 * Zwei Pruefungen:
 *
 * 1. **Beitrag je Zeile** (leave-one-in) — kompiliert wird einmal ohne jede
 *    `@source`-Zeile (Basis) und dann je einmal mit genau EINER Zeile. Bringt eine
 *    Zeile keine Klasse ueber die Basis hinaus, traegt sie nichts bei → Abbruch.
 *    Leave-one-out haette nur den *exklusiven* Beitrag gemessen; Ueberschneidungen
 *    zweier Globs waeren keinem zugerechnet worden (Begruendung im cloud-Gate).
 * 2. **Kanarienvoegel** — je Einstiegsdatei und Quelle eine Utility, die genau dort
 *    vorkommt. Sie muss (a) in der Kompilierung DIESER Quelle auftauchen — das faengt
 *    „Glob matcht Dateien, aber die falschen" — und (b) in der vollen Kompilierung
 *    ihrer Einstiegsdatei. Ohne (b) waere das Loeschen einer ganzen `@source`-Zeile
 *    gruen: Der Kanarienvogel fiele mit der Zeile aus Pruefung (a) heraus.
 *
 * Anders als in cloud sind die Kanarienvoegel an die **Einstiegsdatei** gebunden:
 * Alle drei Apps deklarieren `@source "./app"`, aber jede meint ihr eigenes `app/`.
 *
 * 🚨 **`@tailwindcss/postcss` cacht prozessweit nach `from`-Pfad.** Jede Variante
 * bekommt deshalb einen eigenen virtuellen Dateinamen im Verzeichnis der
 * Einstiegsdatei — nie geschrieben, nur Aufloesungs-Basis und Cache-Schluessel.
 *
 * **Was das Gate NICHT prueft:** dass die Globs *alles* Noetige erfassen. Eine neue
 * Lib an einem Pfad, den kein Glob abdeckt, bleibt unsichtbar. Ebenso wenig
 * dynamisch zusammengesetzte Klassennamen (`'bg-' + farbe`) und Klassen in Dateien
 * ausserhalb von `*.{html,ts}`.
 *
 * Aufruf: `pnpm tailwind:gate` (Exit 1 = Verstoss, Exit 2 = Messung kaputt).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Untergrenze je Einstiegsdatei (Kollaps-Schutz).
 *
 * Am 2026-10-27 waren es 1039 (pos-client), 1298 (admin-client) und 1054
 * (setup-client). Die Schranke faengt nur den Totalausfall der Kompilierung; der
 * Verlust eines einzelnen Globs liegt darueber und faellt der Beitragspruefung zu.
 */
export const MIN_EXPECTED_CLASSES = 700

/**
 * Kanarienvoegel: Einstiegsdatei + Quelle → die Utility, die diese Quelle finden MUSS.
 *
 * Ausgewaehlt je Quelle eine Utility, die in der Leave-one-in-Menge dieser Quelle
 * exklusiv vorkommt (gemessen 2026-10-27) und moeglichst fest verankert ist. Wird ein
 * Vorkommen entfernt, gehoert der Eintrag ersetzt, nicht geloescht.
 */
const DOMAINS = '../../../libs/domains/*/*/src/**/*.{html,ts}'
const SHARED = '../../../libs/shared/*/src/**/*.{html,ts}'
const LIB_APPS = '../../../libs/apps/*/*/src/**/*.{html,ts}'
const ENTRIES = [
  'apps/pos-client/src/styles.scss',
  'apps/admin-client/src/styles.css',
  'apps/setup-client/src/styles.css',
]

// Die drei Lib-Globs sind in allen Einstiegen gleich, also auch ihre Kanarienvoegel.
const LIB_CANARIES = [
  {
    className: 'bottom-[calc(100%-0.25rem)]',
    source: DOMAINS,
    file: 'libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.html',
    why: 'Arbitrary Value des Numpad-Popups der Kasse, kommt nur dort vor',
  },
  {
    className: 'h-[4.25rem]',
    source: SHARED,
    file: 'libs/shared/ui-common/src/lib/page-header/page-header.component.ts',
    why: 'feste Hoehe des geteilten Seitenkopfs',
  },
  {
    className: 'z-[1200]',
    source: LIB_APPS,
    file: 'libs/apps/pos-client/shell/src/lib/shell/idle-warning-overlay.component.ts',
    why: 'Rueckfall-z-index der Auto-Logout-Warnung, kommt nur dort vor',
  },
]

// `apps/pos-client/src/app` hat bewusst keinen: Dort liegen keine Templates, die Zeile findet
// nur CSS-Text aus dem Nx-Geruest `nx-welcome.ts`. Faellt die Datei weg, meldet die
// Beitragspruefung die Zeile als wirkungslos — dann gehoert sie entfernt.
export const CANARIES = [
  ...ENTRIES.flatMap(entry => LIB_CANARIES.map(canary => ({ ...canary, entry }))),
  {
    entry: 'apps/admin-client/src/styles.css',
    className: 'auth-dots',
    source: './app',
    file: 'apps/admin-client/src/app/features/login.ts',
    why: 'eigene @utility aus theme.css, nur im Login-Hintergrund des Admin-Clients',
  },
  {
    entry: 'apps/setup-client/src/styles.css',
    className: 'tracking-tighter',
    source: './app',
    file: 'apps/setup-client/src/app/landing/landing.html',
    why: 'Titel der Einstiegsseite, sonst nirgends im Repo',
  },
]

/** Findet die Tailwind-Einstiegsdateien — nie den Pfad hart annehmen. */
export const findEntryFiles = () => {
  const files = execFileSync('git', ['ls-files', '--', '*.css', '*.scss'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  // `@import 'tailwindcss'` (CSS) oder `@use 'tailwindcss'` (SCSS) ist der Einstieg —
  // mit oder ohne `source(...)`. `@reference "tailwindcss"` in Komponenten-Styles nicht.
  return files.filter(path =>
    /^\s*@(?:import|use)\s+['"]tailwindcss['"]/m.test(readFileSync(resolve(REPO_ROOT, path), 'utf8')),
  )
}

/**
 * Laedt die Einstiegsdatei Tailwind mit `source(none)`?
 *
 * Das ist der eigentliche Schutz aus core#1138 — ohne ihn walkt die automatische
 * Suche wieder `.nx/cache`, und alle anderen Pruefungen blieben gruen: Jede
 * `@source`-Zeile truege weiter bei, nur kaeme nichts mehr ueber sie allein.
 */
export const hasSourceNone = css => /^\s*@import\s+['"]tailwindcss['"]\s+source\(\s*none\s*\)\s*;/m.test(css)

/**
 * Zerlegt eine Einstiegsdatei in ihre `@source`-Zeilen.
 *
 * Zeilenbasiert und bewusst streng: Eine `@source`-Deklaration, die nicht in
 * derselben Zeile mit `;` endet, meldet `unparsable` und macht die Messung
 * ungueltig, statt sie zu raten.
 */
export const collectSourceLines = css => {
  const lines = css.split('\n')
  const sources = []
  const unparsable = []
  lines.forEach((raw, index) => {
    if (!/^\s*@source\b/.test(raw)) return
    const match = /^\s*@source\s+(.*);\s*$/.exec(raw)
    if (!match) {
      unparsable.push({ index, raw })
      return
    }
    const argument = match[1].trim()
    // `@source not "…"` schliesst Pfade AUS — die Beitragspruefung waere dort falsch herum.
    const negated = /^not\b/.test(argument)
    const quoted = /^(?:not\s+)?['"]([^'"]*)['"]$/.exec(argument)
    sources.push({ index, raw, argument, negated, value: quoted ? quoted[1] : argument })
  })
  return { lines, sources, unparsable }
}

/** Zieht die Klassennamen aus kompiliertem CSS (entschaerfte Escapes). */
export const extractClasses = cssOutput => {
  const classes = new Set()
  for (const rule of cssOutput.matchAll(/([^{};]+)\{/g)) {
    if (rule[1].trimStart().startsWith('@')) continue
    for (const name of rule[1].matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
      classes.add(name[1].replace(/\\(.)/g, '$1'))
    }
  }
  return classes
}

/**
 * Das sass, das `@angular/build` mitbringt — nicht irgendeins aus dem Store: Das
 * Gate soll messen, was der Build sieht.
 */
const loadSass = () => {
  const require = createRequire(import.meta.url)
  const angularBuild = realpathSync(join(REPO_ROOT, 'node_modules', '@angular', 'build'))
  return require(require.resolve('sass', { paths: [angularBuild] }))
}

/**
 * Wandelt eine `.scss`-Einstiegsdatei in CSS, bevor Tailwind sie sieht — dieselbe
 * Reihenfolge wie im Angular-Build. Bare-Imports (`@angular/material`) loesen ueber
 * `node_modules` auf.
 */
export const preprocess = (text, from) => {
  if (!from.endsWith('.scss')) return text
  return loadSass().compileString(text, {
    url: pathToFileURL(from),
    loadPaths: [join(REPO_ROOT, 'node_modules')],
    silenceDeprecations: ['import'],
    quietDeps: true,
  }).css
}

/**
 * Kompiliert CSS und liefert die Klassenmenge.
 *
 * `from` bestimmt, wogegen relative `@source`/`@import`-Pfade aufloesen — und
 * zugleich den Cache-Schluessel des Plugins. Die Datei muss nicht existieren.
 */
export const compileClasses = async (cssText, from) => {
  const result = await postcss([tailwind()]).process(preprocess(cssText, from), { from })
  return extractClasses(result.css)
}

/**
 * Misst eine Einstiegsdatei durch.
 *
 * Rueckgabe: `{ total, full, base, results, canaryMisses, uncovered, unparsable }`.
 * `results` traegt je `@source`-Zeile die netto beigetragenen Klassen.
 */
export const analyzeEntry = async (entryPath, css, canaries = CANARIES) => {
  const { lines, sources, unparsable } = collectSourceLines(css)
  if (unparsable.length > 0) return { unparsable }

  const absolute = resolve(REPO_ROOT, entryPath)
  const extension = absolute.endsWith('.scss') ? 'scss' : 'css'
  // Nie geschrieben — nur Aufloesungs-Basis und Cache-Schluessel.
  const virtualFrom = label => join(dirname(absolute), `__tailwind-source-gate.${label}.${extension}`)
  // `keep === null` = keine einzige @source-Zeile (Basis).
  const withOnly = keep => lines.filter((_, i) => !sources.some(s => s.index === i) || i === keep).join('\n')

  const full = await compileClasses(css, virtualFrom('voll'))
  const base = await compileClasses(withOnly(null), virtualFrom('basis'))

  const results = []
  for (const source of sources) {
    if (source.negated) {
      results.push({ ...source, skipped: true })
      continue
    }
    const only = await compileClasses(withOnly(source.index), virtualFrom(`nur-${source.index}`))
    const added = [...only].filter(name => !base.has(name))
    results.push({ ...source, added: added.length, classes: only })
  }

  const own = canaries.filter(canary => canary.entry === entryPath)
  // Pruefung (a): Findet die zugeordnete Quelle den Kanarienvogel? Fehlt die Zeile
  // ganz, faellt das hier ebenfalls auf — ein Eintrag ohne Zeile ist ein Treffer.
  const canaryMisses = own.filter(canary => {
    const result = results.find(item => item.value === canary.source)
    return !result?.classes?.has(canary.className)
  })
  // Pruefung (b): Kommt er in der vollen Kompilierung ueberhaupt heraus?
  const canaryVanished = own.filter(canary => !full.has(canary.className))
  // Eine Quelle ohne Kanarienvogel ist kein Verstoss, nur ein Hinweis.
  const uncovered = sources.filter(source => !source.negated && !own.some(canary => canary.source === source.value))

  return { total: full.size, full, base: base.size, results, canaryMisses, canaryVanished, uncovered, unparsable: [] }
}

const main = async () => {
  const entries = findEntryFiles()
  if (entries.length === 0) {
    console.error(
      'tailwind-source-Gate: keine Einstiegsdatei mit `@import`/`@use` "tailwindcss" gefunden.\n' +
        'Entweder ist Tailwind ausgebaut worden oder die Suche greift nicht mehr — so oder so\n' +
        'misst das Gate nichts und darf nicht gruen melden.',
    )
    process.exit(2)
  }

  // Ein Kanarienvogel, dessen Einstiegsdatei nicht mehr gefunden wird, prueft nichts mehr.
  const orphans = CANARIES.filter(canary => !entries.includes(canary.entry))
  if (orphans.length > 0) {
    console.error('tailwind-source-Gate: Kanarienvoegel ohne gefundene Einstiegsdatei:')
    for (const canary of orphans) console.error(`  "${canary.className}" → ${canary.entry}`)
    process.exit(2)
  }

  let violations = 0
  for (const entry of entries) {
    const css = readFileSync(resolve(REPO_ROOT, entry), 'utf8')
    if (!hasSourceNone(css)) {
      violations++
      console.error(
        `\ntailwind-source-Gate: ${entry} laedt Tailwind ohne \`@import 'tailwindcss' source(none);\`.\n` +
          'Dann wurzelt die automatische Quellensuche im Repo-Root und walkt `.nx/cache` — bei grossem\n' +
          'Cache haengt `nx serve` unbegrenzt bei „Building..." (core#1138). In SCSS ebenfalls als\n' +
          'Plain-CSS-@import, nicht als `@use`: `@use` kennt keinen `source(...)`-Zusatz.',
      )
    }
    const report = await analyzeEntry(entry, css)

    if (report.unparsable.length > 0) {
      console.error(`tailwind-source-Gate: ${entry} enthaelt @source-Zeilen, die nicht zeilenweise lesbar sind:`)
      for (const item of report.unparsable) console.error(`  Zeile ${item.index + 1}: ${item.raw.trim()}`)
      console.error('Eine @source-Deklaration muss in ihrer Zeile mit ";" enden — sonst ist die Messung ungueltig.')
      process.exit(2)
    }

    if (report.total < MIN_EXPECTED_CLASSES) {
      console.error(
        `tailwind-source-Gate: ${entry} kompiliert zu nur ${report.total} Klassen ` +
          `(erwartet >= ${MIN_EXPECTED_CLASSES}).\n` +
          'Das ist kein einzelner verlorener Glob mehr, sondern ein Totalausfall der Kompilierung —\n' +
          'die Messung waere wertlos, deshalb Abbruch statt Befund.',
      )
      process.exit(2)
    }

    console.log(`tailwind-source-Gate: ${entry} — ${report.total} Klassen, ${report.base} davon ohne jedes @source.`)
    for (const item of report.results) {
      if (item.skipped) console.log(`  Zeile ${item.index + 1}: ${item.raw.trim()}  (negativ, nicht geprueft)`)
      else console.log(`  Zeile ${item.index + 1}: +${item.added} Klassen  ${item.raw.trim()}`)
    }

    const dead = report.results.filter(item => !item.skipped && item.added === 0)
    if (dead.length > 0) {
      violations += dead.length
      console.error(`\ntailwind-source-Gate: ${dead.length} wirkungslose @source-Zeile(n) in ${entry}:`)
      for (const item of dead) console.error(`  Zeile ${item.index + 1}: ${item.raw.trim()}`)
      console.error(
        '\nDiese Zeile findet keine Datei, die nicht schon ohne sie gefunden wuerde. Haeufigste Ursache:\n' +
          'ein Stern in einem VERZEICHNIS-Segment ohne abschliessendes Dateimuster — `libs/shared/<stern>/src`\n' +
          'matcht in Tailwind 4 nichts, `libs/shared/<stern>/src/<stern><stern>/<stern>.{html,ts}` schon.',
      )
    }

    const missed = [...new Set([...report.canaryMisses, ...report.canaryVanished])]
    if (missed.length > 0) {
      violations += missed.length
      console.error(`\ntailwind-source-Gate: ${missed.length} Kanarienvogel fehlt in ${entry}:`)
      for (const canary of missed) {
        const where = report.canaryVanished.includes(canary) ? 'in der vollen Kompilierung' : 'von seiner Quelle'
        console.error(
          `  "${canary.className}" (@source "${canary.source}") nicht gefunden ${where}.\n` +
            `      erwartet aus: ${canary.file}\n` +
            `      warum diese Klasse: ${canary.why}`,
        )
      }
      console.error(
        '\nEntweder die @source-Zeile fehlt, der Glob erfasst die genannte Datei nicht mehr, oder das\n' +
          'Vorkommen wurde dort entfernt. Im letzten Fall gehoert der Eintrag in CANARIES\n' +
          '(scripts/tailwind-source-gate.mjs) ersetzt — nicht geloescht.',
      )
    }

    for (const item of report.uncovered) {
      console.log(`  Hinweis: fuer @source "${item.value}" gibt es keinen Kanarienvogel (nur Beitrag geprueft).`)
    }
  }

  if (violations > 0) process.exit(1)
  console.log(`\ntailwind-source-Gate: ${entries.length} Einstiegsdatei(en) geprueft — alle @source-Zeilen wirksam.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
