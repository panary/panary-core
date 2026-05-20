// Helper-Funktionen fuer den Bootstrap-Report-Lebenszyklus.
//
// Eingangsweise (vom Bootstrap-Worker):
//   1. createReport(...) → reportId, status=in-progress, mit preState
//   2. updateReport(reportId, { restamp: ... })
//   3. updateReport(reportId, { postState, consistencyCheck, ... })
//   4. finalizeReport(reportId, status=done|failed) + dumpToFile(reportId)
//
// Fehler im Helper brechen den Bootstrap-Worker NICHT ab — der Report ist
// Diagnose, kein kritischer Pfad. Logger schreibt eine Warnung.

import fs from 'node:fs'
import path from 'node:path'

import { uuidv7 } from 'uuidv7'

import { logger } from '@panary/shared-backend'
import {
  type BootstrapReport,
  BootstrapReportStatus,
  type BootstrapReportDirection,
} from '@panary/cloud-connection/domain'

import type { Application } from '../../declarations'
import { bootstrapReportsPath } from './bootstrap-reports'

const MASTER_TABLES = [
  'locations',
  'users',
  'products',
  'product-groups',
  'customers',
  'corporate-customers',
  'orders',
  'order-interactions',
  'working-times',
  'apikeys',
  'devices',
  'pre-orders',
  'opening-hour-exceptions',
]

interface CreateReportInput {
  cloudConnectionId: string
  tenantId: string | null
  direction: BootstrapReportDirection
  identity: BootstrapReport['identity']
  preState: BootstrapReport['preState']
}

/**
 * Erfasst einen Pre/Post-State-Snapshot der Edge-DB:
 * - alle locations-Eintraege (mit _id und tenantId)
 * - row-counts pro Master-Tabelle
 *
 * Verwendet direkten knex-Zugriff, um Hook-Pipelines zu umgehen — die
 * Diagnose-Daten muessen den ROHEN DB-State zeigen, nicht den durch Resolver
 * gefilterten Wert.
 */
export const captureState = async (
  app: Application,
): Promise<{ locations: Array<{ _id: string; tenantId: string }>; counts: Record<string, number> }> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = app.get('sqliteClient') as any
  if (!knex) return { locations: [], counts: {} }

  const counts: Record<string, number> = {}
  for (const table of MASTER_TABLES) {
    try {
      const row = await knex(table).count('* as cnt').first()
      counts[table] = Number(row?.cnt ?? 0)
    } catch {
      // Tabelle existiert ggf. noch nicht → 0
      counts[table] = 0
    }
  }

  let locations: Array<{ _id: string; tenantId: string }> = []
  try {
    locations = await knex('locations').select('_id', 'tenantId')
  } catch {
    // ignore
  }

  return { locations, counts }
}

/**
 * Konsistenz-Check. Wird am Ende des Bootstraps aufgerufen und prueft die
 * vier kritischen Invarianten:
 *
 *   1. Ghost-Locations: User mit activeLocationId, die nicht in locations
 *      existiert → fataler Drift, User wird im UI nicht sichtbar.
 *   2. Tenant-ID-Mismatch: Records mit tenantId != cloudTenantId → Restamp
 *      lief nicht.
 *   3. Location-ID-Mismatch: Records mit locationId != cloudLocationId.
 *   4. cloud-connection.locationId muss == cloudLocationId sein.
 */
export const runConsistencyCheck = async (
  app: Application,
  cloudTenantId: string,
  cloudLocationId: string | null,
): Promise<BootstrapReport['consistencyCheck']> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = app.get('sqliteClient') as any
  if (!knex) {
    return {
      isHealthy: true,
      ghostLocations: [],
      tenantIdMismatchCount: 0,
      locationIdMismatchCount: 0,
      issues: [{ severity: 'WARN', message: 'Kein sqliteClient verfuegbar' }],
    }
  }

  const issues: Array<{ severity: 'WARN' | 'ERROR'; message: string }> = []

  // (1) Ghost-Locations
  let ghostLocations: string[] = []
  try {
    const userLocs = (await knex('users')
      .distinct('activeLocationId')
      .whereNotNull('activeLocationId')) as Array<{ activeLocationId?: string }>
    const knownLocs = new Set(
      ((await knex('locations').select('_id')) as Array<{ _id: string }>).map(r => r._id),
    )
    ghostLocations = userLocs
      .map(r => r.activeLocationId!)
      .filter(id => id && !knownLocs.has(id))
    if (ghostLocations.length > 0) {
      issues.push({
        severity: 'ERROR',
        message: `${ghostLocations.length} Ghost-Location(s) — User mit activeLocationId ohne passenden locations._id-Eintrag.`,
      })
    }
  } catch (err) {
    issues.push({
      severity: 'WARN',
      message: `Ghost-Location-Check fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  // (2) tenantId-Mismatch
  let tenantIdMismatchCount = 0
  for (const table of ['products', 'product-groups', 'customers', 'corporate-customers', 'users']) {
    try {
      const row = await knex(table)
        .where('tenantId', '!=', cloudTenantId)
        .count('* as cnt')
        .first()
      const cnt = Number(row?.cnt ?? 0)
      tenantIdMismatchCount += cnt
      if (cnt > 0) {
        issues.push({
          severity: 'ERROR',
          message: `Tabelle '${table}': ${cnt} Records haben tenantId != cloudTenantId.`,
        })
      }
    } catch {
      // ignore
    }
  }

  // (3) locationId-Mismatch
  let locationIdMismatchCount = 0
  if (cloudLocationId) {
    for (const table of ['products', 'product-groups']) {
      try {
        const row = await knex(table)
          .where('locationId', '!=', cloudLocationId)
          .count('* as cnt')
          .first()
        const cnt = Number(row?.cnt ?? 0)
        locationIdMismatchCount += cnt
        if (cnt > 0) {
          issues.push({
            severity: 'ERROR',
            message: `Tabelle '${table}': ${cnt} Records haben locationId != cloudLocationId.`,
          })
        }
      } catch {
        // ignore
      }
    }
  }

  // (4) cloud-connection.locationId muss == cloudLocationId
  try {
    const conn = (await knex('cloud-connection')
      .select('locationId')
      .first()) as { locationId?: string } | undefined
    if (cloudLocationId && conn?.locationId !== cloudLocationId) {
      issues.push({
        severity: 'WARN',
        message: `cloud-connection.locationId='${conn?.locationId ?? ''}' weicht von cloudLocationId='${cloudLocationId}' ab.`,
      })
    }
  } catch {
    // ignore
  }

  const isHealthy = issues.every(i => i.severity !== 'ERROR')
  return {
    isHealthy,
    ghostLocations,
    tenantIdMismatchCount,
    locationIdMismatchCount,
    issues,
  }
}

export const createReport = async (
  app: Application,
  input: CreateReportInput,
): Promise<string | null> => {
  const id = uuidv7()
  const now = new Date().toISOString()
  const payload = {
    _id: id,
    cloudConnectionId: input.cloudConnectionId,
    tenantId: input.tenantId,
    startedAt: now,
    status: BootstrapReportStatus.IN_PROGRESS,
    direction: input.direction,
    identity: input.identity,
    preState: input.preState,
    syncRunIds: [],
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app.service(bootstrapReportsPath) as any).create(payload, { provider: undefined })
    return id
  } catch (err) {
    // AJV-Detail-Extraction — Feathers BadRequest packt das AJV-Array
    // typischerweise unter `.data` (alte Builds: `.errors`).
    const errAny = err as {
      data?: Array<{ instancePath?: string; message?: string; params?: unknown; keyword?: string }>
      errors?: Array<{ instancePath?: string; message?: string; params?: unknown; keyword?: string }>
    }
    const ajvErrors =
      Array.isArray(errAny?.data) ? errAny.data
      : Array.isArray(errAny?.errors) ? errAny.errors
      : undefined
    const validationErrors = ajvErrors?.map(e => ({
      path: e.instancePath || '<root>',
      keyword: e.keyword,
      message: e.message ?? '?',
      params: e.params,
    }))
    logger.warn({
      message: 'Bootstrap-Report konnte nicht angelegt werden',
      event: 'sync.bootstrap.report.create_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      validationErrors,
      // Payload-Schluessel + Typen mitloggen, damit man im Debug-Log sieht,
      // welche Felder wir geschickt haben (Werte selbst koennen sensitiv sein).
      payloadShape: {
        _id: typeof payload._id,
        cloudConnectionId: typeof payload.cloudConnectionId,
        tenantId: payload.tenantId === null ? 'null' : typeof payload.tenantId,
        status: payload.status,
        direction: payload.direction,
        identityKeys: Object.keys(payload.identity ?? {}),
        preStateKeys: Object.keys(payload.preState ?? {}),
        preStateLocationsCount: Array.isArray(payload.preState?.locations) ? payload.preState.locations.length : 'not-array',
        preStateCountsKeys: Object.keys(payload.preState?.counts ?? {}),
      },
    })
    return null
  }
}

export const updateReport = async (
  app: Application,
  reportId: string | null,
  patch: Partial<BootstrapReport>,
): Promise<void> => {
  if (!reportId) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app.service(bootstrapReportsPath) as any).patch(
      reportId,
      { ...patch, updatedAt: new Date().toISOString() },
      { provider: undefined },
    )
  } catch (err) {
    logger.warn({
      message: 'Bootstrap-Report-Update fehlgeschlagen',
      event: 'sync.bootstrap.report.update_failed',
      reportId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Sammelt alle sync-runs, die diesem Bootstrap-Report zugeordnet sind
 * (markiert beim Schreiben via recordSyncRun-Helper mit `bootstrapReportId`).
 */
export const collectSyncRunIds = async (
  app: Application,
  reportId: string | null,
): Promise<string[]> => {
  if (!reportId) return []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await (app.service('sync-runs' as any) as any).find({
      provider: undefined,
      paginate: false,
      query: { bootstrapReportId: reportId, $select: ['_id'] },
    })) as Array<{ _id: string }> | unknown
    const list = Array.isArray(result) ? (result as Array<{ _id: string }>) : []
    return list.map(r => r._id)
  } catch (err) {
    // Frueher wurde der Fehler stillschweigend zu [] geschluckt — wenn z.B.
    // bootstrapReportId aus syncRunQueryProperties fehlt, blockt AJV mit 400
    // und der Report-JSON-Dump bekommt syncRunIds: []. Mindestens loggen,
    // damit die Diagnose nicht stumm verloren geht.
    logger.warn({
      message: 'collectSyncRunIds fehlgeschlagen — Report bekommt leere syncRunIds',
      event: 'sync.bootstrap.report.collect_sync_runs_failed',
      reportId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

const sanitizeForFilename = (s: string): string => s.replace(/[^a-zA-Z0-9-]/g, '-')

const resolveDataDir = (app: Application): string => {
  // SQLite-Pfad-Config wird auch fuer den dataDir-Stamm genutzt — gleiche
  // Konvention wie createPrePairingBackup in apply-cloud-tenant-id.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = app.get('sqlite') as any
  const conn = cfg?.connection
  let filename: string | undefined
  if (typeof conn === 'string') filename = conn
  else if (typeof conn === 'object' && typeof conn?.filename === 'string') filename = conn.filename
  if (filename) return path.dirname(path.resolve(filename))
  return path.resolve(process.cwd(), 'data')
}

/**
 * Schreibt den fertigen Report als JSON-Datei in
 * `<dataDir>/bootstrap-reports/<startedAt>-<reportId>.json`. Datei bleibt
 * persistent — kein Auto-Cleanup. Der Pfad wird in `report.jsonExportPath`
 * vermerkt, damit die UI den Download-Link bauen kann.
 */
export const dumpToFile = async (
  app: Application,
  reportId: string | null,
): Promise<void> => {
  if (!reportId) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = (await (app.service(bootstrapReportsPath) as any).get(reportId, {
      provider: undefined,
    })) as BootstrapReport
    const baseDir = path.join(resolveDataDir(app), 'bootstrap-reports')
    fs.mkdirSync(baseDir, { recursive: true })
    const stamp = sanitizeForFilename(report.startedAt)
    const filename = `${stamp}-${report._id}.json`
    const fullPath = path.join(baseDir, filename)
    fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf-8')
    // Pfad relativ speichern (portabler beim Datei-Download)
    const relPath = path.relative(resolveDataDir(app), fullPath)
    await updateReport(app, reportId, { jsonExportPath: relPath } as Partial<BootstrapReport>)
    logger.info({
      message: 'Bootstrap-Report als JSON-Datei exportiert',
      event: 'sync.bootstrap.report.dumped',
      reportId,
      path: fullPath,
    })
  } catch (err) {
    logger.warn({
      message: 'Bootstrap-Report-File-Export fehlgeschlagen',
      event: 'sync.bootstrap.report.dump_failed',
      reportId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

export const finalizeReport = async (
  app: Application,
  reportId: string | null,
  patch: Partial<BootstrapReport>,
): Promise<void> => {
  if (!reportId) return
  await updateReport(app, reportId, {
    ...patch,
    completedAt: new Date().toISOString(),
  } as Partial<BootstrapReport>)
}
