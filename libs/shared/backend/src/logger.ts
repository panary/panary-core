// For more information about this file see https://dove.feathersjs.com/guides/cli/logging.html
import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import type { Application } from './declarations'

const isProduction = process.env['NODE_ENV'] === 'production'

// In Test-Läufen (Vitest) KEINE Logdateien schreiben — sonst legt jeder
// Testlauf data/logs/ an und verrauscht das Repo.
const isTest = process.env['NODE_ENV'] === 'test' || !!process.env['VITEST']

// Verzeichnis fuer die rotierenden NDJSON-Logdateien. Relativer Default
// `data/logs` analog zum SQLite-Pfad (`data/api-edge.sqlite`) — landet im
// gleichen Docker-Volume. Ueber LOG_DIR ueberschreibbar.
const LOG_DIR = process.env['LOG_DIR'] || 'data/logs'

// --- Farb-Helfer für Dev-Ausgabe ---
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const MAGENTA = '\x1b[35m'
const WHITE = '\x1b[37m'

const LEVEL_COLORS: Record<string, string> = {
  error: RED,
  warn: YELLOW,
  info: GREEN,
  debug: MAGENTA,
}

// Feste Breiten für bündige Ausrichtung
const LEVEL_WIDTH = 5 // "ERROR" ist das längste
const METHOD_WIDTH = 6 // "PATCH " / "DELETE"

function padLevel(level: string): string {
  return level.toUpperCase().padEnd(LEVEL_WIDTH)
}

function padMethod(method: string): string {
  return (method || '').toUpperCase().padEnd(METHOD_WIDTH)
}

function formatTime(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function colorForStatus(code: number): string {
  if (code >= 500) return RED
  if (code >= 400) return YELLOW
  if (code >= 300) return CYAN
  return GREEN
}

// Feathers-Methode → HTTP-Verb-Mapping
const METHOD_TO_VERB: Record<string, string> = {
  find: 'GET',
  get: 'GET',
  create: 'POST',
  update: 'PUT',
  patch: 'PATCH',
  remove: 'DELETE',
}

/**
 * Formatiert ein Wide Event als menschenlesbare Konsolenzeile.
 *
 * Format:
 *   14:32:07 INFO  POST   /orders — 201 in 42ms
 *                  ↳ order:pos/dine-in · items:3 · total:28.50€ · payment:pending
 */
function formatWideEvent(info: Record<string, unknown>): string {
  const level = String(info.level || 'info')
  const levelColor = LEVEL_COLORS[level] || WHITE
  const statusCode = Number(info.statusCode || 0)
  const statusColor = colorForStatus(statusCode)
  const duration = info.duration_ms != null ? `${info.duration_ms}ms` : ''
  const method = METHOD_TO_VERB[String(info.method || '')] || String(info.method || '').toUpperCase()
  const path = `/${info.service || ''}`

  // Hauptzeile: 14:32:07 INFO  POST   /orders — 201 in 42ms
  let line = `${DIM}${formatTime()}${RESET} `
  line += `${levelColor}${BOLD}${padLevel(level)}${RESET} `
  line += `${WHITE}${padMethod(method)}${RESET} `
  line += `${CYAN}${path}${RESET}`
  line += ` ${DIM}—${RESET} `
  line += `${statusColor}${BOLD}${statusCode}${RESET}`

  if (duration) {
    line += ` ${DIM}in${RESET} ${duration}`
  }

  // Bei Fehlern: Fehlerbeschreibung anhängen
  if (info.errorMessage) {
    line += ` ${DIM}·${RESET} ${RED}${info.errorName || 'Error'}: ${info.errorMessage}${RESET}`
  }

  // Validierungsfehler: Details als zweite Zeile mit Pfad + Fehlertyp
  const validationErrors = info.validationErrors
  if (validationErrors) {
    line += `\n${' '.repeat(15)}${RED}↳ ${formatValidationErrors(validationErrors)}${RESET}`
  }

  // Business-Kontext als weitere Zeile (nur wenn vorhanden)
  const biz = info.businessContext as Record<string, unknown> | undefined
  if (biz && Object.keys(biz).length > 0) {
    const segments = formatBusinessSegments(biz)
    if (segments.length > 0) {
      line += `\n${' '.repeat(15)}${DIM}↳${RESET} ${segments.join(` ${DIM}·${RESET} `)}`
    }
  }

  return line
}

/**
 * Formatiert Ajv-Validierungsfehler als menschenlesbare Zeile.
 *
 * Ajv-Fehler: [{ instancePath: '/items/0/price', keyword: 'required', message: '...', params: {...} }]
 * Ergebnis:   "/items/0/price: must have required property 'amount' · /payment: must be object"
 */
function formatValidationErrors(errors: unknown): string {
  if (Array.isArray(errors)) {
    return errors
      .map((e: Record<string, unknown>) => {
        const path = e.instancePath || e.path || ''
        const msg = e.message || e.keyword || 'invalid'
        const param = e.params as Record<string, unknown> | undefined
        // Kontextabhängige Details aus params extrahieren
        const detail = formatAjvParams(param, e.keyword as string)
        return `${path || '/'}${DIM}: ${RESET}${msg}${detail}`
      })
      .join(` ${DIM}·${RESET} `)
  }
  // Fallback: nicht-Ajv-Fehler einfach stringifizieren
  return typeof errors === 'string' ? errors : JSON.stringify(errors)
}

/**
 * Extrahiert den relevanten Kontext aus Ajv-Fehler-params je nach keyword.
 */
function formatAjvParams(params: Record<string, unknown> | undefined, keyword: string | undefined): string {
  if (!params) return ''

  switch (keyword) {
    case 'required':
      return params.missingProperty ? ` '${params.missingProperty}'` : ''
    case 'additionalProperties':
      return params.additionalProperty ? ` '${params.additionalProperty}'` : ''
    case 'enum':
      return Array.isArray(params.allowedValues)
        ? ` [${params.allowedValues.join(', ')}]`
        : ''
    case 'type':
      return params.type ? ` (expected ${params.type})` : ''
    case 'minLength':
    case 'maxLength':
      return params.limit != null ? ` (limit: ${params.limit})` : ''
    case 'minimum':
    case 'maximum':
      return params.limit != null ? ` (${keyword}: ${params.limit})` : ''
    case 'pattern':
      return params.pattern ? ` /${params.pattern}/` : ''
    case 'format':
      return params.format ? ` (expected ${params.format})` : ''
    default:
      return ''
  }
}

/**
 * Baut kompakte Geschäftskontext-Segmente wie "order:pos/dine-in" oder "items:3".
 */
function formatBusinessSegments(biz: Record<string, unknown>): string[] {
  const segments: string[] = []

  // Order-Kontext
  if (biz.orderChannel || biz.dineLocation) {
    const parts = [biz.orderChannel, biz.dineLocation].filter(Boolean).join('/')
    segments.push(`${CYAN}order${RESET}:${parts}`)
  }
  if (biz.dailySequenceNumber != null) {
    segments.push(`${CYAN}seq${RESET}:${DIM}#${RESET}${biz.dailySequenceNumber}`)
  }
  if (biz.lineItemCount != null) {
    segments.push(`${CYAN}items${RESET}:${biz.lineItemCount}`)
  }
  if (biz.grossAmount != null) {
    segments.push(`${CYAN}total${RESET}:${Number(biz.grossAmount).toFixed(2)}€`)
  }
  if (biz.netAmount != null && biz.grossAmount == null) {
    // Netto nur anzeigen, wenn kein Brutto vorhanden (sonst redundant)
    segments.push(`${CYAN}netto${RESET}:${Number(biz.netAmount).toFixed(2)}€`)
  }
  if (biz.paymentState) {
    segments.push(`${CYAN}payment${RESET}:${biz.paymentState}`)
  }
  if (biz.paymentMethod) {
    segments.push(`${CYAN}via${RESET}:${biz.paymentMethod}`)
  }
  if (biz.orderStatus && biz.orderStatus !== 'active') {
    segments.push(`${CYAN}status${RESET}:${biz.orderStatus}`)
  }

  // Produkt-Kontext
  if (biz.productType) {
    segments.push(`${CYAN}type${RESET}:${String(biz.productType).toLowerCase()}`)
  }
  if (biz.productStatus) {
    segments.push(`${CYAN}status${RESET}:${String(biz.productStatus).toLowerCase()}`)
  }
  if (biz.price != null) {
    segments.push(`${CYAN}price${RESET}:${Number(biz.price).toFixed(2)}€`)
  }
  if (biz.stockLevel != null) {
    segments.push(`${CYAN}stock${RESET}:${biz.stockLevel}`)
  }

  // Working Time Kontext
  if (biz.operation) {
    segments.push(`${CYAN}op${RESET}:${biz.operation}`)
  }
  if (biz.totalWorkTime_minutes != null) {
    segments.push(`${CYAN}work${RESET}:${biz.totalWorkTime_minutes}min`)
  }
  if (biz.breakCount != null) {
    segments.push(`${CYAN}breaks${RESET}:${biz.breakCount}`)
  }

  // Business Day Kontext
  if (biz.businessDate) {
    segments.push(`${CYAN}day${RESET}:${biz.businessDate}`)
  }

  // Generischer Fallback: Alle nicht erkannten Felder kompakt ausgeben
  const handledKeys = new Set([
    'orderChannel', 'dineLocation', 'dailySequenceNumber', 'lineItemCount',
    'grossAmount', 'netAmount', 'paymentState', 'paymentMethod', 'orderStatus',
    'productType', 'productStatus', 'price', 'stockLevel',
    'operation', 'totalWorkTime_minutes', 'breakCount', 'businessDate',
  ])
  for (const [key, val] of Object.entries(biz)) {
    if (!handledKeys.has(key) && val != null && val !== '') {
      segments.push(`${CYAN}${key}${RESET}:${val}`)
    }
  }

  return segments
}

/**
 * Formatiert Nicht-Wide-Event-Logs (Startup, Lifecycle, etc.) im Dev-Modus.
 *
 * Nach normalizeObject() liegen alle Felder auf Top-Level. info.message ist
 * entweder ein String (normaler Log) oder '' (wurde aus Objekt extrahiert).
 */
function formatGenericLog(info: Record<string, unknown>): string {
  const level = String(info.level || 'info')
  const levelColor = LEVEL_COLORS[level] || WHITE

  let line = `${DIM}${formatTime()}${RESET} `
  line += `${levelColor}${BOLD}${padLevel(level)}${RESET} `

  const msg = typeof info.message === 'string' && info.message.length > 0
    ? info.message
    : undefined

  // Bekannte interne Felder, die nicht als Meta ausgegeben werden
  const skipKeys = new Set(['message', 'level', 'timestamp', 'splat', Symbol.for('level'), Symbol.for('message'), Symbol.for('splat')])

  // Alle Meta-Felder sammeln (alles außer message/level/timestamp)
  const meta: string[] = []
  for (const [key, val] of Object.entries(info)) {
    if (skipKeys.has(key) || val == null || val === '') continue
    meta.push(`${CYAN}${key}${RESET}=${typeof val === 'object' ? JSON.stringify(val) : val}`)
  }

  if (msg) {
    line += msg
    if (meta.length > 0) {
      line += ` ${DIM}${meta.join(' ')}${RESET}`
    }
  } else if (meta.length > 0) {
    // Kein explizites message-Feld — nur Meta-Felder kompakt ausgeben
    line += meta.join(` ${DIM}·${RESET} `)
  }

  return line
}

/**
 * Normalisiert info-Objekte: Wenn logger.info(obj) mit einem Objekt aufgerufen wird,
 * landet das Objekt als info.message. Diese Format-Stufe spreizt die Felder auf Top-Level,
 * damit format.printf einheitlich darauf zugreifen kann.
 */
const normalizeObject = format((info) => {
  if (typeof info.message === 'object' && info.message !== null) {
    const msg = info.message as Record<string, unknown>
    Object.assign(info, msg)
    info.message = (msg.message as string) || ''
  }
  return info
})

// --- Dev-Format: Menschenlesbare Konsolenausgabe ---
const devFormat = format.combine(
  normalizeObject(),
  format.printf((info) => {
    // Wide Events erkennen: haben service + method + statusCode
    if (info.service && info.method && info.statusCode != null) {
      return formatWideEvent(info as Record<string, unknown>)
    }
    return formatGenericLog(info as Record<string, unknown>)
  })
)

// --- Prod-Format: Strukturiertes JSON ---
const prodFormat = format.combine(
  normalizeObject(),
  format.timestamp(),
  format.json()
)

// Rotierende Logdatei fuer den Support-Log-Export (Phase 1). Schreibt IMMER
// strukturiertes JSON (Wide-Events als NDJSON) — unabhaengig vom Console-Format,
// damit die Datei maschinenlesbar und formatgleich zur Cloud-stdout-JSON ist.
// Harte Caps gegen Volllaufen des geteilten data/-Volumes (SQLite liegt daneben).
// Schreibfehler werden geschluckt — Logging darf NIE den Request-Pfad crashen.
const fileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'api-edge-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '7d',
  format: prodFormat,
})
fileTransport.on('error', () => undefined)

export const logger = createLogger({
  level: 'info',
  transports: [
    new transports.Console({ format: isProduction ? prodFormat : devFormat }),
    ...(isTest ? [] : [fileTransport]),
  ],
})

// Funktion um Logger Level aus Config zu laden
export const configureLoggerLevel = (app: Application) => {
  const logLevel = app.get('logLevel')

  if (logLevel) {
    logger.level = logLevel
    logger.info({ message: 'Logger level configured', logLevel })
  }
}
