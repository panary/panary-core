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
const has = (name) => args.includes(`--${name}`)

const MODE = flag('mode', 'all')
const FORMAT = flag('format', 'console')
const REPORT = has('report')
const QUIET = has('quiet')
const MAX_SEV = flag('max-severity', null)

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical']
const sevIndex = (s) => SEVERITY_ORDER.indexOf(String(s || '').toLowerCase())

const color = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
}
const log = (msg) => { if (!QUIET) process.stderr.write(msg + '\n') }

// ---------- Helpers ----------

const hasTool = (cmd) => {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true }
  catch { return false }
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
    log(`${color.yellow}⚠ osv-scanner nicht installiert — bash scripts/install-security-tools.sh${color.reset}`)
    return []
  }
  // Lockfile-Discovery: prefer repo-local, fall back to workspace-root parent.
  // panary-core and panary-cloud share a single pnpm-lock.yaml in _WORKBENCH_PANARY/.
  const candidates = [
    resolve(repoRoot, 'pnpm-lock.yaml'),
    resolve(repoRoot, '..', 'pnpm-lock.yaml'),
  ]
  const lockfile = candidates.find(p => existsSync(p))
  if (!lockfile) {
    log(`${color.yellow}⚠ pnpm-lock.yaml nicht gefunden (gesucht: ${candidates.join(', ')})${color.reset}`)
    return []
  }
  log(`${color.cyan}► osv-scanner (lockfile: ${lockfile.replace(repoRoot + '/', './').replace(repoRoot, '.')}) …${color.reset}`)
  const result = spawnSync('osv-scanner', [
    `--lockfile=${lockfile}`,
    '--format=json',
    repoRoot,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
  // Exit codes: 0=no vulns, 1=vulns found (expected), others=actual failure.
  if (result.status !== 0 && result.status !== 1) {
    const errMsg = (result.stderr || '')
      .split('\n')
      .filter(l => l && !/^Scanning /.test(l))
      .join(' | ')
      .slice(0, 220)
    log(`${color.red}osv-scanner exit ${result.status}: ${errMsg}${color.reset}`)
    return []
  }
  try {
    const data = JSON.parse(result.stdout || '{}')
    const findings = []
    for (const r of (data.results || [])) {
      for (const pkg of (r.packages || [])) {
        for (const v of (pkg.vulnerabilities || [])) {
          const groupSev = pkg.groups?.find(g => g.ids?.includes(v.id))?.max_severity
          const severity = groupSev
            ? (Number(groupSev) >= 9 ? 'critical' : Number(groupSev) >= 7 ? 'high' : Number(groupSev) >= 4 ? 'medium' : 'low')
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
    log(`${color.red}osv-scanner JSON parse failed: ${e.message}${color.reset}`)
    return []
  }
}

const runGitleaks = () => {
  if (!hasTool('gitleaks')) {
    log(`${color.yellow}⚠ gitleaks nicht installiert — bash scripts/install-security-tools.sh${color.reset}`)
    return []
  }
  log(`${color.cyan}► gitleaks …${color.reset}`)
  const result = spawnSync('gitleaks', [
    'detect',
    '--no-banner',
    '--redact',
    '--report-format=json',
    '--report-path=/dev/stdout',
    '--source', repoRoot,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 })
  if (result.status !== 0 && result.status !== 1) {
    log(`${color.red}gitleaks failed: ${(result.stderr || '').split('\n')[0]}${color.reset}`)
    return []
  }
  try {
    // gitleaks may print a status line + JSON; isolate the JSON array.
    const out = result.stdout || ''
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    if (start === -1 || end === -1) return []
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

const ghApiPaginated = (path) => {
  if (!hasTool('gh')) {
    log(`${color.yellow}⚠ gh CLI nicht installiert — bash scripts/install-security-tools.sh${color.reset}`)
    return null
  }
  const result = spawnSync('gh', ['api', '--paginate', path], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  })
  if (result.status !== 0) {
    const err = (result.stderr || '').split('\n')[0]
    log(`${color.red}gh api ${path} failed: ${err}${color.reset}`)
    if (/HTTP 401|authentication/i.test(err)) {
      log(`${color.yellow}  → gh auth login -s repo,security_events${color.reset}`)
    }
    return null
  }
  try {
    // --paginate concatenates JSON arrays back-to-back. Split via bracket counting.
    const merged = []
    let buf = result.stdout
    while (buf.trim()) {
      let depth = 0, end = -1, started = false
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i]
        if (c === '[') { depth++; started = true }
        else if (c === ']') { depth--; if (started && depth === 0) { end = i + 1; break } }
      }
      if (end === -1) break
      merged.push(...JSON.parse(buf.slice(0, end)))
      buf = buf.slice(end).trimStart()
    }
    return merged
  } catch (e) {
    log(`${color.red}gh JSON parse failed: ${e.message}${color.reset}`)
    return null
  }
}

const fetchCodeScanning = (owner, repo) => {
  log(`${color.cyan}► code-scanning alerts …${color.reset}`)
  const alerts = ghApiPaginated(`/repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=100`)
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
  const alerts = ghApiPaginated(`/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`)
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

const groupBySeverity = (findings) => {
  const groups = { critical: [], high: [], medium: [], low: [], unknown: [] }
  for (const f of findings) {
    const sev = ['critical', 'high', 'medium', 'low'].includes(f.severity) ? f.severity : 'unknown'
    groups[sev].push(f)
  }
  return groups
}

const renderConsole = (findings) => {
  const groups = groupBySeverity(findings)
  const sevColor = { critical: color.red, high: color.red, medium: color.yellow, low: color.cyan, unknown: color.dim }
  let out = `\n${color.bold}Security Scan Report — ${new Date().toISOString()}${color.reset}\n`
  out += `Total findings: ${findings.length}\n`
  for (const sev of ['critical', 'high', 'medium', 'low', 'unknown']) {
    if (groups[sev].length === 0) continue
    out += `\n${sevColor[sev]}${color.bold}${sev.toUpperCase()}${color.reset} (${groups[sev].length})\n`
    for (const f of groups[sev]) {
      const loc = f.file
        ? `${f.file}${f.line ? `:${f.line}` : ''}`
        : (f.package ? `${f.package}@${f.version || '?'}` : '')
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
        : (f.package ? `\`${f.package}@${f.version || '?'}\`` : '')
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
    log(`${color.yellow}⚠ Konnte Repo nicht aus 'git remote get-url origin' ableiten — falle auf --mode=local zurueck${color.reset}`)
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
    process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), repo: repoMeta, findings }, null, 2))
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

  if (MAX_SEV) {
    const threshold = sevIndex(MAX_SEV)
    if (threshold === -1) {
      log(`${color.red}Unbekannter --max-severity-Wert: ${MAX_SEV}${color.reset}`)
      process.exit(2)
    }
    const blocking = findings.filter(f => sevIndex(f.severity) >= threshold)
    if (blocking.length > 0) {
      log(`${color.red}${color.bold}✗ ${blocking.length} finding(s) >= '${MAX_SEV}' — blocking.${color.reset}`)
      process.exit(1)
    }
  }
}

main()
