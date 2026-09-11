#!/usr/bin/env node
/**
 * publishable-manifests.mjs — die publishable Lib-Manifeste finden und prüfen
 *
 * Hintergrund: panary-core hat zwei Release-Pfade (ADR 0002). `bump-version.mjs`
 * pflegte die App-Version (root, api-edge, tauri, LICENSE), `nx release version`
 * die Lib-Version. Wurde der zweite vergessen, lief `publish-libraries.yml`
 * trotzdem — mit der **alten** Version gegen ein bereits vorhandenes Paket — und
 * meldete `success`. Vier der `v26.8.*`-Releases sind so durchgelaufen und
 * mussten von Hand geheilt werden (#242).
 *
 * Dieses Modul ist die gemeinsame Grundlage beider Gegenmaßnahmen:
 *   - `bump-version.mjs` hebt die gefundenen Manifeste mit an,
 *   - `publish-libraries.yml` prüft sie vor dem Publish gegen die Tag-Version.
 *
 * Bewusst ohne nx-Abhängigkeit: Es läuft im Release-Pfad und in einem
 * Wegwerf-Repo im Spec, wo kein Projektgraph existiert. Die Menge kommt aus dem
 * `publishable`-Tag der `project.json` — dieselbe Quelle, aus der nx sie liest.
 * Damit der Scan nicht still von nx abweicht (neues Projekt ohne `project.json`,
 * umgezogenes Manifest), gleicht `--expect-projects-file` ihn im CI gegen
 * `nx show projects --projects="tag:publishable"` ab.
 *
 * Verwendung:
 *   node tools/scripts/publishable-manifests.mjs --list
 *   node tools/scripts/publishable-manifests.mjs --check 26.8.22
 *   node tools/scripts/publishable-manifests.mjs --check 26.8.22 --expect-projects-file nx.json
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { resolve, dirname, join, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const PUBLISHABLE_TAG = 'publishable'

// Verzeichnisse, in denen keine Projektdefinition liegt, die aber teuer oder
// gefährlich zu durchlaufen sind. `node_modules` ist der Hauptgrund: Die
// pnpm-Peer-Links der publishable Parents bilden dort Symlink-Zyklen
// (auth⇄users, shared⇄domains, siehe ADR 0002).
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', 'dist', 'coverage', '.angular', 'tmp', '.idea', '.vscode'])

// Tiefenbegrenzung als zweite Sicherung neben dem Symlink-Verhalten von
// `readdirSync(withFileTypes)`: Ein Symlink meldet `isDirectory() === false`,
// wird also gar nicht erst betreten. Die Grenze fängt den Fall, dass jemand ein
// echtes Verzeichnis zyklisch verschachtelt.
const MAX_DEPTH = 8

/** Sammelt alle `project.json`-Pfade unterhalb von `root`. */
function collectProjectFiles(root, dir = root, depth = 0, out = []) {
  if (depth > MAX_DEPTH) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    // `isDirectory()` ist bei einem Symlink false — Symlinks werden damit nie
    // betreten, und die Zyklen unter `libs/` sind kein Thema.
    if (entry.isDirectory()) collectProjectFiles(root, full, depth + 1, out)
    else if (entry.name === 'project.json') out.push(full)
  }
  return out
}

/**
 * Findet alle publishable Lib-Manifeste.
 *
 * @param {string} root Repo-Wurzel
 * @returns {{ project: string, dir: string, manifestPath: string, version: string | undefined }[]}
 *   nach Manifest-Pfad sortiert, damit Ausgaben und Commits stabil bleiben.
 */
export function findPublishableManifests(root) {
  const found = []
  for (const projectFile of collectProjectFiles(root)) {
    let project
    try {
      project = JSON.parse(readFileSync(projectFile, 'utf8'))
    } catch {
      continue
    }
    if (!Array.isArray(project.tags) || !project.tags.includes(PUBLISHABLE_TAG)) continue

    const dir = dirname(projectFile)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(
        `publishable-manifests: ${relative(root, projectFile)} traegt den Tag "${PUBLISHABLE_TAG}", ` +
          `aber daneben liegt keine package.json — ohne Manifest ist das Projekt nicht publizierbar.`,
      )
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      throw new Error(`publishable-manifests: ${relative(root, manifestPath)} ist kein gueltiges JSON: ${err.message}`)
    }
    found.push({
      project: project.name ?? manifest.name ?? relative(root, dir),
      dir,
      manifestPath,
      version: manifest.version,
    })
  }
  found.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath))
  return found
}

/**
 * Vergleicht die gefundene Menge gegen die Projektnamen, die nx unter
 * `tag:publishable` fuehrt. Beide Richtungen zaehlen: Ein nx-Projekt ohne
 * Scan-Treffer wuerde beim Bump uebersprungen, ein Scan-Treffer ohne nx-Eintrag
 * wuerde gebumpt, aber nie publiziert.
 */
export function diffAgainstNxProjects(manifests, nxProjects) {
  const scanned = new Set(manifests.map(m => m.project))
  const expected = new Set(nxProjects)
  return {
    missingInScan: [...expected].filter(p => !scanned.has(p)).sort(),
    missingInNx: [...scanned].filter(p => !expected.has(p)).sort(),
  }
}

/** Liest die nx-Projektliste aus einer Datei (`nx show projects --json`). */
function readNxProjects(path) {
  const raw = readFileSync(path, 'utf8').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // `nx show projects` ohne `--json` schreibt eine Zeile je Projekt.
    return raw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(parsed)) throw new Error(`publishable-manifests: ${path} enthaelt kein Projekt-Array`)
  return parsed
}

function parseArgs(argv) {
  const args = { list: false, check: undefined, expectProjectsFile: undefined }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--list':
        args.list = true
        break
      case '--check':
        args.check = argv[++i]
        break
      case '--expect-projects-file':
        args.expectProjectsFile = argv[++i]
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`publishable-manifests: unbekanntes Argument "${argv[i]}"`)
    }
  }
  return args
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(
      [
        'Verwendung: node tools/scripts/publishable-manifests.mjs [Optionen]',
        '',
        '  --list                          Manifest-Pfade (repo-relativ) ausgeben',
        '  --check <version>               Alle Manifeste muessen diese Version tragen',
        '  --expect-projects-file <datei>  Scan-Menge gegen `nx show projects --json` abgleichen',
        '',
      ].join('\n'),
    )
    return
  }

  const manifests = findPublishableManifests(root)

  if (manifests.length === 0) {
    process.stderr.write(
      'publishable-manifests: kein publishable Projekt gefunden. Entweder wurde der Tag umbenannt oder\n' +
        'der Scan laeuft im falschen Verzeichnis — beides macht jede Pruefung wertlos.\n',
    )
    process.exit(1)
  }

  let failed = false

  if (args.expectProjectsFile) {
    const { missingInScan, missingInNx } = diffAgainstNxProjects(manifests, readNxProjects(args.expectProjectsFile))
    if (missingInScan.length > 0) {
      failed = true
      process.stderr.write(
        `publishable-manifests: nx fuehrt ${missingInScan.length} publishable Projekt(e), die dieser Scan nicht\n` +
          `findet: ${missingInScan.join(', ')}\n` +
          'Ursache ist fast immer ein Projekt ohne eigene project.json (inferred target) oder ein Manifest,\n' +
          'das nicht neben der project.json liegt. Solche Projekte werden beim Release NICHT gebumpt.\n',
      )
    }
    if (missingInNx.length > 0) {
      failed = true
      process.stderr.write(
        `publishable-manifests: ${missingInNx.length} Projekt(e) tragen den Tag "${PUBLISHABLE_TAG}", werden von nx\n` +
          `aber nicht gefuehrt: ${missingInNx.join(', ')}\n` +
          'Sie wuerden gebumpt, aber nie publiziert.\n',
      )
    }
  }

  if (args.check !== undefined) {
    const expected = String(args.check).replace(/^v/, '')
    if (!expected) {
      process.stderr.write('publishable-manifests: --check braucht eine Version\n')
      process.exit(1)
    }
    const mismatched = manifests.filter(m => m.version !== expected)
    if (mismatched.length > 0) {
      failed = true
      process.stderr.write(
        `publishable-manifests: ${mismatched.length} von ${manifests.length} publishable Manifest(en) tragen nicht ` +
          `die Version ${expected}:\n` +
          mismatched.map(m => `  ${relative(root, m.manifestPath)}: ${m.version ?? '(keine)'}`).join('\n') +
          '\n\n' +
          'Der Release-Commit hat die Libs nicht mitgebumpt. `nx release publish` wuerde die bereits\n' +
          'veroeffentlichte Vorversion erneut hochladen und dabei GRUEN melden, ohne etwas zu publizieren.\n' +
          'Reparatur: `pnpm nx release version <version>` auf main, committen, Workflow per\n' +
          'workflow_dispatch mit dry-run=false nachfahren.\n',
      )
    } else {
      process.stdout.write(`publishable-manifests: ${manifests.length} Manifest(e) auf ${expected} — in Ordnung\n`)
    }
  }

  if (args.list) {
    process.stdout.write(manifests.map(m => relative(root, m.manifestPath).split(sep).join('/')).join('\n') + '\n')
  }

  if (failed) process.exit(1)
}

// Nur ausfuehren, wenn direkt aufgerufen — als Modul importiert bleibt es still.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
