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
//
// 🚨 Eine Auslassung hier ist nicht nur „Feld fehlt", sondern eine FALSCHE
// ANTWORT auf eine Suche. Am 2026-09-12 (panary/panary-core#293) fehlte `event`,
// und ein `grep 'sync.conflict.apply_failed'` ueber den Export lieferte 0
// Treffer — gelesen als „die Zeile wurde nie geschrieben". Sie stand da, nur
// ohne ihren Namen. Wer die Liste kuerzt, nimmt also nicht Information weg,
// sondern erzeugt einen plausiblen Fehlschluss. Neue Eintraege deshalb mit
// Begruendung, Streichungen erst recht.
export const SAFE_LOG_FIELDS = [
  'timestamp',
  'level',
  'message',
  // Der Event-Name ist die Kennung, ueber die Runbooks, Doku und Issues eine
  // Logzeile adressieren („`sync.conflict.apply_failed` darf nur auftreten,
  // wenn …"). Ohne ihn ist jede Verifikation dieser Form ueber den Export
  // unbeantwortbar.
  //
  // Unbedenklich ist er, weil er aus dem Code stammt und nicht aus den Daten:
  // gemessen ueber `apps/` + `libs/` (2026-09-12) 220 verschiedene Namen, alle
  // feste Zeichenketten. Die einzige Interpolation ist
  // `sync.run.${outcome.toLowerCase()}` (record-sync-run.helper.ts) und setzt
  // einen Enum-Wert ein (`success`/`partial`/`failure`/`throttled`) — kein
  // Nutzdatum. Kaeme je ein Event-Name mit interpolierten Nutzdaten dazu, waere
  // das schon fuer die Log-Kardinalitaet falsch, nicht erst fuer den Export.
  'event',
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
