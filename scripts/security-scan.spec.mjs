#!/usr/bin/env node
/**
 * Tests fuer security-scan.mjs.
 *
 * Bewusst ein reines Node-Skript und kein Vitest-Spec — gleiche Begruendung wie bei
 * `docs-log.spec.mjs`: kein Vitest-Projekt schliesst `scripts/` ein. Der Aufruf steht
 * deshalb explizit in der CI.
 *
 * Diese Datei ist wie das Skript selbst in panary-core und panary-cloud byte-identisch.
 * Sie baut sich ihre Repos deshalb selbst in `mkdtemp`-Verzeichnissen und liest nichts
 * aus dem umgebenden Checkout — dessen Lockfile ist in panary-core ein Symlink auf die
 * Workbench und darf von keiner Testvorrichtung beruehrt werden.
 *
 * Das Skript ist zweimal still gebrochen, beide Male mit einer Entwarnung, die es nicht
 * belegen konnte. Die Pruefungen hier decken beide Sorten:
 *
 * - panary/panary-core#219: osv-scanner v2 lief ins Leere, gemeldet wurde
 *   "Total findings: 0" mit Exit 0. → Exit-Vertrag, `scanErrors`, `complete: false`.
 * - panary/panary-core#354: Ein lebender Symlink-Lockfile fuehrte aus dem Repo heraus,
 *   gemessen wurde der fremde Baum. → Lockfile-Aufloesung.
 *
 * Was hier NICHT geprueft wird: der echte Lauf gegen osv-scanner. Der Scanner ist
 * durch eine Aufzeichnung ersetzt — ein kuenftiger Syntaxbruch des Werkzeugs (wie bei
 * #219) faellt weiterhin erst lokal auf.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { escapesRepo, exitCodeFor, osvSeverity, resolveLockfiles, runOsvScanner, scanErrors } from './security-scan.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'security-scan.mjs')
const COMMITTED = 'lockfileVersion: committed\n'
const ELSEWHERE = 'lockfileVersion: elsewhere\n'

const sandboxes = []
const sandbox = () => {
  const dir = mkdtempSync(join(tmpdir(), 'security-scan-spec-'))
  sandboxes.push(dir)
  return dir
}

// Eigene Identitaet und keine Hooks/Signatur: Die globale git-Konfiguration des
// Rechners (lefthook, gpgsign) darf den Testaufbau nicht mitbestimmen.
const git = (cwd, ...args) => {
  const r = spawnSync(
    'git',
    [
      '-c',
      'user.name=spec',
      '-c',
      'user.email=spec@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

const repoWithCommittedLockfile = () => {
  const root = sandbox()
  const repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), COMMITTED)
  git(repo, 'add', 'pnpm-lock.yaml')
  git(repo, 'commit', '-q', '-m', 'lockfile')
  return { root, repo }
}

// Das Muster des panary-core-Haupt-Checkouts: Die Arbeitsbaum-Datei ist ein Symlink
// auf ../pnpm-lock.yaml, ausserhalb des Repos, mit ANDEREM Inhalt als der Commit.
const repoWithEscapingSymlink = () => {
  const { root, repo } = repoWithCommittedLockfile()
  writeFileSync(join(root, 'pnpm-lock.yaml'), ELSEWHERE)
  unlinkSync(join(repo, 'pnpm-lock.yaml'))
  symlinkSync('../pnpm-lock.yaml', join(repo, 'pnpm-lock.yaml'))
  return { root, repo }
}

// Nimmt den Aufruf statt osv-scanner entgegen. Zum Aufrufzeitpunkt wird festgehalten,
// ob die uebergebenen Lockfiles existieren — danach sind Temp-Kopien weg, und genau
// das soll eine Pruefung sehen koennen.
const recordingScanner = (result = { status: 0, stdout: '{"results":[]}', stderr: '' }) => {
  const calls = []
  const run = (cmd, args) => {
    const lockfiles = args.flatMap((a, i) => (args[i - 1] === '--lockfile' ? [a] : []))
    calls.push({ cmd, args, lockfiles: lockfiles.map(p => ({ path: p, content: readFileSync(p, 'utf8') })) })
    return result
  }
  return { calls, run }
}

const scan = (root, scanner) => {
  scanErrors.length = 0
  return runOsvScanner({ root, runScanner: scanner.run, toolAvailable: () => true })
}

let failures = 0
let passed = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures++
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

console.log('Lockfile-Aufloesung (panary/panary-core#354)')

test('lebender Symlink aus dem Repo heraus → committeter Stand, nicht das Symlink-Ziel', () => {
  const { repo } = repoWithEscapingSymlink()
  // Der Symlink MUSS leben. Bei einem toten liefert existsSync false, der Rueckfall
  // auf HEAD greift ohnehin, und die Pruefung bestuende, ohne den Fall zu beruehren —
  // genau so ist die Handprobe zu #354 einmal danebengegangen.
  assert.ok(existsSync(join(repo, 'pnpm-lock.yaml')), 'Vorbedingung: Symlink lebt')
  assert.equal(readFileSync(join(repo, 'pnpm-lock.yaml'), 'utf8'), ELSEWHERE, 'Vorbedingung: Ziel ist fremd')

  const locks = resolveLockfiles(repo)
  try {
    assert.equal(locks.length, 1)
    assert.equal(locks[0].rel, 'pnpm-lock.yaml')
    assert.match(locks[0].origin, /^committeter Stand HEAD@/)
    assert.notEqual(locks[0].tmpDir, null)
    assert.equal(readFileSync(locks[0].path, 'utf8'), COMMITTED)
  } finally {
    for (const l of locks) if (l.tmpDir) rmSync(l.tmpDir, { recursive: true, force: true })
  }
})

test('echtes Lockfile im Arbeitsbaum → Arbeitsbaum, auch wenn es vom Commit abweicht', () => {
  const { repo } = repoWithCommittedLockfile()
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: uncommitted\n')

  const locks = resolveLockfiles(repo)
  assert.equal(locks.length, 1)
  assert.equal(locks[0].origin, 'Arbeitsbaum')
  assert.equal(locks[0].tmpDir, null)
  assert.equal(locks[0].path, join(repo, 'pnpm-lock.yaml'))
})

test('escapesRepo: Symlink nach draussen ja, echte Datei nein', () => {
  const { repo } = repoWithEscapingSymlink()
  assert.equal(escapesRepo(join(repo, 'pnpm-lock.yaml'), repo), true)
  const { repo: plain } = repoWithCommittedLockfile()
  assert.equal(escapesRepo(join(plain, 'pnpm-lock.yaml'), plain), false)
})

console.log('Kein Ergebnis ist kein Befund (panary/panary-core#219)')

test('weder Lockfile noch Git-Stand → failScan statt leerer Fundliste', () => {
  const repo = sandbox()
  git(repo, 'init', '-q')
  const scanner = recordingScanner()

  assert.deepEqual(resolveLockfiles(repo), [])
  assert.deepEqual(scan(repo, scanner), [])
  assert.equal(scanner.calls.length, 0, 'ohne Lockfile darf der Scanner gar nicht laufen')
  assert.equal(scanErrors.length, 1)
  assert.equal(scanErrors[0].scanner, 'osv-scanner')
  assert.match(scanErrors[0].reason, /kein Lockfile messbar/)
})

test('weder Lockfile noch Git-Stand → Direktaufruf meldet complete: false und Exit 2', () => {
  // Einmal der ganze Weg, wie ihn der pre-push-Hook geht: Skript als Kopie im
  // Wegwerf-Repo, Scanner als Attrappen auf dem PATH. Belegt nebenbei, dass der
  // Direktaufruf-Guard main() wirklich startet.
  const repo = sandbox()
  git(repo, 'init', '-q')
  mkdirSync(join(repo, 'scripts'))
  copyFileSync(SCRIPT, join(repo, 'scripts', 'security-scan.mjs'))
  const bin = sandbox()
  for (const [tool, body] of [
    ['osv-scanner', 'echo "osv-scanner darf ohne Lockfile nicht laufen" >&2; exit 99'],
    ['gitleaks', 'echo "[]"'],
  ]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, tool), 0o755)
  }

  const r = spawnSync(
    process.execPath,
    [join(repo, 'scripts', 'security-scan.mjs'), '--mode=local', '--format=json', '--quiet'],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
  )
  assert.equal(r.status, 2, r.stderr)
  const payload = JSON.parse(r.stdout)
  assert.equal(payload.complete, false)
  assert.deepEqual(
    payload.scanErrors.map(e => e.scanner),
    ['osv-scanner'],
  )
  assert.deepEqual(payload.findings, [])
})

test('Scanner-Exit ausserhalb 0/1 → scanErrors gefuellt statt leerer Fundliste', () => {
  const { repo } = repoWithCommittedLockfile()
  for (const status of [127, 128]) {
    const scanner = recordingScanner({ status, stdout: '', stderr: 'could not determine extractor' })
    assert.deepEqual(scan(repo, scanner), [], `Exit ${status}`)
    assert.equal(scanner.calls.length, 1)
    assert.equal(scanErrors.length, 1, `Exit ${status}`)
    assert.match(scanErrors[0].reason, new RegExp(`^Exit ${status}: could not determine extractor`))
  }
})

test('Scanner-Exit 1 ist ein Befund, kein Fehler', () => {
  const { repo } = repoWithCommittedLockfile()
  const stdout = JSON.stringify({
    results: [
      {
        source: { path: join(repo, 'pnpm-lock.yaml') },
        packages: [
          {
            package: { name: 'adm-zip', version: '0.6.0' },
            groups: [{ ids: ['GHSA-7q85-xj36-vmfc'], max_severity: '7.5' }],
            vulnerabilities: [{ id: 'GHSA-7q85-xj36-vmfc', summary: 'x' }],
          },
        ],
      },
    ],
  })
  const findings = scan(repo, recordingScanner({ status: 1, stdout, stderr: '' }))
  assert.equal(scanErrors.length, 0)
  assert.deepEqual(
    findings.map(f => [f.id, f.severity, f.package]),
    [['GHSA-7q85-xj36-vmfc', 'high', 'adm-zip']],
  )
})

console.log('Scanner-Aufruf')

test('--config <root>/osv-scanner.toml steht in der Argumentliste, sobald die Datei existiert', () => {
  // Ohne das Flag verliert eine Temp-Kopie aus HEAD still ihre IgnoredVulns: osv-scanner
  // sucht die Konfiguration nur neben dem gescannten Lockfile.
  const { repo } = repoWithEscapingSymlink()
  const without = recordingScanner()
  scan(repo, without)
  assert.equal(without.calls[0].args.includes('--config'), false, 'ohne Datei kein --config')

  writeFileSync(join(repo, 'osv-scanner.toml'), '')
  const withConfig = recordingScanner()
  scan(repo, withConfig)
  const args = withConfig.calls[0].args
  assert.equal(args[args.indexOf('--config') + 1], join(repo, 'osv-scanner.toml'))
})

test('Scanner bekommt den committeten Stand und das Temp-Verzeichnis ist danach weg', () => {
  const { repo } = repoWithEscapingSymlink()
  const scanner = recordingScanner()
  scan(repo, scanner)

  assert.equal(scanner.calls.length, 1)
  const [lock] = scanner.calls[0].lockfiles
  assert.equal(lock.content, COMMITTED, 'gescannt wird HEAD, nicht das Symlink-Ziel')
  assert.notEqual(dirname(lock.path), repo)
  assert.equal(existsSync(dirname(lock.path)), false, `Temp-Verzeichnis liegt noch: ${dirname(lock.path)}`)
})

test('Temp-Verzeichnis ist auch nach einem Scanner-Fehler weg', () => {
  const { repo } = repoWithEscapingSymlink()
  const scanner = recordingScanner({ status: 127, stdout: '', stderr: 'boom' })
  scan(repo, scanner)
  assert.equal(scanErrors.length, 1)
  assert.equal(existsSync(dirname(scanner.calls[0].lockfiles[0].path)), false)
})

console.log('Severity und Exit-Vertrag')

test('osvSeverity bildet CVSS-Grenzen ab und faellt sonst auf das Advisory-Label zurueck', () => {
  assert.equal(osvSeverity('9.0'), 'critical')
  assert.equal(osvSeverity('8.9'), 'high')
  assert.equal(osvSeverity('7'), 'high')
  assert.equal(osvSeverity('6.9'), 'medium')
  assert.equal(osvSeverity('4.0'), 'medium')
  assert.equal(osvSeverity('3.9'), 'low')
  assert.equal(osvSeverity(undefined, 'HIGH'), 'high')
  assert.equal(osvSeverity(undefined, undefined), 'unknown')
})

test('exitCodeFor: 0 ohne Befund ueber der Schwelle, 1 bei Befund, 2 bei unvollstaendigem Lauf', () => {
  const high = [{ severity: 'high' }]
  const error = [{ scanner: 'osv-scanner', reason: 'x' }]
  assert.equal(exitCodeFor({ findings: [], scanErrors: [], maxSeverity: 'critical' }), 0)
  assert.equal(exitCodeFor({ findings: high, scanErrors: [], maxSeverity: 'critical' }), 0)
  assert.equal(exitCodeFor({ findings: high, scanErrors: [], maxSeverity: 'high' }), 1)
  assert.equal(exitCodeFor({ findings: high, scanErrors: [], maxSeverity: null }), 0)
  // #219: Ein Scanner ohne Ergebnis darf nie wie "nichts gefunden" aussehen — auch
  // nicht, wenn die (unvollstaendige) Liste leer ist.
  assert.equal(exitCodeFor({ findings: [], scanErrors: error, maxSeverity: 'critical' }), 2)
  assert.equal(exitCodeFor({ findings: [], scanErrors: error, maxSeverity: null }), 2)
  assert.equal(exitCodeFor({ findings: high, scanErrors: error, maxSeverity: 'high' }), 2, '2 schlaegt 1')
  assert.equal(exitCodeFor({ findings: [], scanErrors: [], maxSeverity: 'bogus' }), 2)
})

scanErrors.length = 0
for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true })

console.log(`\n${passed} bestanden, ${failures} fehlgeschlagen`)
if (failures > 0) process.exit(1)
