import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Allowlist: NUR diagnostisch unbedenkliche Felder gelangen ins Export-Bundle.
// Das Bundle wird an externen Support/Analyse weitergegeben — daher Allowlist
// statt Denylist. Bewusst NICHT exportiert: `businessContext` (Betraege,
// Kundendaten, Tisch), `requestData` (Request-Bodies), `errorStack`,
// `validationErrors` (AJV-`params` kann Eingabewerte spiegeln — einzige
// Ausnahme: die Strukturform bei `sync.pull.apply_failed`, siehe
// STRUCTURED_VALIDATION_EVENTS). Reicht zur
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
  // Zaehler aus `sync.bootstrap.pull_records_rejected` — reine Zahlen. Ohne sie
  // sagt die Zeile nur „verworfen", nicht wie viele von wie vielen (#674).
  'rejectedTotal',
  'total',
] as const

// Zeilen, deren Validierungsfehler einen Cloud-Record betreffen (#674). Am
// 2026-10-12 trug der Export fuenfmal `sync.pull.apply_failed service=locations
// „validation failed"` — welches Feld und welcher Datensatz, verwarf der Scrub.
// Die Ursache (`currentBusinessDay` fehlte im Create-Schema, #664) liess sich nur
// aus dem Code erschliessen, nicht aus dem Log belegen.
//
// Bewusst NUR dieses Event: Hier stammen die Schluessel aus einem Cloud-Dokument,
// das die Cloud selbst schema-validiert hat. Bei einem Request-400 (canonical
// log) sind sie Client-Eingabe und koennen Werte tragen — dort bleibt es beim
// Ausschluss aus dem Kopfkommentar.
const STRUCTURED_VALIDATION_EVENTS = new Set(['sync.pull.apply_failed'])

// Ein Schema-Bezeichner: Feldname, Keyword, Format, Typ. Alles andere (Leer-
// zeichen, @, Punkte, ueberlange Ketten) koennte ein Wert sein und wird `*`.
const SCHEMA_IDENT = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VALIDATION_ERRORS = 10

const identOrStar = (v: unknown): string | undefined =>
  typeof v === 'string' ? (SCHEMA_IDENT.test(v) ? v : '*') : undefined

const scrubJsonPointer = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  // Platzhalter von `extractAjvValidationErrors` (sync-apply.ts) fuer einen Fehler am Wurzelobjekt.
  if (v === '<root>') return v
  return v
    .split('/')
    .map(seg => (seg === '' || /^\d{1,6}$/.test(seg) || SCHEMA_IDENT.test(seg) ? seg : '*'))
    .join('/')
}

/**
 * Strukturform der AJV-Fehler: Pfad, Keyword und die Parameter, die ein Schema
 * beschreiben — nie `data`, nie `message` (koennte kuenftig Werte zitieren), nie
 * `params` als Ganzes.
 */
export const scrubValidationErrors = (raw: unknown): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(raw)) return undefined
  return raw.slice(0, MAX_VALIDATION_ERRORS).map(entry => {
    const e = (entry ?? {}) as Record<string, unknown>
    const params = (e['params'] ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const path = scrubJsonPointer(e['path'] ?? e['instancePath'])
    if (path !== undefined) out['path'] = path
    const keyword = identOrStar(e['keyword'])
    if (keyword !== undefined) out['keyword'] = keyword
    for (const key of ['additionalProperty', 'missingProperty', 'format', 'type'] as const) {
      const v = identOrStar(params[key])
      if (v !== undefined) out[key] = v
    }
    if (typeof params['limit'] === 'number') out['limit'] = params['limit']
    return out
  })
}

export const scrubLogEntry = (raw: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const key of SAFE_LOG_FIELDS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  if (typeof raw['event'] === 'string' && STRUCTURED_VALIDATION_EVENTS.has(raw['event'])) {
    // Die `_id` des verworfenen Records — eine uuid, kein Nutzdatum.
    if (typeof raw['entityId'] === 'string' && UUID.test(raw['entityId'])) out['entityId'] = raw['entityId']
    const errors = scrubValidationErrors(raw['validationErrors'])
    if (errors) out['validationErrors'] = errors
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
