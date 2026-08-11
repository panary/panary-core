#!/usr/bin/env node
// Rendert die ADR-Liste aus dem Frontmatter der Dateien in docs/adr/ statt sie in
// docs/adr/index.md zu pflegen. BEWUSST kein Generat, das committet wird — gleiche
// Begruendung wie bei docs-log.mjs: Eine gepflegte Liste im Repo ist die eine Datei,
// die jeder ADR-PR am selben Ort (Listenende) anfasst, also genau der Merge-Konflikt,
// wegen dem es das Skript gibt (#161). Ein generiertes, aber committetes Generat haette
// den Konflikt NICHT geloest, nur seine Aufloesung verbilligt — und der eigentliche
// Schaden ist nicht die Aufloesung, sondern dass GitHub fuer einen konfliktbehafteten
// PR ueberhaupt keine Checks startet: Der PR sieht aus, als liefe die CI, und haengt.
//
// Spiegel von panary/panary-cloud#179 (dort ADR 0049). Die Datei ist absichtlich
// zeichengleich mit der cloud-Fassung bis auf diesen Kopf und die Nummer in der
// Drift-Meldung — zwei auseinanderlaufende Kopien waeren teurer als die Duplikation,
// und eine geteilte Lib gibt es fuer Repo-Werkzeuge nicht (Option A, ADR 0002).
//
//   pnpm docs:adr:index          annotierte Liste nach stdout
//   pnpm docs:adr:index:check    nur pruefen (Namen, Frontmatter, Doppelnummern), Exit 1
//   pnpm docs:adr:next           naechste freie Nummer — ueber origin/main UND alle Worktrees
//
// `--next` ist der zweite Teil: Am 2026-08-10 hatten drei parallele Sessions gleichzeitig
// 0046 in panary-cloud belegt (cloud#133, #148, #129), sichtbar wurde es erst ueber einen
// bereits gemergten Kommentar im anderen Repo. Eine Nummer ist eine laufende Sequenz und
// damit abstimmungspflichtig — dieselbe Eigenschaft, wegen der die Log-Fragmente auf die
// Issue-Nummer statt auf eine Tagessequenz gehen (#137). Weil ein ADR-Bezug wie "ADR 0018"
// quer durch beide Repos zitiert wird, bleibt die Sequenz; abgestimmt wird sie maschinell.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ADR_DIR = join(ROOT, 'docs', 'adr')
export const NAME_RE = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/

// Genau die Form, die `render` erzeugt. Der Check verbietet sie in index.md — sonst
// waechst die Liste dort still wieder nach und der Konflikt ist zurueck. Bewusst an
// den Listenpunkt gebunden: Ein ADR-Link im Fliesstext (die Begruendung verlinkt eins)
// ist erlaubt und trifft dieses Muster nicht.
export const LIST_LINE_RE = /^\s*[*-]\s+\[[^\]]*\]\(\d{4}-[a-z0-9-]+\.md\)/

export const parseName = file => {
  const match = NAME_RE.exec(file)
  return match ? { nr: Number(match[1]), padded: match[1], slug: match[2] } : null
}

// Minimaler Frontmatter-Leser fuer die drei Skalare, die die Liste braucht. Bewusst
// kein YAML-Parser als Dependency und bewusst zeilenweise: Verschachtelte Bloecke
// (`sources:`) werden dadurch schlicht ignoriert statt halb verstanden. Ein gefalteter
// Wert (`description: >`) faellt als leerer Wert auf und wird gemeldet, nicht geraten.
export const parseFrontmatter = text => {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return null

  const fields = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') return fields
    const match = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(line)
    if (match) fields[match[1]] = unquote(match[2].trim())
  }
  return null // schliessendes --- fehlt
}

const unquote = value => {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

export const readAdrs = (dir = ADR_DIR) => {
  let files
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md'))
  } catch {
    return { adrs: [], problems: ['Verzeichnis fehlt: docs/adr/'] }
  }

  const adrs = []
  const problems = []

  for (const file of files.sort()) {
    if (file === 'index.md') continue
    const parsed = parseName(file)
    if (!parsed) {
      problems.push(`${file}: Dateiname passt nicht auf NNNN-<kebab-slug>.md`)
      continue
    }

    const fields = parseFrontmatter(readFileSync(join(dir, file), 'utf8'))
    if (!fields) {
      problems.push(`${file}: kein abgeschlossener Frontmatter-Block`)
      continue
    }
    if (fields.type !== 'ADR') problems.push(`${file}: type ist "${fields.type ?? '(fehlt)'}", erwartet "ADR"`)
    for (const key of ['title', 'description']) {
      if (!fields[key]) problems.push(`${file}: ${key} fehlt oder ist leer`)
    }

    adrs.push({ file, ...parsed, title: fields.title ?? '', description: fields.description ?? '' })
  }

  for (const [nr, group] of groupByNumber(adrs)) {
    if (group.length > 1) {
      problems.push(`Nummer ${String(nr).padStart(4, '0')} doppelt vergeben: ${group.map(a => a.file).join(', ')}`)
    }
  }

  return { adrs, problems }
}

const groupByNumber = adrs => {
  const byNumber = new Map()
  for (const adr of adrs) {
    if (!byNumber.has(adr.nr)) byNumber.set(adr.nr, [])
    byNumber.get(adr.nr).push(adr)
  }
  return byNumber
}

export const render = adrs => {
  const sorted = [...adrs].sort((a, b) => a.nr - b.nr)
  const out = ['# ADRs — Architektur-Entscheidungen', '']
  for (const adr of sorted) out.push(`* [${adr.title}](${adr.file}) - ${adr.description}`)
  return out.join('\n') + '\n'
}

// Der Drift-Schutz: index.md darf die Liste nicht (wieder) enthalten.
export const checkIndexFile = (dir = ADR_DIR) => {
  let text
  try {
    text = readFileSync(join(dir, 'index.md'), 'utf8')
  } catch {
    return ['docs/adr/index.md fehlt']
  }
  const offenders = text.split('\n').filter(line => LIST_LINE_RE.test(line))
  if (!offenders.length) return []
  return [
    `docs/adr/index.md enthaelt ${offenders.length} Listenzeile(n) — die Liste wird generiert, ` +
      'nicht gepflegt (pnpm docs:adr:index). Grund: ADR 0025.',
  ]
}

const numbersFrom = files =>
  new Set(
    files
      .map(parseName)
      .filter(Boolean)
      .map(a => a.nr),
  )

const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })

// Alle Worktrees DIESES Repos — inklusive Haupt-Checkout und der Nachbar-Sessions unter
// worktrees/. Genau die Quelle, die beim 0046-Dreifachtreffer niemand angesehen hat.
// Mitgezaehlt werden auch die Ephemeral-Worktrees, die Claude Code fuer Subagenten unter
// <repo>/.claude/worktrees/ anlegt. Das ist Absicht: Ein veralteter Baum kann die Zahl nur
// zu HOCH schaetzen (wir nehmen das Maximum), also hoechstens eine Nummer verbrennen —
// nie eine doppelt vergeben. Der Fehler zeigt in die harmlose Richtung.
export const worktreePaths = () => {
  try {
    return git(['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length))
  } catch {
    return [ROOT]
  }
}

export const collectUsedNumbers = () => {
  const sources = []
  const used = new Set()

  for (const path of worktreePaths()) {
    let files = []
    try {
      files = readdirSync(join(path, 'docs', 'adr'))
    } catch {
      continue
    }
    const numbers = numbersFrom(files)
    if (!numbers.size) continue
    sources.push({ label: path === ROOT ? `${path} (hier)` : path, max: Math.max(...numbers) })
    for (const nr of numbers) used.add(nr)
  }

  try {
    const files = git(['ls-tree', '--name-only', '-r', 'origin/main', '--', 'docs/adr'])
      .split('\n')
      .filter(Boolean)
      .map(p => p.slice(p.lastIndexOf('/') + 1))
    const numbers = numbersFrom(files)
    if (numbers.size) {
      sources.push({ label: 'origin/main', max: Math.max(...numbers) })
      for (const nr of numbers) used.add(nr)
    }
  } catch {
    sources.push({ label: 'origin/main', max: null })
  }

  return { used, sources }
}

// Bewusst hoechste + 1 statt "erste Luecke": Eine Luecke entsteht, wenn eine Session ihre
// Nummer aufgegeben hat (umnummeriert) — der aufgegebene Wert steht dann womoeglich schon
// in einem Issue-Kommentar oder einer PR-Beschreibung. Eine verbrannte Nummer weiterzugeben
// waere genau die Kollision, gegen die das hier laeuft.
export const nextNumber = used => (used.size ? Math.max(...used) + 1 : 1)

const main = () => {
  // `pnpm docs:adr:index | head` bzw. ein Pager, den der Leser mit q verlaesst, schliesst
  // stdout, waehrend noch geschrieben wird — gleiche Absicherung wie in docs-log.mjs.
  process.stdout.on('error', error => {
    if (error.code === 'EPIPE') process.exit(0)
    throw error
  })

  if (process.argv.includes('--next')) {
    const { used, sources } = collectUsedNumbers()
    for (const source of sources) {
      console.error(`  ${source.max === null ? '  ?  ' : String(source.max).padStart(4, '0')}  ${source.label}`)
    }
    process.stdout.write(`${String(nextNumber(used)).padStart(4, '0')}\n`)
    return
  }

  const { adrs, problems } = readAdrs()

  if (process.argv.includes('--check')) {
    const all = [...problems, ...checkIndexFile()]
    if (all.length) {
      console.error('docs/adr/ — Verstoesse:')
      for (const problem of all) console.error(`  ${problem}`)
      process.exit(1)
    }
    const highest = adrs.length ? Math.max(...adrs.map(a => a.nr)) : 0
    const gaps = highest - adrs.length
    console.log(`docs/adr/: ${adrs.length} ADRs bis ${String(highest).padStart(4, '0')}, keine Beanstandung.`)
    // Luecken sind kein Fehler (eine umnummerierte Datei hinterlaesst eine), aber ein
    // Hinweis darauf, dass eine Nummer verbrannt wurde.
    if (gaps > 0) console.log(`  Hinweis: ${gaps} Nummer(n) unbelegt.`)
    return
  }

  for (const problem of problems) console.error(`WARN ${problem}`)
  process.stdout.write(render(adrs))
}

if (process.argv[1] && process.argv[1].endsWith('docs-adr-index.mjs')) main()
