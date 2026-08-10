#!/usr/bin/env node
// Setzt die Wiki-Historie aus den Fragmenten in docs/log.d/ zusammen und schreibt
// sie nach stdout. BEWUSST kein Generat, das committet wird: Eine zusammengesetzte
// Datei im Repo waere wieder die eine Datei, die jeder PR anfasst — also genau der
// Merge-Konflikt, wegen dem es die Fragmente ueberhaupt gibt (#137).
//
//   pnpm docs:log            Historie nach stdout
//   pnpm docs:log:check      nur pruefen (Dateinamen, Inhalt), Exit 1 bei Verstoss
//
// Fragment-Schema: docs/log.d/<YYYY-MM-DD>-<nr>-<slug>.md
//   <nr> ist die Issue-Nummer (bei migriertem Bestand: die Tages-Sequenz von damals).
//   Sie ist der Diskriminator, den eine Session OHNE Blick auf die anderen bestimmen
//   kann — eine laufende Tagessequenz waere abstimmungspflichtig und damit wieder
//   kollisionsanfaellig.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const LOG_D = join(ROOT, 'docs', 'log.d')
export const NAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d+)-([a-z0-9][a-z0-9-]*)\.md$/

// Fragmente liegen eine Ebene tiefer als docs/, ihre relativen Links tragen deshalb
// ein zusaetzliches ../ (sonst waeren sie in der Fragment-Ansicht auf github.com tot).
// Die zusammengesetzte Ansicht steht konzeptionell in docs/ — hier muss genau ein ../
// wieder weg. Wichtig: Das gilt auch fuer repo-uebergreifende Links, die schon vorher
// ein ../ trugen (../../panary-core/… liegt im Fragment als ../../../panary-core/…).
export const unshiftLinks = body => body.replace(/\]\(\.\.\//g, '](')

export const parseName = file => {
  const match = NAME_RE.exec(file)
  if (!match) return null
  return { date: match[1], nr: Number(match[2]), slug: match[3] }
}

export const readFragments = (dir = LOG_D) => {
  let files
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md'))
  } catch {
    return { fragments: [], problems: ['Verzeichnis fehlt: docs/log.d/'] }
  }

  const fragments = []
  const problems = []

  for (const file of files.sort()) {
    const parsed = parseName(file)
    if (!parsed) {
      problems.push(`${file}: Dateiname passt nicht auf <YYYY-MM-DD>-<nr>-<slug>.md`)
      continue
    }
    const body = readFileSync(join(dir, file), 'utf8').trim()
    if (!body) {
      problems.push(`${file}: leer`)
      continue
    }
    if (!body.startsWith('* ')) problems.push(`${file}: erste Zeile ist kein Bullet ("* ")`)
    fragments.push({ file, ...parsed, body })
  }

  return { fragments, problems }
}

export const render = fragments => {
  const byDate = new Map()
  for (const fragment of fragments) {
    if (!byDate.has(fragment.date)) byDate.set(fragment.date, [])
    byDate.get(fragment.date).push(fragment)
  }

  const out = ['# Wiki Update Log', '']
  for (const date of [...byDate.keys()].sort().reverse()) {
    // Innerhalb eines Tages absteigend: beim migrierten Bestand ist <nr> die
    // Chronologie, bei neuen Eintraegen die Issue-Nummer (also nur noch grob
    // chronologisch — bewusst in Kauf genommen, siehe #137).
    const entries = byDate.get(date).sort((a, b) => b.nr - a.nr)
    out.push(`## ${date}`, '')
    for (const entry of entries) out.push(unshiftLinks(entry.body), '')
  }
  return out.join('\n')
}

const main = () => {
  const { fragments, problems } = readFragments()

  if (process.argv.includes('--check')) {
    if (problems.length) {
      console.error('docs/log.d/ — Verstoesse:')
      for (const problem of problems) console.error(`  ${problem}`)
      process.exit(1)
    }
    console.log(`docs/log.d/: ${fragments.length} Fragmente, keine Beanstandung.`)
    return
  }

  for (const problem of problems) console.error(`WARN ${problem}`)
  process.stdout.write(render(fragments))
}

if (process.argv[1] && process.argv[1].endsWith('docs-log.mjs')) main()
