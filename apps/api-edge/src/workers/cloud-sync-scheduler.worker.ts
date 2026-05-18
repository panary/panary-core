import { logger } from '@panary-core/shared-backend'
import { ClockSkewStatus } from '@panary-core/cloud-edges/domain'
import {
  type CloudConnection,
  PairingStatus,
  SyncMode,
  SYNC_INTERVAL_DEFAULT_SEC,
} from '@panary-core/cloud-connection/domain'
import { SyncableMasterDataService } from '@panary-core/edge-pairing/domain'
import {
  CLOCK_SKEW_ERROR_MS,
  type SyncCursor,
  type SyncHeartbeatResponse,
  type SyncOpEntry,
  type SyncOutboxEntry,
  SyncOutboxStatus,
  type SyncPullResponse,
} from '@panary-core/sync/domain'

import type { Application } from '../declarations'
import { decryptCloudToken, encryptCloudToken } from '../utils/cloud-token-cipher'
import { recordSyncRun } from '../services/sync-runs/record-sync-run.helper'
import { printServerManager } from '../print-server'
import {
  SyncRunDirection,
  SyncRunOutcome,
  SyncRunPhase,
  SyncRunTrigger,
} from '@panary-core/sync/domain'

const cloudConnectionPath = 'cloud-connection'
const syncOutboxPath = 'sync-outbox'
const syncCursorPath = 'sync-cursor'

const HEARTBEAT_TIMEOUT_MS = 10_000
const PUSH_TIMEOUT_MS = 30_000
const PULL_TIMEOUT_MS = 30_000
const PUSH_BATCH_SIZE = 100
const PULL_PAGE_SIZE = 500
const MANUAL_HEARTBEAT_INTERVAL_SEC = 30 * 60

/**
 * Exponential-Backoff-Schedule fuer transient Cloud-Errors (Netzwerk, 5xx,
 * Cloud-Restart-Fenster). Index = `attempts - 1` (also Versuch 1 → 30s,
 * Versuch 2 → 1min, etc.). Nach Index-Ende: 6h-Cap (Versuch 7+).
 *
 * Begruendung der Werte:
 * - 30s: kurz genug, um einen Cloud-Restart zu ueberbruecken
 * - 1min/5min/30min: typische Stufen fuer Outage-Recovery
 * - 2h/6h: Schutz vor Pile-Up bei laengeren Cloud-Ausfaellen — Operator
 *   bekommt Zeit zur Reaktion (Notification, Support-Ticket etc.)
 * - 6h-Cap × MAX_ATTEMPTS=10 = max 1 Eskalation/Tag pro Eintrag
 */
const RETRY_BACKOFF_SCHEDULE_MS = [
  30_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3600_000,
  6 * 3600_000,
] as const

/**
 * Berechnet die Wartezeit bis zum naechsten Push-Versuch in Millisekunden.
 * Wird vom Worker auf `nextAttemptAt = now + backoffMs(attempts)` angewandt.
 * Exportiert fuer Vitest.
 */
export const backoffMs = (attempts: number): number => {
  if (attempts < 1) return RETRY_BACKOFF_SCHEDULE_MS[0]
  const i = Math.min(attempts - 1, RETRY_BACKOFF_SCHEDULE_MS.length - 1)
  return RETRY_BACKOFF_SCHEDULE_MS[i]
}

// Emergency-Override (ADR `emergency-override-adr.md`):
// Aktiviert wird der Notfall-Modus, wenn entweder
// (a) `EMERGENCY_OVERRIDE_FAILURE_THRESHOLD` konsekutive Heartbeat-Fehler
//     auflaufen, ODER
// (b) seit `EMERGENCY_OVERRIDE_AFTER_MS` kein erfolgreicher Heartbeat mehr
//     stattgefunden hat.
// Trigger (a) reagiert schnell auf akute Ausfälle (3×30s = 1,5min), (b)
// fängt Edge-Cases auf, in denen das Scheduling pausiert war.
const EMERGENCY_OVERRIDE_FAILURE_THRESHOLD = 3
const EMERGENCY_OVERRIDE_AFTER_MS = 5 * 60 * 1000

const MASTER_DATA_SERVICES = Object.values(SyncableMasterDataService) as ReadonlyArray<string>

interface SyncRunStats {
  pushed: number
  pulled: number
  durationMs: number
  lastError?: string
}

interface SchedulerHandle {
  stop: () => void
}

/**
 * Extrahiert AJV-Validierungsfehler aus einem Feathers-`BadRequest`-Error.
 *
 * Feathers packt das AJV-Array unter `.data` (alte Builds: `.errors`). Diese
 * Helper-Funktion sucht beide Stellen und liefert ein flaches Array fuer
 * Wide-Event-Logs. Wird in den Push/Pull-Catch-Bloecken genutzt, um zu zeigen
 * WELCHES Feld am Edge-internen Service-Validator hängengeblieben ist.
 */
/**
 * Liest das `exp`-Feld eines JWTs ohne Signatur-Verifikation.
 *
 * Wir vertrauen dem Token-Inhalt nicht fuer Authentifizierung — die Cloud
 * verifiziert bei jedem Call. Hier brauchen wir nur das Ablaufdatum, um es
 * lokal in `cloud-connection.edgeTokenExpiresAt` zu spiegeln und damit den
 * Token-Countdown im POS/Admin-UI zu speisen.
 *
 * Gibt `undefined` zurueck, wenn das Token kein gueltiges JWT ist oder kein
 * `exp`-Claim hat — Fallback ist dann das `nextTokenExpiresAt`-Feld der
 * Heartbeat-Response.
 */
const extractJwtExpiry = (token: string | undefined): string | undefined => {
  if (!token) return undefined
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    // JWTs nutzen base64url; node's Buffer.from(_, 'base64') akzeptiert
    // beide Varianten (URL-safe und Standard) seit Node 16.
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { exp?: number }
    if (typeof payload.exp !== 'number') return undefined
    return new Date(payload.exp * 1000).toISOString()
  } catch {
    return undefined
  }
}

const extractAjvErrors = (err: unknown): Array<{ path: string; message: string; keyword?: string; params?: unknown }> | undefined => {
  const errAny = err as {
    data?: Array<Record<string, unknown>>
    errors?: Array<Record<string, unknown>>
  }
  const arr = Array.isArray(errAny?.data)
    ? errAny.data
    : Array.isArray(errAny?.errors)
      ? errAny.errors
      : undefined
  if (!arr || arr.length === 0) return undefined
  return arr.map(e => ({
    path: (e['instancePath'] as string) || (e['path'] as string) || '<root>',
    message: (e['message'] as string) ?? '?',
    keyword: e['keyword'] as string | undefined,
    params: e['params'],
  }))
}

/**
 * Erzeugt eine kompakte Error-Message fuer einen fehlgeschlagenen Cloud-Call.
 *
 * Cloud antwortet bei Validation-Fehlern als JSON mit AJV-Array unter `data`
 * (`{name:'BadRequest', message:'validation failed', code:400, data:[{instancePath,message,...}]}`).
 * Wir parsen das und loggen die einzelnen Validation-Errors strukturiert ins
 * Wide Event — damit der Operator im Terminal SOFORT sieht, welches Feld an
 * welchem Service abgelehnt wurde, statt nur "validation failed".
 *
 * Die zurueckgegebene Message ist kompakt fuer den `sync-runs`-Eintrag
 * (errorMessage-Spalte ist begrenzt).
 */
/**
 * Erkennt Cloud-Connectivity-Fehler (Network/DNS/Refused/Timeout/TLS).
 *
 * Wenn der Cloud-Server gerade neu startet oder netzwerk-bedingt nicht
 * erreichbar ist, produziert `fetch()` (undici) eine Wand uniformer Fehler —
 * pro Sync-Phase einmal. Stack-Traces helfen hier nicht, weil der Application-
 * Code nie ausgefuehrt wurde; der wahre Grund (Connect-Timeout, DNS, …) steht
 * im `cause`-Feld. Wir nutzen diesen Helper, um solche Fehler kompakt zu
 * loggen und nachfolgende Phasen im selben Tick zu ueberspringen.
 *
 * Erkennt:
 *  - `TypeError: fetch failed` (undici-Default fuer Connect-/DNS-Fehler)
 *  - `AbortError` / `TimeoutError` (von `AbortSignal.timeout()`)
 *  - undici-`cause.code`: `UND_ERR_*`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`,
 *    `ETIMEDOUT`
 */
const isCloudUnreachableError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  if (err.name === 'TypeError' && err.message === 'fetch failed') return true
  const cause = (err as { cause?: { code?: string; name?: string } }).cause
  if (cause?.code && /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_)/.test(cause.code)) {
    return true
  }
  if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') return true
  return false
}

const buildCloudErrorMessage = (
  pathLabel: string,
  status: number,
  rawBody: string,
  context: Record<string, unknown>,
): string => {
  let parsed: { name?: string; message?: string; data?: unknown; errors?: unknown } | null = null
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    parsed = null
  }
  const ajvErrors = (() => {
    const data = parsed?.data
    const errors = parsed?.errors
    if (Array.isArray(data)) return data as Array<Record<string, unknown>>
    if (Array.isArray(errors)) return errors as Array<Record<string, unknown>>
    return undefined
  })()

  if (ajvErrors && ajvErrors.length > 0) {
    const validationErrors = ajvErrors.map(e => ({
      path: (e['instancePath'] as string) || (e['path'] as string) || '<root>',
      message: (e['message'] as string) ?? '?',
      keyword: e['keyword'] as string | undefined,
      params: e['params'],
    }))
    logger.warn({
      message: `${pathLabel}: Cloud-Validation abgelehnt`,
      event: 'sync.cloud.validation_failed',
      ...context,
      status,
      cloudErrorName: parsed?.name,
      cloudErrorMessage: parsed?.message,
      validationErrors,
    })
    const compact = validationErrors
      .slice(0, 3)
      .map(v => `${v.path}: ${v.message}`)
      .join('; ')
    return `${pathLabel} fehlgeschlagen: ${status} ${parsed?.message ?? 'validation failed'} — ${compact}`
  }

  // Kein strukturierter Body — Rohtext kuerzen, damit errorMessage handhabbar bleibt.
  const truncated = rawBody.length > 240 ? rawBody.slice(0, 240) + '…' : rawBody
  logger.warn({
    message: `${pathLabel}: Cloud-Call fehlgeschlagen`,
    event: 'sync.cloud.error',
    ...context,
    status,
    rawBody: truncated,
  })
  return `${pathLabel} fehlgeschlagen: ${status} ${truncated}`
}

const cloudFetch = async (
  cloudUrl: string,
  cloudToken: string,
  pathSuffix: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> => {
  const { timeoutMs = HEARTBEAT_TIMEOUT_MS, ...rest } = init
  return fetch(`${cloudUrl}${pathSuffix}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      // Custom-Header statt Authorization: Bearer — vermeidet Konflikt mit der
      // Cloud-JWT-Strategy, die jeden Bearer-Token zuerst parsed.
      'X-Edge-Token': cloudToken,
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Marker-Error, der signalisiert: Cloud hat 401 zurueckgegeben, der Edge-Token
 * ist abgelaufen oder der CloudEdge wurde widerrufen. Der Sync-Scheduler
 * erkennt das und pausiert weitere Sync-Phasen, statt in eine Retry-Schleife
 * mit ungueltigem Token zu laufen.
 */
class EdgePairingRequiredError extends Error {
  override readonly name = 'EdgePairingRequiredError'
  constructor(public readonly reason: string, public readonly phase: string) {
    super(`Edge-Token nicht mehr gueltig (${reason}) in Phase ${phase}`)
  }
}

/**
 * Wird von runHeartbeat/runPush/runPullForService aufgerufen, sobald die Cloud
 * eine 401-Response zurueckgibt. Setzt den lokalen `cloud-connection`-Datensatz
 * auf DISCONNECTED, hinterlegt Zeit und Grund — und wirft danach
 * EdgePairingRequiredError, damit der Aufrufer Sync-Phase abbricht.
 *
 * Der Helper ist idempotent: mehrfaches Aufrufen mit demselben 401 ueberschreibt
 * lediglich `lastTokenErrorAt`, was unschaedlich ist.
 */
const handleCloudAuthError = async (
  app: Application,
  connection: CloudConnection,
  response: Response,
  phase: string,
): Promise<void> => {
  const text = await response.clone().text().catch(() => '')
  const reason = text.includes('abgelaufen')
    ? 'token-expired'
    : text.includes('widerrufen')
      ? 'edge-revoked'
      : 'unauthorized'
  await (app.service(cloudConnectionPath) as any)
    ._patch(connection._id, {
      pairingStatus: PairingStatus.DISCONNECTED,
      errorMessage: text || 'Edge-Token nicht mehr gueltig',
      tokenErrorReason: reason,
      lastTokenErrorAt: new Date().toISOString(),
    })
    .catch((err: unknown) => {
      logger.warn({
        message: 'cloud-connection.pairingStatus konnte nicht auf DISCONNECTED gesetzt werden',
        event: 'sync.token.invalid_patch_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })
  logger.warn({
    message: 'Cloud-Token ungueltig — Re-Pairing erforderlich',
    event: 'sync.token.invalid',
    reason,
    phase,
    status: 401,
  })
  throw new EdgePairingRequiredError(reason, phase)
}

const getActiveConnection = async (app: Application): Promise<CloudConnection | null> => {
  const result = await (app.service(cloudConnectionPath) as any).find({
    provider: undefined,
    paginate: false,
    query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
  })
  return Array.isArray(result) ? (result[0] ?? null) : null
}

const upsertCursor = async (
  app: Application,
  service: string,
  patch: Partial<SyncCursor>,
): Promise<void> => {
  const id = `cloud:${service}`
  const existing = await (app.service(syncCursorPath) as any)
    .get(id, { provider: undefined } as any)
    .catch(() => null)
  if (existing) {
    await (app.service(syncCursorPath) as any).patch(id, patch, { provider: undefined } as any)
  } else {
    await (app.service(syncCursorPath) as any).create(
      {
        _id: id,
        service,
        ...patch,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { provider: undefined } as any,
    )
  }
}

const fetchPendingOutbox = async (app: Application): Promise<SyncOutboxEntry[]> => {
  // Sort ueber `_id` (uuidv7 enthaelt einen Millisekunden-Zeitstempel als
  // Praefix — sortiert chronologisch wie `createdAt`). `createdAt` ist nicht
  // in `syncOutboxEntryQueryProperties` enthalten und wuerde von validateQuery
  // mit `additionalProperty: createdAt` abgelehnt.
  //
  // `$or` filtert Backoff-Eintraege: nur faellig wenn `nextAttemptAt` <= now
  // ODER NULL (= Initial-Versuch, nie zuvor gepusht). Schliesst transient
  // gescheiterte Eintraege bis zum naechsten Slot aus → kein Pile-Up beim
  // Cloud-Restart.
  const now = new Date().toISOString()
  const result = await (app.service(syncOutboxPath) as any).find({
    provider: undefined,
    paginate: false,
    query: {
      status: SyncOutboxStatus.PENDING,
      $or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: null }],
      $limit: PUSH_BATCH_SIZE,
      $sort: { _id: 1 },
    },
  })
  return Array.isArray(result) ? result : []
}

/**
 * Markiert Outbox-Eintraege als erfolgreich an die Cloud uebertragen.
 * Setzt `status='acked'` + `syncedAt`. Audit-Cleanup-Worker raeumt
 * `acked`-Eintraege spaeter weg.
 */
const markOutboxAcked = async (app: Application, ids: string[]): Promise<void> => {
  const now = new Date().toISOString()
  for (const id of ids) {
    await (app.service(syncOutboxPath) as any)
      .patch(
        id,
        { status: SyncOutboxStatus.ACKED, syncedAt: now, lastAttemptAt: now },
        { provider: undefined } as any,
      )
      .catch(() => undefined)
  }
}

/**
 * Markiert Outbox-Eintraege fuer einen spaeteren Retry. Inkrementiert
 * `attempts` und setzt `nextAttemptAt = now + backoffMs(newAttempts)`.
 * Wird bei transient errors (Netzwerk, 5xx) aufgerufen.
 *
 * Wichtig: Eingangs-`attempts` ist der bisherige Wert; wir schreiben das
 * inkrementierte Resultat.
 */
const markOutboxRetry = async (
  app: Application,
  entries: ReadonlyArray<{ _id: string; attempts: number }>,
  error: string,
): Promise<void> => {
  const now = new Date().toISOString()
  for (const entry of entries) {
    const nextAttempts = (entry.attempts ?? 0) + 1
    const next = new Date(Date.now() + backoffMs(nextAttempts)).toISOString()
    await (app.service(syncOutboxPath) as any)
      .patch(
        entry._id,
        {
          status: SyncOutboxStatus.PENDING,
          attempts: nextAttempts,
          lastAttemptAt: now,
          nextAttemptAt: next,
          lastError: error,
        },
        { provider: undefined } as any,
      )
      .catch(() => undefined)
  }
}

/**
 * Markiert Outbox-Eintraege als final gescheitert (`rejected`). Setzt
 * `terminalAt`, optional verlinkten Conflict, und stoppt jeglichen
 * weiteren Retry. Operator muss ueber das Sync-Status-UI eingreifen.
 */
const markOutboxTerminal = async (
  app: Application,
  ids: string[],
  error: string,
  linkedConflictId?: string,
): Promise<void> => {
  const now = new Date().toISOString()
  for (const id of ids) {
    await (app.service(syncOutboxPath) as any)
      .patch(
        id,
        {
          status: SyncOutboxStatus.REJECTED,
          terminalAt: now,
          lastAttemptAt: now,
          lastError: error,
          ...(linkedConflictId ? { linkedConflictId } : {}),
        },
        { provider: undefined } as any,
      )
      .catch(() => undefined)
  }
}

/** Backwards-Compat-Wrapper fuer den IN_FLIGHT-Uebergang im Push-Loop. */
const markOutboxInFlight = async (app: Application, ids: string[]): Promise<void> => {
  const now = new Date().toISOString()
  for (const id of ids) {
    await (app.service(syncOutboxPath) as any)
      .patch(
        id,
        { status: SyncOutboxStatus.IN_FLIGHT, lastAttemptAt: now },
        { provider: undefined } as any,
      )
      .catch(() => undefined)
  }
}

/**
 * Beim Worker-Boot: setzt alle `in-flight`-Eintraege zurueck auf `pending`.
 *
 * Hintergrund: Bei Worker-Crash oder Edge-Restart waehrend einer
 * laufenden Push-Operation bleiben Eintraege im `in-flight`-Status haengen
 * und werden nie wieder vom Worker gezogen (Query filtert auf `pending`).
 * Recovery-Reset garantiert, dass solche Eintraege beim naechsten
 * regulaeren Tick wieder gepusht werden.
 */
const recoverInFlightOutbox = async (app: Application): Promise<void> => {
  try {
    const stuck = await (app.service(syncOutboxPath) as any).find({
      provider: undefined,
      paginate: false,
      query: { status: SyncOutboxStatus.IN_FLIGHT, $limit: 500 },
    })
    const entries = (Array.isArray(stuck) ? stuck : []) as Array<{ _id: string }>
    if (entries.length === 0) return
    const now = new Date().toISOString()
    for (const entry of entries) {
      await (app.service(syncOutboxPath) as any)
        .patch(
          entry._id,
          { status: SyncOutboxStatus.PENDING, lastAttemptAt: now },
          { provider: undefined } as any,
        )
        .catch(() => undefined)
    }
    logger.info({
      message: `IN_FLIGHT-Recovery: ${entries.length} sync-outbox-Eintraege auf pending zurueckgesetzt`,
      event: 'sync.outbox.recovery',
      count: entries.length,
    })
  } catch (err) {
    logger.warn({
      message: 'IN_FLIGHT-Recovery fehlgeschlagen',
      event: 'sync.outbox.recovery_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

const runPush = async (app: Application, connection: CloudConnection): Promise<number> => {
  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) return 0
  const entries = await fetchPendingOutbox(app)
  if (entries.length === 0) return 0
  // Knex serialisiert Objekte beim Insert in die SQLite-TEXT-Spalte `payload`
  // automatisch als JSON-String, parsed beim Select aber nicht zurueck.
  // Ohne diesen Parse-Schritt schickt der Worker den rohen JSON-String an die
  // Cloud, dort verteilt `{...string}` den String zeichenweise und AJV lehnt
  // alle Ops mit "must have required property '<field>'" ab.
  const ops: SyncOpEntry[] = entries.map(e => ({
    _id: e._id,
    service: e.service,
    op: e.op,
    entityId: e.entityId,
    payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
    occurredAt: e.occurredAt,
    syncSource: e.syncSource,
  }))
  await markOutboxInFlight(app, entries.map(e => e._id))
  try {
    const response = await cloudFetch(connection.cloudUrl, cloudToken, '/sync-push', {
      method: 'POST',
      body: JSON.stringify({ ops }),
      timeoutMs: PUSH_TIMEOUT_MS,
    })
    if (response.status === 401) {
      await handleCloudAuthError(app, connection, response, 'push')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unbekannter Fehler')
      throw new Error(buildCloudErrorMessage('Push', response.status, text, { phase: 'push' }))
    }
    const body = (await response.json()) as { accepted: string[]; rejected: { _id: string; reason: string }[] }
    await markOutboxAcked(app, body.accepted)
    // Cloud-Rejects bleiben in dieser Phase noch sofort terminal (alte Semantik).
    // Commit 5 ersetzt das durch classification-basierte Logik
    // (transient → markOutboxRetry, conflict → escalateToConflict).
    for (const r of body.rejected ?? []) {
      await markOutboxTerminal(app, [r._id], r.reason)
    }
    return body.accepted.length
  } catch (err) {
    // Network-Errors / 5xx ohne Response-Body → Backoff-Retry, kein Pile-Up
    // beim Cloud-Restart. Alle Eintraege der Batch bekommen denselben
    // attempts++ und denselben naechsten Slot.
    const errorMessage = err instanceof Error ? err.message : String(err)
    await markOutboxRetry(
      app,
      entries.map(e => ({ _id: e._id, attempts: e.attempts ?? 0 })),
      errorMessage,
    )
    throw err
  }
}

const runPullForService = async (
  app: Application,
  connection: CloudConnection,
  service: string,
): Promise<number> => {
  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) return 0
  const cursor = await (app.service(syncCursorPath) as any)
    .get(`cloud:${service}`, { provider: undefined } as any)
    .catch(() => null)
  const since = cursor?.lastPullAt as string | undefined

  let total = 0
  let cursorToken: string | undefined
  // Visibility-Snapshot der Cloud — wird nur beim Initial-Pull (page 0,
  // since=undefined) geliefert. Speichern fuer Reconciliation am Loop-Ende.
  let visibilitySnapshot: string[] | undefined
  for (let page = 0; page < 200; page++) {
    const params = new URLSearchParams()
    params.set('service', service)
    params.set('limit', String(PULL_PAGE_SIZE))
    if (since) params.set('since', since)
    if (cursorToken) params.set('cursor', cursorToken)

    const response = await cloudFetch(
      connection.cloudUrl,
      cloudToken,
      `/sync-pull?${params.toString()}`,
      { method: 'GET', timeoutMs: PULL_TIMEOUT_MS },
    )
    if (response.status === 401) {
      await handleCloudAuthError(app, connection, response, `pull:${service}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unbekannter Fehler')
      throw new Error(
        buildCloudErrorMessage(`Pull (${service})`, response.status, text, {
          phase: 'pull',
          service,
        }),
      )
    }
    const body = (await response.json()) as SyncPullResponse
    if (page === 0 && Array.isArray(body.visibilitySnapshot)) {
      visibilitySnapshot = body.visibilitySnapshot
    }
    for (const item of body.records) {
      try {
        if (item.deletedAt) {
          await app
            .service(service as any)
            .remove(item._id, { provider: undefined, fromSync: true } as any)
            .catch(() => undefined)
          continue
        }
        const existing = await app
          .service(service as any)
          .get(item._id, { provider: undefined } as any)
          .catch(() => null)
        // `fromSync: true` signalisiert den Resolvern (z.B. userPatchResolver),
        // den eingehenden Wert UNVERAENDERT zu uebernehmen — kein Re-Hash auf
        // bereits gehashten posPin/password, kein Re-Generate auf createdAt/
        // employeeNumber. Sonst Doppelt-Hashing → Login-Bruch.
        if (existing) {
          await app
            .service(service as any)
            .patch(item._id, item.record as any, { provider: undefined, fromSync: true } as any)
        } else {
          await app
            .service(service as any)
            .create(item.record as any, { provider: undefined, fromSync: true } as any)
        }
      } catch (err) {
        // AJV-Validierungsdetails extrahieren — sonst loggt der Edge nur
        // "validation failed". Feathers `BadRequest` packt das AJV-Array
        // unter `.data` (alte Builds: `.errors`).
        const errAny = err as {
          data?: Array<{ instancePath?: string; message?: string; params?: unknown }>
          errors?: Array<{ instancePath?: string; message?: string; params?: unknown }>
        }
        const ajvErrors =
          Array.isArray(errAny?.data) ? errAny.data
          : Array.isArray(errAny?.errors) ? errAny.errors
          : undefined
        const validationErrors = ajvErrors?.map(e => ({
          path: e.instancePath || '<root>',
          message: e.message ?? '?',
        }))
        logger.warn({
          message: 'Pull-Apply fehlgeschlagen',
          event: 'sync.pull.apply_failed',
          service,
          entityId: item._id,
          errorMessage: err instanceof Error ? err.message : String(err),
          validationErrors,
        })
      }
    }
    total += body.records.length
    if (!body.hasMore || !body.nextCursor) break
    cursorToken = body.nextCursor
  }
  // `updatedAt` NICHT manuell setzen — `syncCursorPatchSchema` ist ein strikter
  // Pick aus dem Vollschema und enthaelt nur die fachlichen Patch-Felder
  // (lastPullAt etc.). `updatedAt` wird serverseitig vom resolveData-Resolver
  // des sync-cursor-Service gesetzt (siehe sync-cursor.ts).
  await upsertCursor(app, service, {
    lastPullAt: new Date().toISOString(),
  })

  // Reconciliation: stale-Records, die nicht (mehr) im Visibility-Snapshot
  // der Cloud auftauchen, werden lokal archiviert. Aktuell nur fuer `users`,
  // weil Filial-Membership-Wechsel der konkrete Anwendungsfall ist.
  // Records werden NICHT geloescht — Working-Times, Orders etc. referenzieren
  // weiterhin auf die User-IDs. Der `status: ARCHIVED` blendet sie nur aus
  // POS-Login und Admin-User-Liste aus.
  if (service === 'users' && Array.isArray(visibilitySnapshot)) {
    await reconcileStaleUsers(app, visibilitySnapshot, connection.tenantId!)
  }

  return total
}

/**
 * Setzt alle lokalen User auf `status: ARCHIVED`, deren `_id` nicht im
 * Visibility-Snapshot der Cloud auftaucht. Geht davon aus, dass der Snapshot
 * vollstaendig ist (alle fuer diese Edge sichtbaren User).
 *
 * Idempotent — bereits archivierte User bleiben unangetastet.
 */
const reconcileStaleUsers = async (
  app: Application,
  cloudVisibleIds: string[],
  tenantId: string,
): Promise<void> => {
  const startedAt = new Date().toISOString()
  const startMs = performance.now()
  try {
    const visible = new Set(cloudVisibleIds)
    const local = (await app.service('users' as any).find({
      provider: undefined,
      paginate: false,
      query: { $select: ['_id', 'status'] },
    } as any)) as Array<{ _id: string; status?: string }>
    const list = Array.isArray(local) ? local : []
    let archived = 0
    for (const u of list) {
      if (visible.has(u._id)) continue
      if (u.status === 'ARCHIVED') continue
      try {
        await app.service('users' as any).patch(
          u._id,
          { status: 'ARCHIVED' } as any,
          { provider: undefined } as any,
        )
        archived++
      } catch (err) {
        logger.warn({
          message: 'User-Reconciliation: Archivieren fehlgeschlagen',
          event: 'sync.reconcile.archive_failed',
          entityId: u._id,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (archived > 0) {
      logger.info({
        message: 'User-Reconciliation: stale User archiviert',
        event: 'sync.reconcile.users_archived',
        archived,
        totalLocal: list.length,
        totalVisible: cloudVisibleIds.length,
      })
      // sync-run-Eintrag nur wenn tatsaechlich archiviert wurde (Filter-Regel).
      await recordSyncRun(app, {
        tenantId,
        phase: SyncRunPhase.RECONCILE,
        direction: SyncRunDirection.CLOUD_TO_EDGE,
        service: 'users',
        recordCount: archived,
        archived,
        durationMs: Math.round(performance.now() - startMs),
        outcome: SyncRunOutcome.SUCCESS,
        triggeredBy: SyncRunTrigger.SCHEDULER,
        startedAt,
      })
    }
  } catch (err) {
    logger.warn({
      message: 'User-Reconciliation fehlgeschlagen',
      event: 'sync.reconcile.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

const runHeartbeat = async (app: Application, connection: CloudConnection): Promise<SyncHeartbeatResponse | null> => {
  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) return null
  const startMonotonic = performance.now()
  const response = await cloudFetch(connection.cloudUrl, cloudToken, '/sync-heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      edgeTimestamp: new Date().toISOString(),
      edgeClockMonotonicMs: Math.round(startMonotonic),
      edgeVersion: process.env['npm_package_version'] ?? '0.0.0',
    }),
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
  })
  if (response.status === 401) {
    await handleCloudAuthError(app, connection, response, 'heartbeat')
  }
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unbekannter Fehler')
    throw new Error(`Heartbeat fehlgeschlagen: ${response.status} ${text}`)
  }
  const body = (await response.json()) as SyncHeartbeatResponse
  // Erfolgreicher Heartbeat: lastHeartbeatOk markieren, Failure-Counter resetten.
  // Falls Notfall-Modus aktiv war: er wird *nicht* hier automatisch deaktiviert
  // — der Reconciliation-Flow (Phase 5) deaktiviert ihn erst, nachdem die
  // gepufferten lokalen Overrides mit der Cloud abgeglichen wurden.
  // edgeTokenExpiresAt-Update-Strategie:
  // 1. Cloud liefert `nextTokenExpiresAt` (auch ohne Token-Rotation, sobald
  //    Cloud-Side das Feld immer setzt) → bevorzugen
  // 2. Sonst: aktuelles `cloudToken` (JWT) decodieren und `exp` extrahieren,
  //    falls noch nichts in der DB steht (Initial-Bootstrap-Fall)
  let edgeTokenExpiresAt: string | undefined = body.nextTokenExpiresAt
  if (!edgeTokenExpiresAt && !connection.edgeTokenExpiresAt) {
    edgeTokenExpiresAt = extractJwtExpiry(cloudToken)
  }

  await (app.service(cloudConnectionPath) as any)._patch(connection._id, {
    lastClockSkewMs: body.clockSkewMs,
    lastSyncAt: new Date().toISOString(),
    lastHeartbeatOk: new Date().toISOString(),
    consecutiveHeartbeatFailures: 0,
    ...(edgeTokenExpiresAt ? { edgeTokenExpiresAt } : {}),
  })
  if (body.nextToken) {
    const newExpiry = body.nextTokenExpiresAt ?? extractJwtExpiry(body.nextToken)
    await (app.service(cloudConnectionPath) as any)._patch(connection._id, {
      cloudToken: encryptCloudToken(body.nextToken),
      ...(newExpiry ? { edgeTokenExpiresAt: newExpiry } : {}),
    })
  }
  if (body.clockSkewStatus === ClockSkewStatus.ERROR) {
    logger.warn({
      message: 'Clock-Skew zu hoch — Push pausiert',
      event: 'sync.clock_skew.error',
      skewMs: body.clockSkewMs,
    })
  }
  return body
}

/**
 * Reconciliation der Emergency-Override-Patches nach Cloud-Reconnect.
 *
 * Wird aufgerufen, wenn der Edge im Notfall-Modus lokale Drucker-Änderungen
 * akzeptiert hat (`pending-local-overrides` enthält Einträge) und der Cloud-
 * Heartbeat wieder erfolgreich ist. Schickt die gepufferten Patches an
 * `/sync-reconcile-overrides`, die Cloud entscheidet pro Eintrag per
 * Old-Value-Vergleich.
 *
 * Ergebnis: Akzeptierte Einträge werden lokal gelöscht (Edge gewinnt, Cloud
 * hat den Patch übernommen). Konflikte bleiben als `status='CONFLICT'`
 * stehen — UI-gestützte Auflösung ist Folge-Phase.
 *
 * Wenn keine Konflikte mehr offen sind, wird der `emergencyOverride`-Flag
 * der Cloud-Connection zurückgesetzt.
 */
const runReconcileOverrides = async (
  app: Application,
  connection: CloudConnection,
): Promise<void> => {
  if (!connection.emergencyOverride) return
  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) return
  // Knex-Instanz ist als beliebige Query-Builder-API genutzt — wir typisieren
  // sie minimal als `any`, weil die `@types/knex`-Generics in diesem Worker
  // mehr Rauschen als Wert bringen würden (Knex ist runtime-validiert).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = app.get('sqliteClient' as any) as any
  if (!knex) return

  const pending = (await knex
    .table('pending-local-overrides')
    .where({ status: 'PENDING_RECONCILE' })
    .select()) as Array<Record<string, unknown>>
  if (pending.length === 0) {
    // Keine Overrides mehr offen → Notfall-Modus deaktivieren.
    await (app.service(cloudConnectionPath) as any)
      ._patch(connection._id, {
        emergencyOverride: false,
        emergencyOverrideSince: null,
      })
      .catch(() => undefined)
    logger.info({
      message: 'Emergency-Override deaktiviert — keine ausstehenden Overrides',
      event: 'emergency-override.deactivated',
    })
    return
  }

  const overrides = pending.map(row => ({
    overrideId: row['_id'] as string,
    recordId: row['recordId'] as string,
    fieldPath: row['fieldPath'] as string,
    oldValue: JSON.parse((row['oldValueJson'] as string | null) ?? 'null'),
    newValue: JSON.parse((row['newValueJson'] as string | null) ?? 'null'),
  }))

  const response = await cloudFetch(connection.cloudUrl, cloudToken, '/sync-reconcile-overrides', {
    method: 'POST',
    body: JSON.stringify({ overrides }),
    timeoutMs: PUSH_TIMEOUT_MS,
  })
  if (response.status === 401) {
    await handleCloudAuthError(app, connection, response, 'reconcile-overrides')
    return
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn({
      message: 'Reconcile-Overrides Cloud-Call fehlgeschlagen',
      event: 'reconcile.cloud_error',
      status: response.status,
      body: text.slice(0, 200),
    })
    return
  }
  const body = (await response.json()) as {
    accepted: Array<{ overrideId: string }>
    conflicts: Array<{ overrideId: string; reason: string }>
  }

  if (body.accepted.length > 0) {
    await knex
      .table('pending-local-overrides')
      .whereIn(
        '_id',
        body.accepted.map(a => a.overrideId),
      )
      .del()
  }
  if (body.conflicts.length > 0) {
    await knex
      .table('pending-local-overrides')
      .whereIn(
        '_id',
        body.conflicts.map(c => c.overrideId),
      )
      .update({ status: 'CONFLICT', updatedAt: new Date().toISOString() })
  }

  logger.info({
    message: 'Emergency-Override-Reconcile abgeschlossen',
    event: body.conflicts.length === 0 ? 'reconcile.fast-path' : 'reconcile.with-conflicts',
    acceptedCount: body.accepted.length,
    conflictCount: body.conflicts.length,
  })

  // Override-Flag nur deaktivieren, wenn KEINE Konflikte mehr offen sind.
  // Konflikte sollen sichtbar bleiben, damit der Admin sie manuell auflösen
  // kann (kommt in Folge-Phase); solange bleibt der Notfall-Modus aktiv, sodass
  // der Edge bei Bedarf weiter lokale Patches akzeptiert.
  if (body.conflicts.length === 0) {
    await (app.service(cloudConnectionPath) as any)
      ._patch(connection._id, {
        emergencyOverride: false,
        emergencyOverrideSince: null,
      })
      .catch(() => undefined)
    logger.info({
      message: 'Emergency-Override deaktiviert — Reconcile sauber',
      event: 'emergency-override.deactivated',
    })
  }
}

/**
 * Polled die Cloud-`printer-commands`-Queue nach PENDING-Jobs für diesen Edge
 * und führt sie lokal aus (aktuell ausschließlich `TEST_PRINT`).
 *
 * Architektur: Edge ist behind NAT — Cloud kann ihn nicht pushen. Polling im
 * selben Worker wie der Heartbeat hält die Anzahl der ausgehenden Verbindungen
 * minimal und nutzt den bereits existierenden cloud-token. Latenz <30 s ist für
 * Test-Drucke akzeptabel.
 *
 * Idempotenz: Wir setzen IN_PROGRESS vor der Ausführung. Doppel-Pulls (z. B.
 * Worker-Restart mit verbliebener PENDING-Row) führen also zu mindestens einer
 * Ausführung — Test-Druck ist idempotent (Bon-Ausdruck), daher OK.
 */
const runPullPrinterCommands = async (
  app: Application,
  connection: CloudConnection,
): Promise<number> => {
  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) return 0
  const startMs = performance.now()

  const response = await cloudFetch(
    connection.cloudUrl,
    cloudToken,
    '/printer-commands?status=PENDING&%24limit=20&%24sort%5BrequestedAt%5D=1',
    { method: 'GET', timeoutMs: HEARTBEAT_TIMEOUT_MS },
  )
  if (!response.ok) {
    // printer-commands ist eine OPTIONALE Sync-Phase (Test-Drucke aus der Cloud).
    // Die Cloud hat den Endpoint in EDGE_TOKEN_SCOPED_PATHS (authorize.hook) sowie
    // in `secureByDefault.publicServices` (app.ts) freigeschaltet — Mixed-Auth
    // (JWT fuer Admin-POST + edgeToken fuer Edge-Pull/Patch). Aeltere Cloud-
    // Versionen ohne diese Freischaltung antworten weiterhin mit 401/403; das
    // darf hier NICHT das gesamte Pairing zerstoeren. Sobald heartbeat/push/pull
    // weiterhin OK sind, ist der Token gueltig. Soft-Fail: Log + return 0. Wenn
    // der Token wirklich ungueltig waere, faengt der Heartbeat das im naechsten
    // Tick ab und faehrt den Disconnect-Pfad.
    const text = await response.text().catch(() => '')
    logger.warn({
      message: 'printer-commands Pull fehlgeschlagen',
      event: 'printer-commands.pull.error',
      status: response.status,
      body: text.slice(0, 200),
    })
    return 0
  }
  const body = (await response.json()) as {
    data?: Array<{ _id: string; type: string; printerId: string }>
  } | Array<{ _id: string; type: string; printerId: string }>
  const commands = Array.isArray(body) ? body : (body.data ?? [])
  if (commands.length === 0) return 0

  for (const cmd of commands) {
    const claimRes = await cloudFetch(
      connection.cloudUrl,
      cloudToken,
      `/printer-commands/${cmd._id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'IN_PROGRESS',
          pickedUpAt: new Date().toISOString(),
        }),
        timeoutMs: HEARTBEAT_TIMEOUT_MS,
      },
    )
    if (!claimRes.ok) {
      // Andere Edge-Instanz hat zuerst gepatcht oder Job ist weg — überspringen.
      continue
    }

    let finalPatch: Record<string, unknown>
    try {
      if (cmd.type === 'TEST_PRINT') {
        const r = await printServerManager.testPrint(cmd.printerId)
        const firstError = r.results[0]?.error
        finalPatch = r.success
          ? { status: 'DONE', result: 'Testdruck erfolgreich', completedAt: new Date().toISOString() }
          : {
              status: 'FAILED',
              error: firstError ?? 'Testdruck fehlgeschlagen',
              completedAt: new Date().toISOString(),
            }
      } else {
        finalPatch = {
          status: 'FAILED',
          error: `Unbekannter Befehlstyp: ${cmd.type}`,
          completedAt: new Date().toISOString(),
        }
      }
    } catch (err) {
      finalPatch = {
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      }
    }

    await cloudFetch(connection.cloudUrl, cloudToken, `/printer-commands/${cmd._id}`, {
      method: 'PATCH',
      body: JSON.stringify(finalPatch),
      timeoutMs: HEARTBEAT_TIMEOUT_MS,
    }).catch(err => {
      logger.warn({
        message: 'printer-commands Result-PATCH fehlgeschlagen',
        event: 'printer-commands.result.patch_error',
        commandId: cmd._id,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })
  }

  logger.info({
    message: 'printer-commands ausgeführt',
    event: 'printer-commands.completed',
    count: commands.length,
    durationMs: Math.round(performance.now() - startMs),
  })
  return commands.length
}

export const runSyncOnce = async (app: Application, _cloudConnectionId: string): Promise<SyncRunStats> => {
  const start = performance.now()
  const connection = await getActiveConnection(app)
  if (!connection) {
    return { pushed: 0, pulled: 0, durationMs: 0, lastError: 'Keine aktive Cloud-Connection.' }
  }

  let pushed = 0
  let pulled = 0
  let lastError: string | undefined

  // Heartbeat: nur dann als sync-run protokollieren, wenn er fachlich relevant
  // ist (Token-Rotation, Skew-Warning oder Fehler) — stille 5-min-Pings nicht.
  const hbStartedAt = new Date().toISOString()
  const hbStartMs = performance.now()
  let pairingRequired = false
  // heartbeatError aufbewahren, damit wir nach `runHeartbeat()` zwischen
  // Connectivity-Fehlern (Cloud unreachable, kompakt loggen) und echten
  // Application-Fehlern (Stack-Trace + AJV-Details) unterscheiden koennen.
  let heartbeatError: unknown = null
  const heartbeat = await runHeartbeat(app, connection).catch(err => {
    heartbeatError = err
    lastError = err instanceof Error ? err.message : String(err)
    if (err instanceof EdgePairingRequiredError) pairingRequired = true
    return null
  })
  // Failure-Tracking für Emergency-Override (ADR `emergency-override-adr.md`).
  // Nur bei "echten" Heartbeat-Fehlern hochzählen — nicht bei Pairing-401
  // (Pairing-Required ist eine andere Failure-Klasse, dafür ist der
  // pairingStatus-DISCONNECTED-Pfad zuständig).
  if (heartbeat === null && lastError && !pairingRequired) {
    const nextFailureCount = (connection.consecutiveHeartbeatFailures ?? 0) + 1
    const lastOkMs = connection.lastHeartbeatOk
      ? new Date(connection.lastHeartbeatOk).getTime()
      : connection.connectedAt
        ? new Date(connection.connectedAt).getTime()
        : Date.now()
    const elapsed = Date.now() - lastOkMs
    const shouldActivateOverride =
      !connection.emergencyOverride &&
      (nextFailureCount >= EMERGENCY_OVERRIDE_FAILURE_THRESHOLD ||
        elapsed >= EMERGENCY_OVERRIDE_AFTER_MS)
    const patch: Record<string, unknown> = {
      consecutiveHeartbeatFailures: nextFailureCount,
    }
    if (shouldActivateOverride) {
      patch['emergencyOverride'] = true
      patch['emergencyOverrideSince'] = new Date().toISOString()
      logger.warn({
        message: 'Emergency-Override aktiviert — Cloud unerreichbar',
        event: 'emergency-override.activated',
        consecutiveFailures: nextFailureCount,
        elapsedMsSinceLastOk: elapsed,
        reason: lastError,
      })
    }
    await (app.service(cloudConnectionPath) as any)
      ._patch(connection._id, patch)
      .catch(() => undefined)
  }
  if (heartbeat === null && lastError) {
    await recordSyncRun(app, {
      tenantId: connection.tenantId!,
      phase: SyncRunPhase.HEARTBEAT,
      direction: SyncRunDirection.EDGE_TO_CLOUD,
      service: null,
      durationMs: Math.round(performance.now() - hbStartMs),
      outcome: SyncRunOutcome.FAILURE,
      errorMessage: lastError,
      triggeredBy: SyncRunTrigger.SCHEDULER,
      startedAt: hbStartedAt,
    })
  } else if (heartbeat) {
    const tokenRotated = !!heartbeat.nextToken
    const skewIssue =
      heartbeat.clockSkewStatus === ClockSkewStatus.WARN ||
      heartbeat.clockSkewStatus === ClockSkewStatus.ERROR
    if (tokenRotated || skewIssue) {
      await recordSyncRun(app, {
        tenantId: connection.tenantId!,
        phase: SyncRunPhase.HEARTBEAT,
        direction: SyncRunDirection.EDGE_TO_CLOUD,
        service: null,
        durationMs: Math.round(performance.now() - hbStartMs),
        outcome: skewIssue ? SyncRunOutcome.PARTIAL : SyncRunOutcome.SUCCESS,
        errorMessage: skewIssue
          ? `Clock-Skew ${heartbeat.clockSkewStatus} (${heartbeat.clockSkewMs}ms)`
          : undefined,
        triggeredBy: SyncRunTrigger.SCHEDULER,
        startedAt: hbStartedAt,
      })
    }
  }
  if (heartbeat?.clockSkewMs !== undefined && Math.abs(heartbeat.clockSkewMs) > CLOCK_SKEW_ERROR_MS) {
    return {
      pushed: 0,
      pulled: 0,
      durationMs: Math.round(performance.now() - start),
      lastError: 'Clock-Skew zu gross — Push blockiert.',
    }
  }

  // Wenn der Heartbeat einen 401 gemeldet hat, hat handleCloudAuthError den
  // pairingStatus bereits auf DISCONNECTED gesetzt. Push/Pull-Phasen mit
  // ungueltigem Token zu starten waere nur Larm im Log.
  if (pairingRequired) {
    return {
      pushed: 0,
      pulled: 0,
      durationMs: Math.round(performance.now() - start),
      lastError,
    }
  }

  // Cloud unerreichbar (DNS/Refused/Timeout, typisch waehrend Cloud-Restarts):
  // Reconcile/PrinterCommands/Push/Pull haetten ohnehin alle `fetch failed` —
  // jede dieser 9 Phasen wuerde dasselbe undici-Stacktrace-Triplet loggen.
  // Wir steigen kompakt aus und warten auf den naechsten Tick. Das
  // `Sync-Run: heartbeat failure`-Record + Emergency-Override-Tracking sind
  // bereits oben geschrieben — der Operator sieht die Ursache eindeutig.
  if (heartbeat === null && isCloudUnreachableError(heartbeatError)) {
    logger.info({
      message: 'Cloud unerreichbar — Sync-Phasen ausgesetzt bis zum naechsten Heartbeat',
      event: 'sync.cloud_unreachable',
      reason: lastError,
    })
    return {
      pushed: 0,
      pulled: 0,
      durationMs: Math.round(performance.now() - start),
      lastError,
    }
  }

  const refreshed = (await (app.service(cloudConnectionPath) as any)._get(connection._id)) as CloudConnection

  // Reconciliation der Emergency-Override-Patches, falls Cloud zurück ist.
  // No-op, wenn kein Override aktiv oder keine pending-local-overrides existieren.
  // Failures dürfen den restlichen Sync nicht blockieren.
  await runReconcileOverrides(app, refreshed).catch(err => {
    logger.warn({
      message: 'Reconcile-Overrides mit Exception abgebrochen',
      event: 'reconcile.worker_exception',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  })

  // Printer-Commands: kurzer Pull direkt nach dem Heartbeat, bevor Push/Pull
  // der Master-Daten läuft. Latenz für Test-Drucke bleibt damit <30 s
  // (Worker-Tick), ohne dass wir einen eigenen Worker brauchen. Failures hier
  // dürfen Push/Pull nicht blockieren — fangen daher den Error ab.
  await runPullPrinterCommands(app, refreshed).catch(err => {
    // Cloud-Connect-Fehler haben keinen brauchbaren Stack — nur die
    // Application-Errors loggen wir mit Detail. Symmetrisch zur Behandlung
    // in der Pull-Master-Data-Schleife.
    if (isCloudUnreachableError(err)) return
    logger.warn({
      message: 'printer-commands Pull-Phase mit Exception abgebrochen',
      event: 'printer-commands.pull.worker_exception',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  })

  // Push: sync-run nur wenn Outbox-Eintraege vorhanden waren (recordSyncRun
  // filtert via accepted+rejected>0 selbst).
  const pushStartedAt = new Date().toISOString()
  const pushStartMs = performance.now()
  try {
    pushed = await runPush(app, refreshed)
    if (pushed > 0) {
      await recordSyncRun(app, {
        tenantId: refreshed.tenantId!,
        phase: SyncRunPhase.PUSH,
        direction: SyncRunDirection.EDGE_TO_CLOUD,
        service: null,
        recordCount: pushed,
        accepted: pushed,
        durationMs: Math.round(performance.now() - pushStartMs),
        outcome: SyncRunOutcome.SUCCESS,
        triggeredBy: SyncRunTrigger.SCHEDULER,
        startedAt: pushStartedAt,
      })
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    if (err instanceof EdgePairingRequiredError) pairingRequired = true
    // Stack + AJV-Details nur bei Application-Errors mit-loggen — sonst sieht
    // der Operator nur, ob der Error aus dem Cloud-Fetch oder einem Edge-
    // internen Service-Aufruf stammt. Bei Cloud-Connect-Fehlern (fetch failed,
    // ECONNREFUSED, …) ist der undici-Stack uninformativ — kompakt ohne Stack.
    const cloudUnreachable = isCloudUnreachableError(err)
    logger.warn({
      message: 'Push-Worker mit Exception abgebrochen',
      event: 'sync.push.worker_exception',
      errorName: err instanceof Error ? err.name : undefined,
      errorMessage: lastError,
      errorStack: cloudUnreachable ? undefined : err instanceof Error ? err.stack : undefined,
      validationErrors: cloudUnreachable ? undefined : extractAjvErrors(err),
    })
    await recordSyncRun(app, {
      tenantId: refreshed.tenantId!,
      phase: SyncRunPhase.PUSH,
      direction: SyncRunDirection.EDGE_TO_CLOUD,
      service: null,
      durationMs: Math.round(performance.now() - pushStartMs),
      outcome: SyncRunOutcome.FAILURE,
      errorMessage: lastError,
      triggeredBy: SyncRunTrigger.SCHEDULER,
      startedAt: pushStartedAt,
    })
  }

  // Wenn Push 401 sah, ist der Token kaputt — Pull-Schleife waere nur Larm.
  if (pairingRequired) {
    return {
      pushed,
      pulled: 0,
      durationMs: Math.round(performance.now() - start),
      lastError,
    }
  }

  // Pull pro Service: sync-run nur wenn recordCount>0 ODER Fehler.
  for (const service of MASTER_DATA_SERVICES) {
    if (pairingRequired) break
    const pullStartedAt = new Date().toISOString()
    const pullStartMs = performance.now()
    try {
      const count = await runPullForService(app, refreshed, service)
      pulled += count
      if (count > 0) {
        await recordSyncRun(app, {
          tenantId: refreshed.tenantId!,
          phase: SyncRunPhase.PULL,
          direction: SyncRunDirection.CLOUD_TO_EDGE,
          service,
          recordCount: count,
          durationMs: Math.round(performance.now() - pullStartMs),
          outcome: SyncRunOutcome.SUCCESS,
          triggeredBy: SyncRunTrigger.SCHEDULER,
          startedAt: pullStartedAt,
        })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      lastError = errMsg
      if (err instanceof EdgePairingRequiredError) pairingRequired = true
      // Stack + AJV-Details nur bei Application-Errors — bei Cloud-Connect-
      // Fehlern (fetch failed/ECONNREFUSED/…) ist der undici-Stack uninformativ
      // und produziert 7x dasselbe Triplet (ein Stack pro Master-Data-Service).
      const cloudUnreachable = isCloudUnreachableError(err)
      logger.warn({
        message: 'Pull-Worker mit Exception abgebrochen',
        event: 'sync.pull.worker_exception',
        service,
        errorName: err instanceof Error ? err.name : undefined,
        errorMessage: errMsg,
        errorStack: cloudUnreachable ? undefined : err instanceof Error ? err.stack : undefined,
        validationErrors: cloudUnreachable ? undefined : extractAjvErrors(err),
      })
      await recordSyncRun(app, {
        tenantId: refreshed.tenantId!,
        phase: SyncRunPhase.PULL,
        direction: SyncRunDirection.CLOUD_TO_EDGE,
        service,
        durationMs: Math.round(performance.now() - pullStartMs),
        outcome: SyncRunOutcome.FAILURE,
        errorMessage: errMsg,
        triggeredBy: SyncRunTrigger.SCHEDULER,
        startedAt: pullStartedAt,
      })
    }
  }

  return {
    pushed,
    pulled,
    durationMs: Math.round(performance.now() - start),
    lastError,
  }
}

const computeNextScheduledSlot = (times: string[], timezone: string, lastRunAt?: string): number => {
  // Simplified: nimmt naechste Uhrzeit aus times (HH:mm), interpretiert als
  // lokal in `timezone`. Bei Verpasstem Slot >24h wird sofort gefeuert.
  const now = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
  const baseDate = new Date(local.getFullYear(), local.getMonth(), local.getDate())
  const offsets = times
    .map(t => {
      const [h, m] = t.split(':').map(Number)
      return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), h, m).getTime()
    })
    .sort((a, b) => a - b)
  const localNow = local.getTime()
  for (const o of offsets) {
    if (o > localNow) return o - localNow
  }
  // Alle Slots heute vorbei → naechster fuer morgen
  if (lastRunAt) {
    const last = new Date(lastRunAt).getTime()
    if (Date.now() - last > 24 * 60 * 60 * 1000) return 0
  }
  return offsets[0] + 24 * 60 * 60 * 1000 - localNow
}

export const startCloudSyncSchedulerWorker = async (app: Application): Promise<SchedulerHandle> => {
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  // Recovery vor dem ersten Tick: bei Worker-Crash oder Edge-Restart waehrend
  // einer laufenden Push-Operation bleiben Eintraege im `in-flight`-Status
  // haengen. Reset auf `pending`, damit sie beim ersten Tick wieder gezogen
  // werden.
  await recoverInFlightOutbox(app)

  const tick = async () => {
    if (stopped) return
    const connection = await getActiveConnection(app).catch(() => null)
    if (!connection) {
      // Kein aktiver CONNECTED-Eintrag: kann a) noch nicht gepairt sein oder
      // b) nach einem 401-Auto-Disconnect auf DISCONNECTED stehen. In beiden
      // Faellen waere ein 60s-Polling unsinnig — der User muss aktiv
      // (re-)pairen, dafuer reicht eine 5-Min-Pause.
      timer = setTimeout(tick, 5 * 60 * 1000)
      return
    }
    const mode = connection.syncMode ?? SyncMode.AUTO
    let delaySec = SYNC_INTERVAL_DEFAULT_SEC

    try {
      switch (mode) {
        case SyncMode.AUTO:
          await runSyncOnce(app, connection._id)
          delaySec = connection.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC
          break
        case SyncMode.SCHEDULED: {
          if (connection.syncSchedule) {
            const ms = computeNextScheduledSlot(
              connection.syncSchedule.times,
              connection.syncSchedule.timezone,
              connection.lastScheduledSyncAt,
            )
            if (ms <= 0) {
              await runSyncOnce(app, connection._id)
              await (app.service(cloudConnectionPath) as any)._patch(connection._id, {
                lastScheduledSyncAt: new Date().toISOString(),
              })
            }
            delaySec = Math.max(60, Math.round((ms || 60_000) / 1000))
          }
          break
        }
        case SyncMode.MANUAL:
          await runHeartbeat(app, connection).catch(() => undefined)
          delaySec = MANUAL_HEARTBEAT_INTERVAL_SEC
          break
        case SyncMode.DISABLED:
          delaySec = 5 * 60
          break
      }
    } catch (err) {
      logger.warn({
        message: 'Sync-Scheduler-Tick fehlgeschlagen',
        event: 'sync.scheduler.tick_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
    timer = setTimeout(tick, Math.max(60_000, delaySec * 1000))
  }

  // Erster Tick mit kurzer Verzoegerung, damit alle Services oben sind.
  timer = setTimeout(tick, 5_000)

  logger.info({ message: 'Cloud-Sync-Scheduler gestartet', event: 'sync.scheduler.started' })

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
