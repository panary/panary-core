import { uuidv7 } from 'uuidv7'

import {
  BootstrapStatus,
  type CloudConnection,
  InitialSyncDirection,
  PairingStatus,
} from '@panary/cloud-connection/domain'
import { SyncableMasterDataService, SyncableTransactionService } from '@panary/edge-pairing/domain'
import { SyncOp, SyncSource, type SyncBootstrapResponse, type SyncOpEntry } from '@panary/sync/domain'
import { isSyncPushBlockedRole, stripUserEdgeLocalFields } from '@panary/users/domain'

import type { Application } from '../declarations'
import { logger } from '@panary/shared-backend'
import { applyCloudTenantId, createPrePairingBackup } from '../utils/apply-cloud-tenant-id'
import { decryptCloudToken } from '../utils/cloud-token-cipher'
import { recordSyncRun } from '../services/sync-runs/record-sync-run.helper'
import {
  captureState,
  collectSyncRunIds,
  createReport,
  dumpToFile,
  finalizeReport,
  runConsistencyCheck,
  updateReport,
} from '../services/bootstrap-reports/bootstrap-report.helper'
import { type BootstrapReportDirection, BootstrapReportStatus } from '@panary/cloud-connection/domain'
import { applyPulledRecords, cloudFetch, pullMasterDataPage } from './sync-apply'
import { SyncRunDirection, SyncRunOutcome, SyncRunPhase, SyncRunTrigger } from '@panary/sync/domain'

const requireDecryptedToken = (connection: CloudConnection): string => {
  const token = decryptCloudToken(connection.cloudToken)
  if (!token) throw new Error('cloudToken fehlt in der Cloud-Connection.')
  return token
}

const BOOTSTRAP_CHUNK_SIZE = 1000
// Bootstrap-Calls bewegen grosse Chunks (bis 1000 Records) — laengerer Timeout
// als der 10s-Default des geteilten cloudFetch (sync-apply.ts). An jeder
// Call-Site explizit mitgeben.
const BOOTSTRAP_TIMEOUT_MS = 60_000

const cloudConnectionPath = 'cloud-connection'

// Reihenfolge ist relevant beim Initial-Bootstrap:
//  - LOCATIONS zuerst, weil andere Stammdaten (z.B. users mit allowedLocationIds,
//    products mit locationId) den Foreign-Key auf locations referenzieren.
//  - PRODUCT_GROUPS vor PRODUCTS, weil Products auf Product-Groups verweisen.
//  - BUSINESS_DAYS vor den TRANSACTION_SERVICES (insbesondere `orders`), weil
//    `order.businessDayId` darauf verweist. Cloud ist Master fuer BusinessDays
//    im Hybrid-Modell — Edge zieht read-only.
const MASTER_DATA_SERVICES: ReadonlyArray<string> = [
  SyncableMasterDataService.LOCATIONS,
  SyncableMasterDataService.OPENING_HOUR_EXCEPTIONS,
  SyncableMasterDataService.PRODUCT_GROUPS,
  SyncableMasterDataService.PRODUCTS,
  SyncableMasterDataService.USERS,
  SyncableMasterDataService.CORPORATE_CUSTOMERS,
  SyncableMasterDataService.CUSTOMERS,
  SyncableMasterDataService.BUSINESS_DAYS,
]

// Cloud-Master-only-Services: werden beim Bootstrap AUSSCHLIESSLICH Cloud→Edge
// gepullt (runPullCloudToEdge) — niemals Edge→Cloud gepusht oder gemerged.
// Die tenants-Replica traegt keine tenantId-Spalte (ihr `_id` IST der Tenant)
// und keinen externalId-Mechanismus; collectAllRecords/truncateMasterTables
// mit `query: { tenantId }` liefe direkt in `no such column: tenantId`.
// Pull immer im upsert-Modus (kein Truncate; genau 1 Row, idempotent).
const PULL_ONLY_MASTER_SERVICES: ReadonlyArray<string> = [SyncableMasterDataService.TENANTS]

// `locations` hat (noch) keinen `externalId`-Mechanismus — Merge-by-external-id
// kann sie nicht matchen und wuerde fuer jeden Edge-Standort einen
// `sync-conflict` mit Grund `external-id-missing` erzeugen. Bis ein
// `externalId`-Feld auf dem Location-Schema existiert, wird `locations` im
// Merge-Pfad uebersprungen — der `applyCloudTenantId`-Restamp hat zu diesem
// Zeitpunkt bereits die Location-IDs aligned.
//
// `businessdays` haben ebenfalls keinen `externalId`-Mechanismus und sind im
// Hybrid-Modell Cloud-Master — Edge kann sie nur als Replica halten, nicht
// merge-konfliktbehaftet anwenden. Daher im Merge-Pfad uebersprungen.
const MERGE_BY_EXTERNAL_ID_SERVICES: ReadonlyArray<string> = MASTER_DATA_SERVICES.filter(
  service =>
    service !== SyncableMasterDataService.LOCATIONS &&
    service !== SyncableMasterDataService.BUSINESS_DAYS &&
    // Feiertage sind Cloud-materialisiert (kein externalId), Edge hält sie als
    // Replica — wie locations/businessdays NICHT merge-by-external-id.
    service !== SyncableMasterDataService.OPENING_HOUR_EXCEPTIONS,
)

const TRANSACTION_SERVICES: ReadonlyArray<string> = [
  SyncableTransactionService.ORDERS,
  SyncableTransactionService.ORDER_INTERACTIONS,
  SyncableTransactionService.WORKING_TIMES,
]

const BACKFILL_RECENT_DAYS = 90
// Seitengroesse fuer den gechunkten Backfill-Read (Keyset ueber _id) — haelt
// pro Iteration nur eine Seite statt aller 90-Tage-Records im RAM.
const BACKFILL_PAGE_SIZE = 500
// Cap fuer parallel laufende sync-outbox.creates pro Batch. sync-outbox
// erlaubt kein Multi-Create (`multi: ['patch']`), daher gebatchte
// Einzel-Creates statt Array-Create.
const BACKFILL_CREATE_CONCURRENCY = 25

const persistStatus = async (app: Application, id: string, patch: Partial<CloudConnection>): Promise<void> => {
  await (app.service(cloudConnectionPath) as any)._patch(id, patch)
}

const collectAllRecords = async (app: Application, service: string, tenantId: string): Promise<unknown[]> => {
  const result = await app.service(service as any).find({
    provider: undefined,
    paginate: false,
    // `paginate: false` reicht aus — `$limit: -1` waere redundant und wuerde vom
    // AJV-Query-Validator (querySyntax setzt `$limit: Type.Number({ minimum: 0 })`)
    // mit "validation failed" abgelehnt.
    query: { tenantId },
  } as any)
  return Array.isArray(result) ? result : []
}

const buildSyncOp = (record: any, service: string, source: SyncSource): SyncOpEntry => ({
  _id: uuidv7(),
  service,
  op: SyncOp.CREATE,
  entityId: record._id,
  // Geraetelokale Time-Clock-Felder (stampingId/startBreakAt) nie pushen —
  // sie sind reiner Edge-Runtime-Zustand. Siehe USER_EDGE_LOCAL_FIELDS.
  payload: service === 'users' ? stripUserEdgeLocalFields(record as Record<string, unknown>) : record,
  occurredAt: record.updatedAt ?? new Date().toISOString(),
  syncSource: source,
})

const pushBootstrapChunks = async (
  cloudUrl: string,
  cloudToken: string,
  service: string,
  ops: SyncOpEntry[],
): Promise<void> => {
  for (let offset = 0; offset < ops.length; offset += BOOTSTRAP_CHUNK_SIZE) {
    const chunk = ops.slice(offset, offset + BOOTSTRAP_CHUNK_SIZE)
    const finalChunk = offset + chunk.length >= ops.length
    const response = await cloudFetch(cloudUrl, cloudToken, '/sync-bootstrap', {
      method: 'POST',
      body: JSON.stringify({ service, ops: chunk, finalChunk } satisfies {
        service: string
        ops: SyncOpEntry[]
        finalChunk: boolean
      }),
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unbekannter Fehler')
      throw new Error(`Bootstrap-Push fuer ${service} fehlgeschlagen: ${response.status} ${text}`)
    }
    const body = (await response.json()) as SyncBootstrapResponse
    if (body.rejected.length > 0) {
      throw new Error(
        `Bootstrap-Push fuer ${service} hat ${body.rejected.length} abgelehnte Records: ${body.rejected[0].reason}`,
      )
    }
  }
}

/**
 * Reiht die Transaction-Records der letzten BACKFILL_RECENT_DAYS Tage als
 * BACKFILL-Eintraege in die Sync-Outbox ein — gechunkt statt Vollscan.
 *
 * Read-Pfad: Keyset-Pagination (`_id > cursor` + `$sort: { _id: 1 }` +
 * `$limit`) statt `paginate: false`-Komplettload. uuidv7-_ids sind eindeutig
 * und zeitlich geordnet — die Seiten sind deterministisch und
 * ueberschneidungsfrei, ohne die Offset-Kosten von `$skip`.
 *
 * `createdAt <= windowEnd` fixiert das Fenster auf den Lauf-Start: Records,
 * die WAEHREND des Backfills entstehen, erfasst bereits der Live-Outbox-
 * Recorder — ohne die Obergrenze wuerde das Keyset sie zusaetzlich als
 * BACKFILL einreihen (Doppel-Push derselben Entity).
 *
 * Write-Pfad: gebatchte Einzel-Creates via Promise.all mit Concurrency-Cap
 * (siehe BACKFILL_CREATE_CONCURRENCY). Fehler pro Record werden geloggt —
 * ein kaputter Record blockiert nie den Rest. Rueckgabe = erfolgreich
 * eingereihte Eintraege.
 *
 * Exportiert fuer den fokussierten Worker-Test — `pageSize` ist dort
 * injizierbar, um Mehrseiten-Pagination mit kleinen Fixtures zu erzwingen.
 */
export const queueBackfillOutbox = async (
  app: Application,
  service: string,
  tenantId: string,
  pageSize: number = BACKFILL_PAGE_SIZE,
): Promise<number> => {
  const startMs = Date.now()
  const since = new Date(startMs - BACKFILL_RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(startMs).toISOString()
  let queued = 0
  let cursor: string | undefined
  for (;;) {
    const page = await app.service(service as any).find({
      provider: undefined,
      paginate: false,
      query: {
        tenantId,
        createdAt: { $gte: since, $lte: windowEnd },
        ...(cursor ? { _id: { $gt: cursor } } : {}),
        $sort: { _id: 1 },
        $limit: pageSize,
      },
    } as any)
    const list = (Array.isArray(page) ? page : []) as Array<Record<string, unknown>>
    if (list.length === 0) break
    for (let offset = 0; offset < list.length; offset += BACKFILL_CREATE_CONCURRENCY) {
      const batch = list.slice(offset, offset + BACKFILL_CREATE_CONCURRENCY)
      await Promise.all(
        batch.map(async record => {
          try {
            await app.service('sync-outbox' as any).create(
              {
                _id: uuidv7(),
                service,
                op: SyncOp.CREATE,
                entityId: record._id as string,
                payload: record,
                occurredAt: (record.updatedAt as string | undefined) ?? new Date().toISOString(),
                syncSource: SyncSource.BACKFILL,
              },
              { provider: undefined } as any,
            )
            queued++
          } catch (err) {
            logger.warn({
              message: 'Backfill-Outbox-Eintrag fehlgeschlagen',
              event: 'sync.backfill.failed',
              service,
              entityId: record._id as string,
              errorMessage: err instanceof Error ? err.message : String(err),
            })
          }
        }),
      )
    }
    cursor = list[list.length - 1]._id as string
    if (list.length < pageSize) break
  }
  return queued
}

// Liefert die Services, deren Truncate fehlschlug: dort duerfen die Pull-Seiten
// NICHT im insert-Modus laufen (Alt-Rows -> PK-Konflikt fuer jede Row, der alte
// Bestand bliebe stehen) — der Aufrufer degradiert sie auf 'upsert'.
const truncateMasterTables = async (app: Application, tenantId: string): Promise<Set<string>> => {
  const failed = new Set<string>()
  for (const service of MASTER_DATA_SERVICES) {
    try {
      await app.service(service as any).remove(
        null as any,
        {
          provider: undefined,
          query: { tenantId },
        } as any,
      )
    } catch (err) {
      failed.add(service)
      logger.warn({
        message: 'TRUNCATE waehrend pull-cloud-to-edge fehlgeschlagen',
        event: 'sync.bootstrap.truncate_failed',
        service,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return failed
}

const pullAllPagesForService = async (
  cloudUrl: string,
  cloudToken: string,
  app: Application,
  service: string,
  mode: 'insert' | 'upsert',
): Promise<number> => {
  let cursor: string | undefined
  let total = 0
  let rejectedTotal = 0
  for (let page = 0; page < 1000; page++) {
    const response = await pullMasterDataPage(cloudUrl, cloudToken, service, undefined, cursor, BOOTSTRAP_TIMEOUT_MS)
    // `mode: 'insert'`: truncateMasterTables hat die Tabellen unmittelbar vor
    // diesem Loop geleert — jede _id ist garantiert neu, der gebatchte
    // Existenz-Check des Upsert-Modus waere pro Seite ein Leer-Roundtrip.
    // Schlug der Truncate fuer diesen Service fehl, degradiert der Aufrufer
    // auf 'upsert' (selbstheilend gegen die verbliebenen Alt-Rows).
    const result = await applyPulledRecords(app, service, response.records, { mode })
    rejectedTotal += result.rejected
    total += response.records.length
    if (!response.hasMore || !response.nextCursor) break
    cursor = response.nextCursor
  }
  if (rejectedTotal > 0) {
    // Nicht still lassen: recordSyncRun am Aufrufer zaehlt nur die gepullten
    // Records — rejected Rows waeren sonst unsichtbar verloren.
    logger.warn({
      message: `Bootstrap-Pull: ${rejectedTotal} von ${total} Records wurden beim Apply verworfen`,
      event: 'sync.bootstrap.pull_records_rejected',
      service,
      rejectedTotal,
      total,
    })
  }
  return total
}

const runBootstrapEdgeToCloud = async (
  app: Application,
  connection: CloudConnection,
  bootstrapReportId: string | null,
): Promise<void> => {
  const cloudToken = requireDecryptedToken(connection)
  // Optional vom Wizard befuellt: nur diese User-IDs werden gepusht. Wenn nicht
  // gesetzt, gilt der Default (alle Users — Cloud-Server filtert blockierte
  // Rollen via PUSH_BLOCKED_USER_ROLES als zweite Verteidigungslinie).
  const userAllowlist =
    Array.isArray(connection.bootstrapUserAllowlist) && connection.bootstrapUserAllowlist.length > 0
      ? new Set(connection.bootstrapUserAllowlist)
      : null
  for (const service of MASTER_DATA_SERVICES) {
    const startedAt = new Date().toISOString()
    const startMs = performance.now()
    try {
      const allRecords = await collectAllRecords(app, service, connection.tenantId!)
      // Bei users IMMER cloud-managed Rollen (tenant:owner, platform:*) am Edge
      // ausfiltern. Cloud-Server lehnt sie ohnehin als zweite Verteidigungslinie
      // ab, der Edge-Bootstrap-Runner wuerde diese erwarteten Rejects sonst als
      // Failure interpretieren (Bootstrap geht in failed-State).
      const recordsAfterRoleFilter =
        service === SyncableMasterDataService.USERS
          ? allRecords.filter(r => !isSyncPushBlockedRole((r as { role?: string }).role))
          : allRecords
      const records =
        service === SyncableMasterDataService.USERS && userAllowlist
          ? recordsAfterRoleFilter.filter(r => userAllowlist.has((r as { _id?: string })._id ?? ''))
          : recordsAfterRoleFilter
      const ops = records.map(record => buildSyncOp(record, service, SyncSource.LIVE))
      if (ops.length === 0) {
        logger.info({
          message: `Bootstrap-Push uebersprungen (keine Records)`,
          event: 'sync.bootstrap.service_skipped',
          service,
          recordCount: 0,
          ...(service === SyncableMasterDataService.USERS && userAllowlist
            ? { userAllowlistSize: userAllowlist.size, totalUserRecords: allRecords.length }
            : {}),
        })
        // Bootstrap mit 0 Records trotzdem als sync-run protokollieren —
        // initialer Sync ist immer relevant fuer die History (zeigt, dass das
        // Service ueberprueft wurde).
        await recordSyncRun(app, {
          tenantId: connection.tenantId!,
          phase: SyncRunPhase.BOOTSTRAP,
          direction: SyncRunDirection.EDGE_TO_CLOUD,
          service,
          recordCount: 0,
          durationMs: Math.round(performance.now() - startMs),
          outcome: SyncRunOutcome.SUCCESS,
          triggeredBy: SyncRunTrigger.BOOTSTRAP,
          startedAt,
          ...(bootstrapReportId ? { bootstrapReportId } : {}),
        })
        continue
      }
      logger.info({
        message: `Bootstrap-Push gestartet`,
        event: 'sync.bootstrap.service_push_started',
        service,
        recordCount: ops.length,
        ...(service === SyncableMasterDataService.USERS && userAllowlist
          ? { userAllowlistSize: userAllowlist.size, totalUserRecords: allRecords.length }
          : {}),
      })
      await pushBootstrapChunks(connection.cloudUrl, cloudToken, service, ops)
      logger.info({
        message: `Bootstrap-Push abgeschlossen`,
        event: 'sync.bootstrap.service_push_done',
        service,
        recordCount: ops.length,
      })
      await recordSyncRun(app, {
        tenantId: connection.tenantId!,
        phase: SyncRunPhase.BOOTSTRAP,
        direction: SyncRunDirection.EDGE_TO_CLOUD,
        service,
        recordCount: ops.length,
        accepted: ops.length,
        durationMs: Math.round(performance.now() - startMs),
        outcome: SyncRunOutcome.SUCCESS,
        triggeredBy: SyncRunTrigger.BOOTSTRAP,
        startedAt,
        ...(bootstrapReportId ? { bootstrapReportId } : {}),
      })
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : String(err)
      // Fehler ALS sync-run protokollieren — bevor wir den Throw nach oben weitergeben.
      await recordSyncRun(app, {
        tenantId: connection.tenantId!,
        phase: SyncRunPhase.BOOTSTRAP,
        direction: SyncRunDirection.EDGE_TO_CLOUD,
        service,
        recordCount: 0,
        durationMs: Math.round(performance.now() - startMs),
        outcome: SyncRunOutcome.FAILURE,
        errorMessage: baseMessage,
        triggeredBy: SyncRunTrigger.BOOTSTRAP,
        startedAt,
        ...(bootstrapReportId ? { bootstrapReportId } : {}),
      })
      // Service-Info in den Error packen, damit der aussere Catch im
      // runBootstrap-Wrapper sie im sync.bootstrap.failed-Event sieht.
      throw new Error(`[service=${service}] ${baseMessage}`)
    }
  }
  for (const service of TRANSACTION_SERVICES) {
    try {
      logger.info({
        message: `Backfill-Outbox-Queue gestartet`,
        event: 'sync.bootstrap.backfill_started',
        service,
      })
      const queued = await queueBackfillOutbox(app, service, connection.tenantId!)
      logger.info({
        message: `Backfill-Outbox-Queue abgeschlossen`,
        event: 'sync.bootstrap.backfill_done',
        service,
        recordCount: queued,
      })
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : String(err)
      throw new Error(`[backfill service=${service}] ${baseMessage}`)
    }
  }
}

/**
 * Schreibt `location.currentBusinessDay` lokal nach, nachdem die BusinessDays
 * via Master-Pull in SQLite gelandet sind.
 *
 * Hintergrund Cloud-First-Hybrid: Cloud ist Master fuer BusinessDays. Beim
 * Pairing zieht der Edge alle BusinessDays als Master-Data (read-only Replica).
 * Der lokale `location.currentBusinessDay`-Pointer ist aber Edge-managed (POS
 * + Edge-Order-Hook lesen ihn) und muss nach dem Pull aktualisiert werden,
 * sonst sieht der POS-Order-Hook keinen offenen Tag und blockt jede Order
 * mit BUSINESS_DAY_NOT_SET — obwohl die Cloud-Replica einen offenen Tag hat.
 *
 * `isEmergencyOverride: true` umgeht den `cloudManaged()`-Hook auf der Edge
 * (apps/api-edge/src/services/locations/locations.ts:107-109), der externe
 * Schreibzugriffe auf `locations` nach Pairing blockiert.
 */
export const reconcileLocationBusinessDay = async (app: Application, tenantId: string): Promise<void> => {
  try {
    const openDays = await (app.service('businessdays' as any) as any).find({
      provider: undefined,
      paginate: false,
      query: { tenantId, status: 'open' },
    })
    const items = Array.isArray(openDays) ? openDays : ((openDays as { data?: unknown[] })?.data ?? [])

    // Pro Location nur den juengsten offenen Tag als Zeiger setzen. Frueher lief
    // die Schleife ueber ALLE offenen Tage und patchte den Zeiger je Durchlauf —
    // bei mehreren offenen Tagen derselben Location gewann eine beliebige Zeile
    // ("last row wins", Reihenfolge undefiniert). Genau dieser Zeiger-Drift liess
    // aeltere Tage dauerhaft offen zurueck, weil rotateBusinessDay nur das
    // Zeiger-Ziel schliesst.
    const newestPerLocation = new Map<string, { _id: string; locationId: string; date: string }>()
    const openCountPerLocation = new Map<string, number>()
    for (const day of items as Array<{ _id: string; locationId: string | null; date: string }>) {
      if (!day.locationId) continue
      openCountPerLocation.set(day.locationId, (openCountPerLocation.get(day.locationId) ?? 0) + 1)
      const current = newestPerLocation.get(day.locationId)
      // `date` ist YYYY-MM-DD → lexikografischer Vergleich == chronologisch.
      if (!current || day.date > current.date) {
        newestPerLocation.set(day.locationId, { _id: day._id, locationId: day.locationId, date: day.date })
      }
    }

    for (const [locationId, count] of openCountPerLocation) {
      if (count > 1) {
        logger.warn({
          message: `Location hat ${count} gleichzeitig offene Geschaeftstage`,
          event: 'business_day.multiple_open_days',
          tenantId,
          locationId,
          openDayCount: count,
        })
      }
    }

    for (const day of newestPerLocation.values()) {
      try {
        await (app.service('locations' as any) as any).patch(
          day.locationId,
          { currentBusinessDay: { businessDayId: day._id, date: day.date } },
          { provider: undefined, isEmergencyOverride: true },
        )
      } catch (err) {
        logger.warn({
          message: 'reconcileLocationBusinessDay: location.patch fehlgeschlagen',
          event: 'sync.bootstrap.business_day_reconcile_failed',
          tenantId,
          locationId: day.locationId,
          businessDayId: day._id,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }
    logger.info({
      message: 'BusinessDay-Reconcile abgeschlossen',
      event: 'sync.bootstrap.business_day_reconcile_done',
      tenantId,
      reconciledCount: newestPerLocation.size,
      openDayCount: items.length,
    })
  } catch (err) {
    // Fail-open — Reconcile-Fehler darf den Bootstrap nicht knallen lassen.
    logger.warn({
      message: 'reconcileLocationBusinessDay fehlgeschlagen',
      event: 'sync.bootstrap.business_day_reconcile_error',
      tenantId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

const runPullCloudToEdge = async (
  app: Application,
  connection: CloudConnection,
  bootstrapReportId: string | null,
): Promise<void> => {
  const truncateFailed = await truncateMasterTables(app, connection.tenantId!)
  const cloudToken = requireDecryptedToken(connection)
  // PULL_ONLY_MASTER_SERVICES zuerst: tenants ist die Wurzel-Entitaet (kein
  // FK auf andere Tabellen, aber semantisch vor allem anderen).
  for (const service of [...PULL_ONLY_MASTER_SERVICES, ...MASTER_DATA_SERVICES]) {
    const startedAt = new Date().toISOString()
    const startMs = performance.now()
    try {
      const total = await pullAllPagesForService(
        connection.cloudUrl,
        cloudToken,
        app,
        service,
        PULL_ONLY_MASTER_SERVICES.includes(service) || truncateFailed.has(service) ? 'upsert' : 'insert',
      )
      await recordSyncRun(app, {
        tenantId: connection.tenantId!,
        phase: SyncRunPhase.BOOTSTRAP,
        direction: SyncRunDirection.CLOUD_TO_EDGE,
        service,
        recordCount: total,
        durationMs: Math.round(performance.now() - startMs),
        outcome: SyncRunOutcome.SUCCESS,
        triggeredBy: SyncRunTrigger.BOOTSTRAP,
        startedAt,
        ...(bootstrapReportId ? { bootstrapReportId } : {}),
      })
    } catch (err) {
      await recordSyncRun(app, {
        tenantId: connection.tenantId!,
        phase: SyncRunPhase.BOOTSTRAP,
        direction: SyncRunDirection.CLOUD_TO_EDGE,
        service,
        recordCount: 0,
        durationMs: Math.round(performance.now() - startMs),
        outcome: SyncRunOutcome.FAILURE,
        errorMessage: err instanceof Error ? err.message : String(err),
        triggeredBy: SyncRunTrigger.BOOTSTRAP,
        startedAt,
        ...(bootstrapReportId ? { bootstrapReportId } : {}),
      })
      throw err
    }
  }
  // Nach Master-Pull-Loop: BusinessDay-Replica ist in SQLite, aber der
  // POS-Order-Hook liest `location.currentBusinessDay`. Reconcile setzt den
  // Pointer auf den offenen Tag — sonst blockt der naechste Order-Versuch.
  await reconcileLocationBusinessDay(app, connection.tenantId!)
}

const runMergeByExternalId = async (
  app: Application,
  connection: CloudConnection,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _bootstrapReportId: string | null,
): Promise<void> => {
  const cloudToken = requireDecryptedToken(connection)
  for (const service of MERGE_BY_EXTERNAL_ID_SERVICES) {
    const cloudPage = await pullMasterDataPage(
      connection.cloudUrl,
      cloudToken,
      service,
      undefined,
      undefined,
      BOOTSTRAP_TIMEOUT_MS,
    )
    const cloudRecords = cloudPage.records
    const edgeRecords = await collectAllRecords(app, service, connection.tenantId!)

    const cloudByExternal = new Map<string, any>()
    for (const cloud of cloudRecords) {
      const ext = (cloud.record as any)?.externalId
      if (typeof ext === 'string') cloudByExternal.set(ext, cloud)
    }

    const conflicts: any[] = []
    for (const edge of edgeRecords as any[]) {
      const ext = edge.externalId
      if (typeof ext !== 'string') {
        // cloudRecordId/createdAt/updatedAt bewusst weggelassen: das strikte
        // syncConflictDataSchema erlaubt fuer cloudRecordId nur String (kein
        // null — Feld fehlt = „kein Cloud-Pendant"), die Timestamps stempelt
        // der Data-Resolver serverseitig.
        conflicts.push({
          _id: uuidv7(),
          tenantId: connection.tenantId!,
          locationId: connection.locationId ?? null,
          service,
          edgeRecordId: edge._id,
          reason: 'external-id-missing',
          edgePayload: edge,
          cloudPayload: null,
          status: 'open',
        })
        continue
      }
      const match = cloudByExternal.get(ext)
      if (!match) {
        // Edge-Record landet im Bootstrap-Push (separater Lauf nach Merge)
        continue
      }
      const cloudRecord = match.record as any
      if (cloudRecord._id !== edge._id) {
        // ID-Restamping: Edge-Record-ID auf Cloud-ID umstellen.
        try {
          await app.service(service as any).remove(edge._id, { provider: undefined } as any)
          await app
            .service(service as any)
            .create({ ...cloudRecord, tenantId: connection.tenantId! }, { provider: undefined } as any)
        } catch (err) {
          logger.warn({
            message: 'Merge-Restamping fehlgeschlagen',
            event: 'sync.merge.restamp_failed',
            service,
            entityId: edge._id,
            errorMessage: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    for (const conflict of conflicts) {
      await app.service('sync-conflicts' as any).create(conflict, { provider: undefined } as any)
    }
  }
}

/**
 * Beim Edge-Boot aufrufen: findet alle Cloud-Connections mit
 * `bootstrapStatus = in-progress` und resumed sie. Wird vom main.ts beim
 * Service-Setup eingehaengt, damit ein abgebrochener Bootstrap nach
 * Container-Restart automatisch fortgesetzt wird.
 *
 * Idempotent: Wenn der Bootstrap bereits abgeschlossen war, findet die Loop
 * keine Datensaetze und tut nichts.
 */
export const resumePendingBootstraps = async (app: Application): Promise<void> => {
  try {
    const result = await (app.service(cloudConnectionPath) as any).find({
      provider: undefined,
      paginate: false,
      // `paginate: false` schaltet die Pagination ab — kein `$limit: -1` nötig
      // (das wuerde sonst vom AJV-Query-Validator als negative Integer abgelehnt).
      query: { bootstrapStatus: 'in-progress', pairingStatus: 'connected' },
    })
    const list = Array.isArray(result) ? result : []
    if (list.length === 0) return
    logger.info({
      message: `Bootstrap-Resume: ${list.length} Datensatz(e) werden fortgesetzt`,
      event: 'sync.bootstrap.resume',
    })
    for (const conn of list) {
      void runBootstrap(app, conn._id).catch(err => {
        logger.error({
          message: 'Bootstrap-Resume fehlgeschlagen',
          event: 'sync.bootstrap.resume_failed',
          cloudConnectionId: conn._id,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      })
    }
  } catch (err) {
    logger.warn({
      message: 'Bootstrap-Resume-Lookup fehlgeschlagen',
      event: 'sync.bootstrap.resume_lookup_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

export const runBootstrap = async (app: Application, cloudConnectionId: string): Promise<void> => {
  const service = app.service(cloudConnectionPath) as any
  // WICHTIG: `service.get(...)` statt `_get` — die Adapter-Method `_get` umgeht
  // alle Hooks, inkl. dem JSON-Parse-Hook fuer `preflightSnapshot`. Ohne diesen
  // Parse-Schritt bekommt der Worker das Snapshot-Feld als JSON-String, und
  // `connection.preflightSnapshot.cloudTenantId` ergibt dann `undefined` —
  // der gesamte Restamp-Trigger feuert nicht.
  const connection: CloudConnection = await service.get(cloudConnectionId, { provider: undefined })
  if (!connection.preflightSnapshot) {
    await persistStatus(app, cloudConnectionId, {
      bootstrapStatus: BootstrapStatus.FAILED,
      bootstrapError: 'Preflight-Snapshot fehlt.',
    })
    return
  }
  if (!connection.initialDirection) {
    await persistStatus(app, cloudConnectionId, {
      bootstrapStatus: BootstrapStatus.FAILED,
      bootstrapError: 'initialDirection fehlt.',
    })
    return
  }

  await persistStatus(app, cloudConnectionId, {
    bootstrapStatus: BootstrapStatus.IN_PROGRESS,
    bootstrapStartedAt: connection.bootstrapStartedAt ?? new Date().toISOString(),
    bootstrapError: null as any,
  })

  // Bootstrap-Report anlegen (Phase 0). Pre-State wird hier erfasst — vor
  // Restamp + Push/Pull. Falls der Helper fehlschlaegt (DB nicht erreichbar
  // etc.), liefert er null zurueck — der Bootstrap laeuft trotzdem weiter,
  // nur ohne Report-Persistenz.
  //
  // WICHTIG: Wir verwenden die `cloudTenantId` (Ziel-Tenant nach Restamp),
  // NICHT die `edgeTenantId` (alte Edge-Tenant vor Restamp). Grund: nach dem
  // Restamp hat der eingeloggte User-JWT die Cloud-tenantId. Der
  // multiTenancy-Hook beim `find('bootstrap-reports')` filtert auf
  // `query.tenantId = user.tenantId`. Mit der alten Edge-tenantId wuerde der
  // Report im UI unsichtbar bleiben. Die historische Edge-tenantId bleibt im
  // `identity.edgeTenantIdBefore`-Feld dokumentiert — kein Informationsverlust.
  // Plus: bootstrap-reports ist in RESTAMP_SKIP_TABLES, der Eintrag wird also
  // nicht nachtraeglich umgestempelt — die initiale Cloud-tenantId bleibt.
  const preState = await captureState(app)
  const reportId = await createReport(app, {
    cloudConnectionId,
    tenantId: connection.preflightSnapshot.cloudTenantId,
    direction: connection.initialDirection as BootstrapReportDirection,
    identity: {
      edgeTenantIdBefore: connection.preflightSnapshot.edgeTenantId ?? null,
      cloudTenantId: connection.preflightSnapshot.cloudTenantId,
      edgeLocationIdBefore: connection.preflightSnapshot.edgeLocationId ?? null,
      cloudLocationId: connection.preflightSnapshot.cloudLocationId ?? null,
    },
    preState,
  })

  try {
    let alreadyBackedUp = false
    // applyCloudTenantId stempelt sowohl tenantId als auch locationId — der
    // Trigger feuert daher bei einem Mismatch in EINEM der beiden Felder. Bei
    // "neuer Standort"-Pairing legt die Cloud eine frische locationId an, die
    // immer von der lokalen Edge-Location abweicht; bei "bestehender Standort"
    // weicht sie ab, sobald Cloud-Admin eine andere als die lokale Edge-Location
    // zugewiesen hat.
    const requiresIdentityRestamp =
      connection.preflightSnapshot.requiresTenantIdRestamp || connection.preflightSnapshot.requiresLocationIdRestamp
    if (requiresIdentityRestamp) {
      // WICHTIG: oldTenantId/oldLocationId aus dem preflightSnapshot lesen,
      // NICHT aus `connection.tenantId/locationId`. `connection.locationId`
      // wird im initialen upsertData nicht gesetzt (bleibt leer), und
      // `connection.tenantId` kann durch den multiTenancy-Hook bereits einen
      // anderen Wert haben als die echte alte Edge-tenantId. Der Snapshot ist
      // die einzige verlaessliche Quelle fuer den "vor-Restamp"-Zustand.
      const restampStartMs = performance.now()
      const result = await applyCloudTenantId(app, {
        oldTenantId: connection.preflightSnapshot.edgeTenantId ?? null,
        newTenantId: connection.preflightSnapshot.cloudTenantId,
        oldLocationId: connection.preflightSnapshot.edgeLocationId ?? null,
        newLocationId: connection.preflightSnapshot.cloudLocationId ?? null,
      })
      await persistStatus(app, cloudConnectionId, {
        tenantIdRestampedAt: new Date().toISOString(),
        preTenantIdRestampBackupPath: result.backupPath ?? undefined,
      })
      if (result.backupPath) alreadyBackedUp = true
      // Connection-Datensatz selbst auch umstamping (separat, weil multi-tenant)
      await service._patch(cloudConnectionId, {
        tenantId: connection.preflightSnapshot.cloudTenantId,
        locationId: connection.preflightSnapshot.cloudLocationId ?? null,
      })
      await updateReport(app, reportId, {
        restamp: {
          skipped: false,
          locationsTableUpdated: result.affectedTables.includes('locations'),
          affectedTables: result.affectedTables,
          updatedRowsTotal: result.updatedRows,
          backupPath: result.backupPath ?? undefined,
          durationMs: Math.round(performance.now() - restampStartMs),
        },
      })
    } else {
      await updateReport(app, reportId, {
        restamp: {
          skipped: true,
          reason: 'no-restamp-required (edge IDs == cloud IDs)',
          locationsTableUpdated: false,
          affectedTables: [],
          updatedRowsTotal: 0,
          durationMs: 0,
        },
      })
    }

    // Auto-Backup vor destruktiven Bootstrap-Modi (Pull/Merge), falls
    // applyCloudTenantId nicht bereits ein Backup angelegt hat. Schuetzt vor
    // versehentlichem Datenverlust — User kann via .pre-pairing-<ts>.bak die
    // Edge-Daten wiederherstellen.
    const isDestructive =
      connection.initialDirection === InitialSyncDirection.PULL_CLOUD_TO_EDGE ||
      connection.initialDirection === InitialSyncDirection.MERGE_BY_EXTERNAL_ID
    if (isDestructive && !alreadyBackedUp) {
      const backupPath = await createPrePairingBackup(app)
      if (backupPath) {
        await persistStatus(app, cloudConnectionId, {
          preTenantIdRestampBackupPath: backupPath,
        })
        logger.info({
          message: 'DB-Backup vor destruktivem Bootstrap angelegt',
          event: 'sync.bootstrap.backup_created',
          cloudConnectionId,
          direction: connection.initialDirection,
          backupPath,
        })
      }
    }

    // Auch hier .get() statt ._get() — siehe Hinweis oben (JSON-Hooks).
    const refreshed: CloudConnection = await service.get(cloudConnectionId, { provider: undefined })

    switch (connection.initialDirection) {
      case InitialSyncDirection.BOOTSTRAP_EDGE_TO_CLOUD:
        await runBootstrapEdgeToCloud(app, refreshed, reportId)
        break
      case InitialSyncDirection.PULL_CLOUD_TO_EDGE:
        await runPullCloudToEdge(app, refreshed, reportId)
        break
      case InitialSyncDirection.MERGE_BY_EXTERNAL_ID:
        await runMergeByExternalId(app, refreshed, reportId)
        await runBootstrapEdgeToCloud(app, refreshed, reportId)
        break
    }

    // `lastSyncAt` gehoert hier mit hinein: der Bootstrap IST der erste
    // Datenabgleich und schreibt eigene `sync-runs`-Eintraege. Frueher war das
    // egal, weil der Heartbeat das Feld binnen Sekunden mit-stempelte — seit
    // der Trennung von Abgleich und Erreichbarkeit (ADR 0017) taete das
    // niemand mehr. Ein frisch gepairter Edge im Modus `scheduled` haette sonst
    // bis zum ersten Slot „Noch nicht abgeglichen" angezeigt, obwohl gerade der
    // komplette Datenbestand uebertragen wurde.
    await persistStatus(app, cloudConnectionId, {
      bootstrapStatus: BootstrapStatus.DONE,
      bootstrapCompletedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      pairingStatus: PairingStatus.CONNECTED,
    })

    // Phase 3 — Konsistenz-Check, Post-State, Sync-Run-IDs einsammeln, Report
    // finalisieren + JSON-Datei dumpen. Auch bei "alles gut" wichtig: der
    // ConsistencyCheck zeigt beim NAECHSTEN Pairing als Diagnose-Quelle, ob
    // der DB-Zustand am Ende sauber war.
    const postState = await captureState(app)
    const consistencyCheck = await runConsistencyCheck(
      app,
      connection.preflightSnapshot.cloudTenantId,
      connection.preflightSnapshot.cloudLocationId ?? null,
    )
    const syncRunIds = await collectSyncRunIds(app, reportId)
    await finalizeReport(app, reportId, {
      status: BootstrapReportStatus.DONE,
      postState,
      consistencyCheck,
      syncRunIds,
    })
    await dumpToFile(app, reportId)

    logger.info({
      message: 'Bootstrap erfolgreich abgeschlossen',
      event: 'sync.bootstrap.done',
      cloudConnectionId,
      direction: connection.initialDirection,
      reportId,
      isHealthy: consistencyCheck?.isHealthy,
    })
  } catch (err) {
    logger.error({
      message: 'Bootstrap fehlgeschlagen',
      event: 'sync.bootstrap.failed',
      cloudConnectionId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    // Report finalisieren und Datei dumpen — auch im Fehlerfall, gerade dann
    // ist die persistente Diagnose wichtig.
    const postState = await captureState(app).catch(() => undefined)
    const consistencyCheck = connection.preflightSnapshot
      ? await runConsistencyCheck(
          app,
          connection.preflightSnapshot.cloudTenantId,
          connection.preflightSnapshot.cloudLocationId ?? null,
        ).catch(() => undefined)
      : undefined
    const syncRunIds = await collectSyncRunIds(app, reportId)
    await finalizeReport(app, reportId, {
      status: BootstrapReportStatus.FAILED,
      errorMessage: err instanceof Error ? err.message : String(err),
      postState,
      consistencyCheck,
      syncRunIds,
    })
    await dumpToFile(app, reportId)
    await persistStatus(app, cloudConnectionId, {
      bootstrapStatus: BootstrapStatus.FAILED,
      bootstrapError: err instanceof Error ? err.message : String(err),
    })
  }
}
