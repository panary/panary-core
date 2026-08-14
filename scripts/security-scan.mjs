#!/usr/bin/env node
// security-scan.mjs
//
// Collects local SCA/secret findings (osv-scanner, gitleaks) and remote
// GitHub alerts (code-scanning, dependabot) into one unified, sorted report.
//
// Usage:
//   node scripts/security-scan.mjs [options]
//
// Options:
//   --mode=local|remote|all     default: all
//   --format=console|md|json    default: console
//   --report                    write Markdown to .security/report-YYYY-MM-DD.md
//   --max-severity=<level>      exit 1 if any finding >= critical|high|medium|low
//   --quiet                     reduce progress output
//
// Exit codes:
//   0  every requested scanner delivered a result, nothing above --max-severity
//   1  findings >= --max-severity
//   2  usage error, or a requested scanner delivered no result at all

import { execSync, spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ---------- CLI argument parsing ----------

const args = process.argv.slice(2)
const flag = (name, def = null) => {
  const idx = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (idx === -1) return def
  const a = args[idx]
  if (a.includes('=')) return a.split('=').slice(1).join('=')
  return args[idx + 1] ?? true
}
const has = name => args.includes(`--${name}`)

const MODE = flag('mode', 'all')
const FORMAT = flag('format', 'console')
const REPORT = has('report')
const QUIET = has('quiet')
const MAX_SEV = flag('max-severity', null)

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical']
const sevIndex = s => SEVERITY_ORDER.indexOf(String(s || '').toLowerCase())

const color = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}
const log = msg => {
  if (!QUIET) process.stderr.write(msg + '\n')
}

// ---------- Failure accounting ----------
//
// A scanner that did not run must never look like a scanner that found nothing.
// Until 2026-08-14 every failure path ended in `return []`, so a broken run was
// reported as "Total findings: 0" with exit 0 — the local gate had been blind
// since osv-scanner moved to v2. Failures are collected here, surfaced in every
// output format and turned into a non-zero exit by main().
const scanErrors = []
const failScan = (scanner, reason) => {
  scanErrors.push({ scanner, reason })
  // Deliberately bypasses log(): the lefthook pre-push hook runs with --quiet,
  // and a reason swallowed there would trade a silent gap for a silent block.
  process.stderr.write(`${color.red}✗ ${scanner}: ${reason}${color.reset}\n`)
  return []
}

// ---------- Helpers ----------

const hasTool = cmd => {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const detectRepo = () => {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim()
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch {
    return null
  }
}

// ---------- Local scanners ----------

const runOsvScanner = () => {
  if (!hasTool('osv-scanner')) {
    return failScan('osv-scanner', 'nicht installiert — bash scripts/install-security-tools.sh')
  }
  // Lockfile-Discovery: prefer repo-local, fall back to workspace-root parent.
  // panary-core and panary-cloud share a single pnpm-lock.yaml in _WORKBENCH_PANARY/.
  const candidates = [resolve(repoRoot, 'pnpm-lock.yaml'), resolve(repoRoot, '..', 'pnpm-lock.yaml')]
  const lockfile = candidates.find(p => existsSync(p))
  if (!lockfile) {
    return failScan('osv-scanner', `pnpm-lock.yaml nicht gefunden (gesucht: ${candidates.join(', ')})`)
  }
  log(
    `${color.cyan}► osv-scanner (lockfile: ${lockfile.replace(repoRoot + '/', './').replace(repoRoot, '.')}) …${color.reset}`,
  )
  // osv-scanner v2 syntax: `scan source` subcommand, space-separated flags.
  // The v1 form (`--lockfile=<path> --format=json <dir>`) exits 127 on v2 with
  // "could not determine extractor suitable to this file". Passing repoRoot
  // positionally is not the fix and must not come back: combined with
  // --lockfile it reproduces the very same 127, and on its own it exits 128
  // ("No package sources found") because v2 skips the git root unless
  // --include-git-root is set. The lockfile alone is the working invocation —
  // osv-scanner.toml is still picked up, it is resolved next to the lockfile.
  const result = spawnSync('osv-scanner', ['scan', 'source', '--lockfile', lockfile, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  })
  if (result.error) {
    return failScan('osv-scanner', `nicht startbar: ${result.error.message}`)
  }
  // Exit codes: 0=no vulns, 1=vulns found (expected), 127=general error,
  // 128=no packages found. Anything but 0/1 means we have no result, not zero
  // findings — 128 included, a scan over zero packages proves nothing.
  if (result.status !== 0 && result.status !== 1) {
    const errMsg = (result.stderr || '')
      .split('\n')
      .filter(l => l && !/^(Scanning |Starting filesystem walk|End status:)/.test(l))
      .join(' | ')
      .slice(0, 220)
    return failScan('osv-scanner', `Exit ${result.status}: ${errMsg || '(keine Fehlerausgabe)'}`)
  }
  try {
    const data = JSON.parse(result.stdout || '{}')
    const findings = []
    for (const r of data.results || []) {
      for (const pkg of r.packages || []) {
        for (const v of pkg.vulnerabilities || []) {
          const groupSev = pkg.groups?.find(g => g.ids?.includes(v.id))?.max_severity
          const severity = groupSev
            ? Number(groupSev) >= 9
              ? 'critical'
              : Number(groupSev) >= 7
                ? 'high'
                : Number(groupSev) >= 4
                  ? 'medium'
                  : 'low'
            : (v.database_specific?.severity || 'unknown').toLowerCase()
          findings.push({
            source: 'osv',
            severity,
            id: v.id,
            package: pkg.package?.name,
            version: pkg.package?.version,
            fix: v.affected?.[0]?.ranges?.[0]?.events?.find(e => e.fixed)?.fixed,
            summary: v.summary || v.aliases?.[0],
            ref: v.references?.[0]?.url,
          })
        }
      }
    }
    return findings
  } catch (e) {
    return failScan('osv-scanner', `JSON nicht lesbar: ${e.message}`)
  }
}

const runGitleaks = () => {
  if (!hasTool('gitleaks')) {
    return failScan('gitleaks', 'nicht installiert — bash scripts/install-security-tools.sh')
  }
  log(`${color.cyan}► gitleaks …${color.reset}`)
  const result = spawnSync(
    'gitleaks',
    ['detect', '--no-banner', '--redact', '--report-format=json', '--report-path=/dev/stdout', '--source', repoRoot],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 },
  )
  if (result.error) {
    return failScan('gitleaks', `nicht startbar: ${result.error.message}`)
  }
  // Exit codes: 0=clean, 1=leaks found (expected), others=actual failure.
  if (result.status !== 0 && result.status !== 1) {
    const errMsg = (result.stderr || '').split('\n')[0]
    return failScan('gitleaks', `Exit ${result.status}: ${errMsg || '(keine Fehlerausgabe)'}`)
  }
  try {
    // gitleaks may print a status line + JSON; isolate the JSON array.
    const out = result.stdout || ''
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    // No array at all means no report was written — that is a failed run, not
    // a clean one. Exit 0 with an empty report is what gitleaks emits when it
    // has nothing to say, so only a missing array is treated as an error.
    if (start === -1 || end === -1) {
      return failScan('gitleaks', 'kein JSON-Report in der Ausgabe')
    }
    const data = JSON.parse(out.slice(start, end + 1))
    return data.map(l => ({
      source: 'gitleaks',
      severity: 'high',
      id: l.RuleID,
      file: l.File,
      line: l.StartLine,
      summary: l.Description || l.RuleID,
    }))
  } catch (e) {
    log(`${color.red}gitleaks JSON parse failed: ${e.message}${color.reset}`)
    return []
  }
}

// ---------- Remote (GitHub API via gh) ----------

const ghApiPaginated = (path, label) => {
  if (!hasTool('gh')) {
    failScan(label, 'gh CLI nicht installiert — bash scripts/install-security-tools.sh')
    return null
  }
  // Use --jq '.[]' to emit one object per line (NDJSON). This avoids fragile
  // bracket-counting across multiple concatenated JSON arrays from --paginate,
  // which breaks on arrays whose string values contain '[' or ']' characters
  // (e.g. long Dependabot descriptions with code samples).
  const result = spawnSync('gh', ['api', '--paginate', '--jq', '.[]', path], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 128,
  })
  if (result.status !== 0) {
    const err = (result.stderr || '').split('\n')[0]
    failScan(label, `gh api ${path}: ${err}`)
    if (/HTTP 401|authentication/i.test(err)) {
      process.stderr.write(`${color.yellow}  → gh auth login -s repo${color.reset}\n`)
    }
    return null
  }
  try {
    const merged = []
    for (const line of result.stdout.split('\n')) {
      const t = line.trim()
      if (!t) continue
      merged.push(JSON.parse(t))
    }
    return merged
  } catch (e) {
    failScan(label, `JSON nicht lesbar: ${e.message}`)
    return null
  }
}

const fetchCodeScanning = (owner, repo) => {
  log(`${color.cyan}► code-scanning alerts …${color.reset}`)
  const alerts = ghApiPaginated(`/repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=100`, 'code-scanning')
  if (!alerts) return []
  return alerts.map(a => ({
    source: 'gh-code-scanning',
    severity: (a.rule?.security_severity_level || a.rule?.severity || 'unknown').toLowerCase(),
    id: `#${a.number} ${a.rule?.id || ''}`.trim(),
    file: a.most_recent_instance?.location?.path,
    line: a.most_recent_instance?.location?.start_line,
    summary: a.rule?.description || a.rule?.name,
    ref: a.html_url,
  }))
}

const fetchDependabot = (owner, repo) => {
  log(`${color.cyan}► dependabot alerts …${color.reset}`)
  const alerts = ghApiPaginated(`/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`, 'dependabot')
  if (!alerts) return []
  return alerts.map(a => ({
    source: 'gh-dependabot',
    severity: (a.security_advisory?.severity || 'unknown').toLowerCase(),
    id: `#${a.number} ${a.security_advisory?.ghsa_id || ''}`.trim(),
    package: a.dependency?.package?.name,
    version: a.security_vulnerability?.vulnerable_version_range,
    fix: a.security_vulnerability?.first_patched_version?.identifier,
    summary: a.security_advisory?.summary,
    ref: a.html_url,
  }))
}

// ---------- Output ----------

const groupBySeverity = findings => {
  const groups = { critical: [], high: [], medium: [], low: [], unknown: [] }
  for (const f of findings) {
    const sev = ['critical', 'high', 'medium', 'low'].includes(f.severity) ? f.severity : 'unknown'
    groups[sev].push(f)
  }
  return groups
}

const renderConsole = findings => {
  const groups = groupBySeverity(findings)
  const sevColor = { critical: color.red, high: color.red, medium: color.yellow, low: color.cyan, unknown: color.dim }
  let out = `\n${color.bold}Security Scan Report — ${new Date().toISOString()}${color.reset}\n`
  out += `Total findings: ${findings.length}\n`
  if (scanErrors.length > 0) {
    out += `${color.red}${color.bold}⚠ UNVOLLSTAENDIGER LAUF${color.reset}${color.red} — ${scanErrors.length} Scanner `
    out += `ohne Ergebnis. Die Zahl oben ist eine Untergrenze, kein Freibrief.${color.reset}\n`
    for (const e of scanErrors) out += `  ${color.red}✗ ${e.scanner}: ${e.reason}${color.reset}\n`
  }
  for (const sev of ['critical', 'high', 'medium', 'low', 'unknown']) {
    if (groups[sev].length === 0) continue
    out += `\n${sevColor[sev]}${color.bold}${sev.toUpperCase()}${color.reset} (${groups[sev].length})\n`
    for (const f of groups[sev]) {
      const loc = f.file
        ? `${f.file}${f.line ? `:${f.line}` : ''}`
        : f.package
          ? `${f.package}@${f.version || '?'}`
          : ''
      out += `  [${f.source}] ${f.id} ${color.dim}${loc}${color.reset}\n`
      if (f.summary) out += `    ${String(f.summary).split('\n')[0].slice(0, 110)}\n`
      if (f.fix) out += `    → fix: ${f.fix}\n`
    }
  }
  return out
}

const renderMarkdown = (findings, meta) => {
  const groups = groupBySeverity(findings)
  let out = `# Security Scan Report\n\n`
  out += `- **Repository:** \`${meta.owner}/${meta.repo}\`\n`
  out += `- **Generated:** ${new Date().toISOString()}\n`
  out += `- **Mode:** ${MODE}\n`
  out += `- **Total findings:** ${findings.length}\n\n`
  if (scanErrors.length > 0) {
    out += `> ⚠️ **Unvollstaendiger Lauf** — ${scanErrors.length} Scanner ohne Ergebnis.\n`
    out += `> Die Fundzahl ist eine **Untergrenze**; dieser Report belegt keine Freiheit von Befunden.\n>\n`
    for (const e of scanErrors) out += `> - \`${e.scanner}\`: ${e.reason}\n`
    out += `\n`
  }
  out += `| Severity | Count |\n|---|---:|\n`
  for (const sev of ['critical', 'high', 'medium', 'low', 'unknown']) {
    out += `| ${sev} | ${groups[sev].length} |\n`
  }
  out += `\n`
  for (const sev of ['critical', 'high', 'medium', 'low', 'unknown']) {
    if (groups[sev].length === 0) continue
    out += `## ${sev.charAt(0).toUpperCase()}${sev.slice(1)} (${groups[sev].length})\n\n`
    for (const f of groups[sev]) {
      const loc = f.file
        ? `\`${f.file}${f.line ? `:${f.line}` : ''}\``
        : f.package
          ? `\`${f.package}@${f.version || '?'}\``
          : ''
      out += `- **[${f.source}]** ${f.id} ${loc}\n`
      if (f.summary) out += `  - ${String(f.summary).split('\n')[0]}\n`
      if (f.fix) out += `  - **Fix:** \`${f.fix}\`\n`
      if (f.ref) out += `  - <${f.ref}>\n`
    }
    out += `\n`
  }
  return out
}

// ---------- Main ----------

const main = () => {
  const repoMeta = detectRepo()
  if (!repoMeta && MODE !== 'local') {
    log(
      `${color.yellow}⚠ Konnte Repo nicht aus 'git remote get-url origin' ableiten — falle auf --mode=local zurueck${color.reset}`,
    )
  }

  const findings = []
  if (MODE === 'local' || MODE === 'all') {
    findings.push(...runOsvScanner())
    findings.push(...runGitleaks())
  }
  if ((MODE === 'remote' || MODE === 'all') && repoMeta) {
    findings.push(...fetchCodeScanning(repoMeta.owner, repoMeta.repo))
    findings.push(...fetchDependabot(repoMeta.owner, repoMeta.repo))
  }

  findings.sort((a, b) => sevIndex(b.severity) - sevIndex(a.severity))

  if (FORMAT === 'json') {
    const payload = {
      generatedAt: new Date().toISOString(),
      repo: repoMeta,
      complete: scanErrors.length === 0,
      scanErrors,
      findings,
    }
    process.stdout.write(JSON.stringify(payload, null, 2))
  } else if (FORMAT === 'md') {
    process.stdout.write(renderMarkdown(findings, repoMeta || { owner: '?', repo: '?' }))
  } else {
    process.stdout.write(renderConsole(findings))
  }

  if (REPORT) {
    const dir = resolve(repoRoot, '.security')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const file = resolve(dir, `report-${date}.md`)
    writeFileSync(file, renderMarkdown(findings, repoMeta || { owner: '?', repo: '?' }))
    log(`${color.green}✓ Report geschrieben: ${file}${color.reset}`)
  }

  // Everything below writes to stderr directly rather than through log():
  // a non-zero exit must always carry its reason, and the pre-push hook runs
  // this script with --quiet.
  let exitCode = 0

  if (MAX_SEV) {
    const threshold = sevIndex(MAX_SEV)
    if (threshold === -1) {
      process.stderr.write(`${color.red}Unbekannter --max-severity-Wert: ${MAX_SEV}${color.reset}\n`)
      process.exit(2)
    }
    const blocking = findings.filter(f => sevIndex(f.severity) >= threshold)
    if (blocking.length > 0) {
      process.stderr.write(
        `${color.red}${color.bold}✗ ${blocking.length} finding(s) >= '${MAX_SEV}' — blocking.${color.reset}\n`,
      )
      exitCode = 1
    }
  }

  // Reported last and outranking the severity gate: if a scanner never ran,
  // the finding list is a lower bound and "nothing above the threshold" is not
  // a statement anyone should act on.
  if (scanErrors.length > 0) {
    const names = scanErrors.map(e => e.scanner).join(', ')
    process.stderr.write(
      `${color.red}${color.bold}✗ Lauf unvollstaendig — ohne Ergebnis: ${names}. ` +
        `Die Fundzahl ist eine Untergrenze.${color.reset}\n`,
    )
    exitCode = 2
  }

  if (exitCode !== 0) process.exit(exitCode)
}

main()
