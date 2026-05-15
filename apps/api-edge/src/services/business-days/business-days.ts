// Edge-Service: BusinessDay-Lifecycle (open/close).
//
// Verantwortung des Edge:
//   - Tageseröffnung lokal in SQLite anlegen (offline-first)
//   - Validation vor Close: alle sync-outbox-Einträge für diesen Tag synced?
//   - Closing-Trigger an die Cloud — die Aggregations-Pipeline läuft dort.
//   - Status-Updates kommen via Sync-Pull zurück (cloud schreibt closedAt +
//     reportId in das business-day-Dokument, Edge synct das beim nächsten Pull).
//
// Live-Streaming des Aggregations-Fortschritts läuft direkt zwischen
// Cloud-Service `business-day-reports` und dem POS-Client via Cloud-WebSocket
// (POS hat eigene Cloud-Connection für Echtzeit-Events). Der Edge spielt
// hier NICHT die Vermittler-Rolle — das wäre über fetch-only-HTTP
// komplexer als nötig.

import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { BadRequest, NotFound } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'

import {
  BusinessDayStatus,
  BusinessDayOperationMode,
} from '@panary-core/businessdays/domain'
import { LocationOperationMode } from '@panary-core/locations/domain'
import { authorize, multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import { ensureIndexes, logger } from '@panary-core/shared-backend'

import {
  businessDayDataResolver,
  businessDayDataValidator,
  businessDayExternalResolver,
  businessDayPatchResolver,
  businessDayPatchValidator,
  businessDayQueryResolver,
  businessDayQueryValidator,
  businessDayResolver,
} from './business-days.schema'
import type {
  BusinessDay,
  BusinessDayService,
  CloseDayData,
  OpenDayData,
  RefreshClosingStatusData,
} from './business-days.class'

import type { Application } from '../../declarations'

export const businessDaysPath = 'businessdays'           // bestehender Tabellen-/Service-Pfad
export const businessDaysMethods = [
  'find',
  'get',
  'create',
  'patch',
  'remove',
  'openDay',
  'closeDay',
  'refreshClosingStatus',
] as const

export * from './business-days.schema'

interface OpenDayParams {
  user?: { _id?: string; tenantId?: string; locationId?: string | null }
  provider?: string
}

/**
 * Eroeffnet einen neuen Geschaeftstag.
 * Validierungen:
 *   - kein offener Tag an derselben Location
 *   - locationId vom User oder Payload
 *   - operationMode wird aus Location.operationMode kopiert (Snapshot)
 */
async function openDay(app: Application, data: OpenDayData, params: OpenDayParams = {}): Promise<BusinessDay> {
  const user = params.user
  if (!user?.tenantId) throw new BadRequest('Tenant-Kontext fehlt — openDay benötigt einen authentifizierten User')

  const locationId = data.locationId ?? user.locationId ?? null
  if (!locationId) {
    throw new BadRequest('locationId muss am User oder im Payload gesetzt sein')
  }

  // Bestehende offene Tage prüfen
  const existing = await (app.service(businessDaysPath) as any).find({
    query: { tenantId: user.tenantId, locationId, status: BusinessDayStatus.OPEN, $limit: 1 },
    provider: undefined,
  })
  const items = Array.isArray(existing) ? existing : existing?.data ?? []
  if (items.length > 0) {
    throw new BadRequest(`Es ist bereits ein Geschaeftstag fuer Location ${locationId} offen`)
  }

  // operationMode aus Location laden
  let operationMode: 'orders-only' | 'pos-cashier' = BusinessDayOperationMode.POS_CASHIER
  try {
    const location = await (app.service('locations') as any).get(locationId, { provider: undefined })
    const mode = (location as { operationMode?: string } | undefined)?.operationMode
    if (mode === LocationOperationMode.ORDERS_ONLY) operationMode = BusinessDayOperationMode.ORDERS_ONLY
  } catch (err) {
    logger.warn({
      message: 'openDay: Location nicht ladbar, fallback auf pos-cashier',
      event: 'business_day.open_fallback',
      locationId,
      error: (err as Error).message,
    })
  }

  const today = data.date ?? new Date().toISOString().slice(0, 10)

  const created = await (app.service(businessDaysPath) as any).create(
    {
      _id: uuidv7(),
      tenantId: user.tenantId,
      locationId,
      date: today,
      openedBy: user._id ?? 'unknown',
      operationMode,
      openingFloatCents: data.openingFloatCents,
    },
    { provider: undefined },
  )

  logger.info({
    message: 'business-day.opened',
    event: 'business_day.opened',
    tenantId: user.tenantId,
    locationId,
    businessDayId: (created as { _id?: string })._id,
    operationMode,
    openingFloatCents: data.openingFloatCents,
  })
  return created as BusinessDay
}

/**
 * Schliesst einen Geschaeftstag.
 *
 * Ablauf:
 *  1. businessDay laden, status pruefen
 *  2. Pending sync-outbox-Eintraege fuer den Tag pruefen — Hard-Block falls
 *     noch unsynchrone Daten existieren (sonst wuerde der Cloud-Report
 *     unvollstaendige Zahlen aggregieren)
 *  3. status auf 'closing-requested' setzen
 *  4. Cloud-Trigger: business-day-reports.startClosing aufrufen (HTTP)
 *  5. Sofort returnen — der Cloud-Report kommt asynchron via Sync-Pull
 */
async function closeDay(
  app: Application,
  data: CloseDayData,
  params: OpenDayParams = {},
): Promise<BusinessDay> {
  const user = params.user
  if (!user?.tenantId) throw new BadRequest('Tenant-Kontext fehlt — closeDay benötigt einen authentifizierten User')
  if (!data.businessDayId) throw new BadRequest('businessDayId ist Pflicht')

  const businessDay = (await (app.service(businessDaysPath) as any).get(data.businessDayId, {
    provider: undefined,
  })) as BusinessDay | undefined
  if (!businessDay) throw new NotFound('Geschaeftstag nicht gefunden')
  if (businessDay.tenantId !== user.tenantId) throw new BadRequest('Tenant-Mismatch')
  if (businessDay.status !== BusinessDayStatus.OPEN) {
    throw new BadRequest(`Tag ist nicht offen (Status: ${businessDay.status})`)
  }
  if (businessDay.operationMode === BusinessDayOperationMode.POS_CASHIER) {
    if (data.countedClosingFloatCents === undefined) {
      throw new BadRequest('countedClosingFloatCents ist Pflicht im pos-cashier-Modus')
    }
  }

  // Pending Sync-Outbox-Eintraege?
  const outboxPending = await (app.service('sync-outbox') as any)
    .find({
      query: {
        tenantId: user.tenantId,
        status: 'pending',
        $limit: 0,
      },
      provider: undefined,
    })
    .catch(() => ({ total: 0 }))
  const pendingTotal = (outboxPending as { total?: number })?.total ?? 0
  if (pendingTotal > 0) {
    throw new BadRequest(
      `Sync-Outbox enthaelt noch ${pendingTotal} unsynchrone Aenderungen — bitte Edge synchronisieren lassen, bevor der Tag geschlossen wird`,
    )
  }

  // Status setzen
  const patched = (await (app.service(businessDaysPath) as any).patch(
    data.businessDayId,
    {
      status: BusinessDayStatus.CLOSING_REQUESTED,
      closedBy: user._id ?? 'unknown',
      closedAt: new Date().toISOString(),
      countedClosingFloatCents: data.countedClosingFloatCents,
      reportErrorMessage: null,
      updatedAt: new Date().toISOString(),
    },
    { provider: undefined },
  )) as BusinessDay

  logger.info({
    message: 'business-day.close_requested',
    event: 'business_day.close_requested',
    tenantId: user.tenantId,
    locationId: businessDay.locationId,
    businessDayId: data.businessDayId,
    operationMode: businessDay.operationMode,
  })

  // Cloud-Trigger: business-day-reports.startClosing
  // Best-effort: bei Fehler bleibt der Tag in 'closing-requested' und kann
  // manuell erneut getriggert werden.
  try {
    await triggerCloudClosing(app, {
      tenantId: user.tenantId,
      locationId: businessDay.locationId,
      businessDayId: businessDay._id,
      businessDate: businessDay.date,
      operationMode: businessDay.operationMode,
      countedClosingFloatCents: data.countedClosingFloatCents,
      cashDropsCents: data.cashDropsCents,
      payoutsCents: data.payoutsCents,
      openingFloatCents: businessDay.openingFloatCents,
      physicalCounts: data.physicalCounts,
    })
  } catch (err) {
    const message = (err as Error).message
    logger.error({
      message: 'business-day.close_trigger_failed',
      event: 'business_day.close_trigger_failed',
      businessDayId: data.businessDayId,
      error: message,
    })
    await (app.service(businessDaysPath) as any).patch(
      data.businessDayId,
      { reportErrorMessage: message, updatedAt: new Date().toISOString() },
      { provider: undefined },
    )
  }

  return patched
}

/**
 * Holt den aktuellen Status des zugehoerigen Cloud-Reports und zieht den
 * Edge-BusinessDay-Status nach.
 *
 * Aufrufbar von POS-UI (Pull-on-Demand, wenn der User den Tagesabschluss-
 * Status sehen will) oder von einem Heartbeat-Worker (Pull-Periodisch).
 *
 * State-Mapping:
 *   Cloud completed → Edge status='closed',  reportId gesetzt
 *   Cloud failed    → Edge status='failed',  reportErrorMessage gesetzt
 *   Cloud audited   → Edge status='audited', reportId gesetzt
 *   Cloud sonst     → keine Aenderung (still aggregating)
 */
async function refreshClosingStatus(
  app: Application,
  data: RefreshClosingStatusData,
  params: OpenDayParams = {},
): Promise<BusinessDay> {
  const user = params.user
  if (!user?.tenantId) throw new BadRequest('Tenant-Kontext fehlt')
  if (!data.businessDayId) throw new BadRequest('businessDayId ist Pflicht')

  const businessDay = (await (app.service(businessDaysPath) as any).get(data.businessDayId, {
    provider: undefined,
  })) as BusinessDay | undefined
  if (!businessDay) throw new NotFound('Geschaeftstag nicht gefunden')
  if (businessDay.tenantId !== user.tenantId) throw new BadRequest('Tenant-Mismatch')

  // Nur sinnvoll im Zwischen-Status — bereits final-Status nicht erneut pullen
  if (
    businessDay.status !== BusinessDayStatus.CLOSING_REQUESTED &&
    businessDay.status !== BusinessDayStatus.CLOSING_AGGREGATING
  ) {
    return businessDay
  }

  const report = await fetchCloudReportForBusinessDay(app, businessDay.tenantId, businessDay._id)
  if (!report) {
    // Cloud ist (noch) nicht erreichbar oder hat noch keinen Report angelegt
    return businessDay
  }

  let nextStatus: string | null = null
  if (report.status === 'completed') nextStatus = BusinessDayStatus.CLOSED
  else if (report.status === 'audited') nextStatus = BusinessDayStatus.AUDITED
  else if (report.status === 'failed') nextStatus = BusinessDayStatus.FAILED
  // pending / aggregating → noch im Zwischen-Status lassen
  else if (report.status === 'aggregating' && businessDay.status === BusinessDayStatus.CLOSING_REQUESTED) {
    nextStatus = BusinessDayStatus.CLOSING_AGGREGATING
  }

  if (!nextStatus) return businessDay

  const patched = (await (app.service(businessDaysPath) as any).patch(
    data.businessDayId,
    {
      status: nextStatus,
      reportId: report._id ?? null,
      reportErrorMessage: report.errorMessage ?? null,
      updatedAt: new Date().toISOString(),
    },
    { provider: undefined },
  )) as BusinessDay

  logger.info({
    message: 'business-day.status_refreshed',
    event: 'business_day.status_refreshed',
    tenantId: user.tenantId,
    businessDayId: data.businessDayId,
    previousStatus: businessDay.status,
    nextStatus,
    reportId: report._id,
  })

  return patched
}

interface CloudReportSnapshot {
  _id?: string
  status?: string
  errorMessage?: string | null
}

/**
 * Fragt die Cloud `business-day-reports`-Liste nach dem zum Edge-BusinessDay
 * gehoerigen Report (via businessDayId). Best-effort: bei Cloud-Ausfall null.
 */
async function fetchCloudReportForBusinessDay(
  app: Application,
  tenantId: string,
  businessDayId: string,
): Promise<CloudReportSnapshot | null> {
  void tenantId // kommt automatisch ueber Token-Auth in der Cloud
  const cloudConnection = await loadCloudConnection(app)
  if (!cloudConnection) return null
  const baseUrl = cloudConnection.cloudUrl
  const token = cloudConnection.cloudAccessToken
  if (!baseUrl || !token) return null

  const url = `${baseUrl.replace(/\/$/, '')}/business-day-reports?businessDayId=${encodeURIComponent(businessDayId)}&$limit=1`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: CloudReportSnapshot[] } | CloudReportSnapshot[]
    const items = Array.isArray(body) ? body : (body.data ?? [])
    return items[0] ?? null
  } catch (err) {
    logger.warn({
      message: 'business-day.refresh_status_failed',
      event: 'business_day.refresh_status_failed',
      businessDayId,
      error: (err as Error).message,
    })
    return null
  }
}

interface CloudTriggerPayload {
  tenantId: string
  locationId: string | null
  businessDayId: string
  businessDate: string
  operationMode: 'orders-only' | 'pos-cashier'
  countedClosingFloatCents?: number
  cashDropsCents?: number
  payoutsCents?: number
  openingFloatCents?: number
  physicalCounts?: Record<string, number>
}

/**
 * Stoesst den Cloud-Aggregations-Workflow an. Verwendet die existierende
 * cloud-connection-Konfiguration (Token, baseUrl) — laeuft als best-effort:
 * Wenn die Cloud unerreichbar ist, bleibt der Tag in 'closing-requested'
 * und kann manuell erneut getriggert werden.
 */
async function triggerCloudClosing(app: Application, payload: CloudTriggerPayload): Promise<void> {
  const cloudConnection = await loadCloudConnection(app)
  if (!cloudConnection) {
    throw new Error('Keine aktive Cloud-Verbindung fuer Closing-Trigger')
  }

  const baseUrl = cloudConnection.cloudUrl
  const token = cloudConnection.cloudAccessToken
  if (!baseUrl || !token) {
    throw new Error('Cloud-Verbindung unvollstaendig (URL oder Token fehlt)')
  }

  const url = `${baseUrl.replace(/\/$/, '')}/business-day-reports`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Service-Method': 'startClosing',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => 'Unbekannter Fehler')
    throw new Error(`Cloud-Antwort ${response.status}: ${body}`)
  }
}

async function loadCloudConnection(
  app: Application,
): Promise<{ cloudUrl?: string; cloudAccessToken?: string } | null> {
  try {
    const result = await (app.service('cloud-connection') as any).find({
      query: { $limit: 1 },
      provider: undefined,
    })
    const items = Array.isArray(result) ? result : result?.data ?? []
    return items[0] ?? null
  } catch {
    return null
  }
}

export const businessDays = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<BusinessDay>(app, {
    name: businessDaysPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as BusinessDayService & {
    openDay: (data: OpenDayData, params?: OpenDayParams) => Promise<BusinessDay>
    closeDay: (data: CloseDayData, params?: OpenDayParams) => Promise<BusinessDay>
    refreshClosingStatus: (data: RefreshClosingStatusData, params?: OpenDayParams) => Promise<BusinessDay>
  }

  // Custom-Methods auf den Service-Proxy haengen
  service.openDay = (data: OpenDayData, params?: OpenDayParams) =>
    openDay(app, data, params)
  service.closeDay = (data: CloseDayData, params?: OpenDayParams) =>
    closeDay(app, data, params)
  service.refreshClosingStatus = (data: RefreshClosingStatusData, params?: OpenDayParams) =>
    refreshClosingStatus(app, data, params)
  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      businessDaysPath,
      [
        { name: 'idx_businessdays_tenant', columns: ['tenantId'] },
        { name: 'idx_businessdays_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_businessdays_date', columns: ['tenantId', 'locationId', 'date'] },
      ],
      service,
    )

  ;(app as any).use(businessDaysPath, service, {
    methods: [...businessDaysMethods],
    events: [],
  })

  ;(app.service(businessDaysPath) as any).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),
        schemaHooks.resolveExternal(businessDayExternalResolver),
        schemaHooks.resolveResult(businessDayResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(businessDayQueryValidator),
        schemaHooks.resolveQuery(businessDayQueryResolver),
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(businessDayDataValidator),
        schemaHooks.resolveData(businessDayDataResolver),
      ],
      patch: [
        schemaHooks.validateData(businessDayPatchValidator),
        schemaHooks.resolveData(businessDayPatchResolver),
      ],
      remove: [],
    },
  })
}
