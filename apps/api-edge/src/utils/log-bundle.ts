import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Allowlist: NUR diagnostisch unbedenkliche Felder gelangen ins Export-Bundle.
// Das Bundle wird an externen Support/Analyse weitergegeben — daher Allowlist
// statt Denylist. Bewusst NICHT exportiert: `businessContext` (Betraege,
// Kundendaten, Tisch), `requestData` (Request-Bodies), `errorStack`,
// `validationErrors` (AJV-`params` kann Eingabewerte spiegeln). Reicht zur
// Fehler-Identifikation (service/method/statusCode/error). Ein spaeterer
// „verbose"-Export kann eine kuratierte businessContext-Sub-Allowlist ergaenzen.
export const SAFE_LOG_FIELDS = [
  'timestamp',
  'level',
  'message',
  'requestId',
  'service',
  'method',
  'provider',
  'userId',
  'userRole',
  'tenantId',
  'locationId',
  'deviceId',
  'status',
  'statusCode',
  'duration_ms',
  'resultCount',
  'errorName',
  'errorMessage',
] as const

export const scrubLogEntry = (raw: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const key of SAFE_LOG_FIELDS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}

export interface LogBundle {
  /** gzip-komprimiertes, gescrubtes NDJSON. */
  gzip: Buffer
  /** SHA-256 (hex) des gzip-Buffers — Integritaetspruefung des Bundles. */
  sha256: string
  lineCount: number
  fileCount: number
  generatedAt: string
}

// Nur die rotierenden Logdateien bündeln — NICHT die versteckte
// `.<hash>-audit.json`-Rotations-Bookkeeping-Datei von winston-daily-rotate-file.
const LOG_FILE_PATTERN = /^api-edge-.*\.log$/

export const buildLogBundle = async (logDir: string): Promise<LogBundle> => {
  let files: string[]
  try {
    files = (await readdir(logDir)).filter(name => LOG_FILE_PATTERN.test(name)).sort()
  } catch {
    // Verzeichnis existiert noch nicht (es wurde noch nie geloggt) → leeres Bundle.
    files = []
  }

  const lines: string[] = []
  for (const file of files) {
    const content = await readFile(join(logDir, file), 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        lines.push(JSON.stringify(scrubLogEntry(JSON.parse(trimmed) as Record<string, unknown>)))
      } catch {
        // Unparsebare Zeile (z.B. beim Rotieren abgeschnitten) ueberspringen.
      }
    }
  }

  const ndjson = lines.length > 0 ? `${lines.join('\n')}\n` : ''
  const gzip = gzipSync(Buffer.from(ndjson, 'utf8'))
  const sha256 = createHash('sha256').update(gzip).digest('hex')

  return {
    gzip,
    sha256,
    lineCount: lines.length,
    fileCount: files.length,
    generatedAt: new Date().toISOString(),
  }
}
