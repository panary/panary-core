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
  const result = await (app.service(syncOutboxPath) as any).find({
    provider: undefined,
    paginate: false,
    query: { status: SyncOutboxStatus.PENDING, $limit: PUSH_BATCH_SIZE, $sort: { _id: 1 } },
  })
  return Array.isArray(result) ? result : []
}

const markOutboxStatus = async (
  app: Application,
  ids: string[],
  status: SyncOutboxStatus,
  error?: string,
): Promise<void> => {
  for (const id of ids) {
    await (app.service(syncOutboxPath) as any)
      .patch(
        id,
        {
          status,
          syncedAt: status === SyncOutboxStatus.ACKED ? new Date().toISOString() : undefined,
          lastError: error,
          lastAttemptAt: new Date().toISOString(),
        },
        { provider: undefined } as any,
      )
      .catch(() => undefined)
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
  await markOutboxStatus(
    app,
    entries.map(e => e._id),
    SyncOutboxStatus.IN_FLIGHT,
  )
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
    await markOutboxStatus(app, body.accepted, SyncOutboxStatus.ACKED)
    for (const r of body.rejected ?? []) {
      await markOutboxStatus(app, [r._id], SyncOutboxStatus.REJECTED, r.reason)
    }
    return body.accepted.length
  } catch (err) {
    await markOutboxStatus(
      app,
      entries.map(e => e._id),
      SyncOutboxStatus.PENDING,
      err instanceof Error ? err.message : String(err),
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
  const heartbeat = await runHeartbeat(app, connection).catch(err => {
    lastError = err instanceof Error ? err.message : String(err)
    if (err instanceof EdgePairingRequiredError) pairingRequired = true
    return null
  })
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

  const refreshed = (await (app.service(cloudConnectionPath) as any)._get(connection._id)) as CloudConnection

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
    // Stack + AJV-Details mit-loggen, damit der Operator sieht, ob der Error
    // aus dem Cloud-Fetch oder einem Edge-internen Service-Aufruf stammt.
    logger.warn({
      message: 'Push-Worker mit Exception abgebrochen',
      event: 'sync.push.worker_exception',
      errorName: err instanceof Error ? err.name : undefined,
      errorMessage: lastError,
      errorStack: err instanceof Error ? err.stack : undefined,
      validationErrors: extractAjvErrors(err),
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
      // Stack + AJV-Details — sonst sieht der Operator nur "validation failed"
      // ohne zu wissen, ob der Fehler aus dem Cloud-Fetch oder einem Edge-
      // internen Service-Aufruf (z.B. service.create/patch im Apply-Loop) kommt.
      logger.warn({
        message: 'Pull-Worker mit Exception abgebrochen',
        event: 'sync.pull.worker_exception',
        service,
        errorName: err instanceof Error ? err.name : undefined,
        errorMessage: errMsg,
        errorStack: err instanceof Error ? err.stack : undefined,
        validationErrors: extractAjvErrors(err),
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
