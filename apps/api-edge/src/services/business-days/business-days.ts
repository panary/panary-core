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
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'

import { AuditAction, AuditCategory, AuditOutcome, AuditSeverity } from '@panary/audit-events/domain'
import { BusinessDayStatus, BusinessDayOperationMode } from '@panary/businessdays/domain'
import { LocationOperationMode } from '@panary/locations/domain'
import { PairingStatus } from '@panary/cloud-connection/domain'
import { SyncOutboxStatus } from '@panary/sync/domain'
import { authorize, multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import { ensureIndexes, logger } from '@panary/shared-backend'
import { dayTseFieldsFromError, dayTseFieldsFromSignature, type BusinessDayTseFields } from '@panary/tse/domain'

import {
  businessDayDataResolver,
  businessDayDataValidator,
  businessDayExternalResolver,
  businessDayPatchResolver,
  businessDayPatchValidator,
  businessDayQueryResolver,
  businessDayQueryValidator,
  businessDayResolver,
  businessDayValidator,
} from './business-days.schema'
import type {
  BusinessDay,
  BusinessDayService,
  CloseDayData,
  DiscardOrphanDayData,
  OpenDayData,
  RefreshClosingStatusData,
} from './business-days.class'

import { ensureSingleOpenBusinessDay } from '../../hooks/ensure-single-open-business-day.hook'

import type { Application, HookContext } from '../../declarations'

export const businessDaysPath = 'businessdays' // bestehender Tabellen-/Service-Pfad
export const businessDaysMethods = [
  'find',
  'get',
  'create',
  'patch',
  'remove',
  'openDay',
  'closeDay',
  'refreshClosingStatus',
  'discardOrphanDay',
] as const

export * from './business-days.schema'

interface OpenDayParams {
  user?: { _id?: string; tenantId?: string; locationId?: string | null }
  provider?: string
  /**
   * Standalone-Fallback bei Cloud-Outage: wenn der Operator im Admin-Client
   * den Offline-Modus aktiviert hat, setzen die internen Caller
   * (`rotateBusinessDay`, `reconcileLocationBusinessDay`) dieses Flag,
   * damit der `cloudManaged`-Hook auch bei aktivem Pairing durchlässt.
   * Externe Caller (POS-Client, Admin-UI) können das Flag NICHT setzen —
   * der `protectFromExternal()`-Resolver-Pfad existiert hier nicht, weil
   * `params.isEmergencyOverride` direkt im `before`-Hook geprüft wird und
   * niemals in die Datenbank landet.
   */
  isEmergencyOverride?: boolean
}

/**
 * Wirft Forbidden, sobald die Edge mit der Cloud gepairt ist UND der Aufruf
 * extern initiiert wurde (z.B. POS-Client). Interne Aufrufe ohne `provider`
 * (Sync-Apply, Bootstrap, Worker) bleiben durchgelassen.
 *
 * Im Hybrid-Modell ist die Cloud Master fuer BusinessDay-Lifecycle, sobald
 * eine Pairing-Verbindung besteht. Der Edge agiert dann nur als Read-Replica;
 * `openDay`/`closeDay` werden in der Cloud aufgerufen und kommen via
 * Sync-Pull-Master-Data zur Edge zurueck.
 *
 * Fail-open: wenn `cloud-connection` nicht erreichbar ist, blockiert der
 * Hook NICHT — damit Bootstrap-Pfade vor Service-Registrierung weiter
 * funktionieren.
 */
async function guardCloudManagedLifecycle(app: Application, params: OpenDayParams, operation: string): Promise<void> {
  if (!params.provider) return // interner Aufruf — Sync-Apply etc.
  if (params.isEmergencyOverride) return // Operator-Override bei Cloud-Outage
  try {
    const result = await (app.service('cloud-connection') as any).find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    if (list.length > 0) {
      throw new Forbidden(
        `Geschaeftstag-${operation} wird in der Cloud verwaltet, ` +
          `sobald der Edge mit der Cloud gepairt ist. Bitte im Cloud-Admin-` +
          `Dashboard ausfuehren.`,
      )
    }
  } catch (err) {
    if (err instanceof Forbidden) throw err
    // Fail-open bei cloud-connection-Lookup-Fehler
    logger.warn({
      message: `guardCloudManagedLifecycle: cloud-connection-Lookup fehlgeschlagen, fail-open`,
      event: 'business_day.cloud_managed_guard_fail_open',
      operation,
      error: (err as Error).message,
    })
  }
}

/**
 * Zaehlt Datensaetze eines Services, die an einem Geschaeftstag haengen.
 * Fehler werden bewusst NICHT geschluckt: ein fehlgeschlagener Zaehl-Call darf
 * niemals als „0 Datensaetze" durchgehen, sonst loeschte der Guard fail-open.
 */
async function countLinkedRecords(app: Application, service: string, businessDayId: string): Promise<number> {
  const result = await (app.service(service as never) as any).find({
    query: { businessDayId, $limit: 0 },
    provider: undefined,
    paginate: { default: 0, max: 0 },
  })
  // Ist Pagination am Service abgeschaltet, liefert find ein Array — dann waere
  // `.total` undefined und der Guard liefe fail-open ins Loeschen.
  if (Array.isArray(result)) return result.length
  return (result as { total?: number })?.total ?? 0
}

/**
 * Services, die einen Geschaeftstag „belegt" machen. Jeder Treffer blockt.
 *
 * Belege sind bewusst NICHT dabei: `receipts` hat kein `businessDayId`, sie
 * haengen ueber `orderId` an der Bestellung. Bei 0 Bestellungen kann es keinen
 * Beleg zu diesem Tag geben — der orders-Check deckt sie transitiv ab.
 */
const ORPHAN_BLOCKING_SERVICES = [
  { service: 'orders', label: 'Bestellungen' },
  { service: 'cash-sessions', label: 'Kassensitzungen' },
] as const

/**
 * Verwirft einen verwaisten, leeren Geschaeftstag.
 *
 * Hintergrund: bis zur Reparatur von `rotateBusinessDay` konnten pro Filiale
 * mehrere Tage gleichzeitig offen bleiben. Die aelteren sind lokal entstanden
 * (Auto-Rotation), der Cloud unbekannt und ueber die UI nicht abschliessbar:
 * `closeDay` ist bei aktivem Pairing gesperrt und liefe ohne Cloud-Report
 * ohnehin nur bis `closing-requested`.
 *
 * Bewusst eine eigene Methode statt einer Lockerung von `cloudManagedHook`:
 * die Bedingungen sind eine Mehrfach-Pruefung, kein einfacher Write, und der
 * Vorgang bekommt so einen eigenen METHOD_TO_ACTION-Eintrag und eine benannte
 * Audit-Spur.
 *
 * Fiskalische Integritaet: geloescht wird ausschliesslich ein Tag OHNE jeden
 * Geschaeftsvorfall. Ein Tag mit Umsatz ist kein Verwaister, sondern ein
 * Datenproblem — der darf ueber diesen Pfad nie verschwinden. Der Vorgang
 * schreibt selbst ein Audit-Event; `audit-events` steht in
 * SyncableTransactionService, der Loeschvorgang ist damit auch dann in der
 * Cloud nachweisbar, wenn der geloeschte Tag dort nie existierte.
 */
export async function discardOrphanDay(
  app: Application,
  data: DiscardOrphanDayData,
  params: OpenDayParams = {},
): Promise<{ discarded: true; _id: string }> {
  const user = params.user
  // Kein anonymer Aufruf: der Vorgang muss einem Akteur zurechenbar sein.
  if (!params.provider) {
    throw new BadRequest('discardOrphanDay ist nur ueber einen authentifizierten Aufruf erlaubt')
  }
  if (!user?._id || !user.tenantId) {
    throw new BadRequest('Tenant-Kontext fehlt — discardOrphanDay benoetigt einen authentifizierten User')
  }
  if (!data.businessDayId) throw new BadRequest('businessDayId ist Pflicht')

  const businessDay = (await (app.service(businessDaysPath) as any).get(data.businessDayId, {
    provider: undefined,
  })) as BusinessDay | undefined
  if (!businessDay) throw new NotFound('Geschaeftstag nicht gefunden')
  if (businessDay.tenantId !== user.tenantId) throw new BadRequest('Tenant-Mismatch')

  if (businessDay.status !== BusinessDayStatus.OPEN) {
    throw new BadRequest(
      `Nur offene Geschaeftstage koennen verworfen werden (Status: ${businessDay.status}). ` +
        `Abgeschlossene und freigegebene Tage sind unantastbar.`,
    )
  }

  // Der aktuelle Tag der Filiale ist per Definition kein Verwaister.
  if (businessDay.locationId) {
    const location = (await (app.service('locations') as any)
      .get(businessDay.locationId, { provider: undefined })
      .catch(() => null)) as { currentBusinessDay?: { businessDayId?: string } | null } | null
    if (location?.currentBusinessDay?.businessDayId === businessDay._id) {
      throw new BadRequest('Dieser Geschaeftstag ist der aktuelle Tag der Filiale und kann nicht verworfen werden')
    }
  }

  // `rotateBusinessDay` sendet kein `openedBy`, `openDay()` setzt user._id.
  // Fehlt es, stammt der Tag aus der lokalen Auto-Rotation — genau der Fall,
  // den die Cloud nie gesehen hat. Ein manuell eroeffneter Tag wird hier nicht
  // angefasst; der gehoert ueber den regulaeren Abschluss beendet.
  if (businessDay.openedBy) {
    throw new BadRequest(
      'Dieser Geschaeftstag wurde manuell eroeffnet und ist damit kein Verwaister. ' +
        'Bitte regulaer abschliessen statt verwerfen.',
    )
  }

  for (const { service, label } of ORPHAN_BLOCKING_SERVICES) {
    const total = await countLinkedRecords(app, service, businessDay._id)
    if (total > 0) {
      throw new BadRequest(
        `Geschaeftstag enthaelt ${total} ${label} und kann nicht verworfen werden. ` +
          `Bitte den Support kontaktieren.`,
      )
    }
  }

  await recordOrphanDiscardAudit(app, businessDay, user)
  await (app.service(businessDaysPath) as any).remove(businessDay._id, { provider: undefined })

  logger.info({
    message: 'Verwaister Geschaeftstag verworfen',
    event: 'business_day.orphan_discarded',
    tenantId: businessDay.tenantId,
    locationId: businessDay.locationId,
    businessDayId: businessDay._id,
    businessDate: businessDay.date,
    openedAt: businessDay.openedAt,
    actorUserId: user._id,
  })

  return { discarded: true, _id: businessDay._id }
}

/**
 * Schreibt die Audit-Spur VOR dem Loeschen — nach dem remove waeren die Daten
 * fuer den `before`-Block weg. Bewusst AuditAction.DELETE statt eines neuen
 * Enum-Werts: `audit-events` wird in die Cloud gepusht und dort gegen dasselbe
 * Enum validiert; ein unbekannter Wert wuerde den Sync terminal rejecten.
 * Der Sonderfall steht stattdessen in `metadata.reason`.
 */
async function recordOrphanDiscardAudit(
  app: Application,
  businessDay: BusinessDay,
  user: { _id?: string; tenantId?: string; role?: string; locationId?: string | null },
): Promise<void> {
  try {
    const correlationId = uuidv7()
    const event = {
      _id: uuidv7(),
      tenantId: businessDay.tenantId,
      locationId: businessDay.locationId ?? null,
      occurredAt: new Date().toISOString(),
      actor: { userId: user._id!, role: user.role ?? 'unknown', requestId: correlationId },
      target: {
        resource: businessDaysPath,
        entityType: 'business-day',
        entityId: businessDay._id,
        entityRef: businessDay.date,
      },
      action: AuditAction.DELETE,
      category: AuditCategory.CASH,
      outcome: AuditOutcome.SUCCESS,
      severity: AuditSeverity.ALERT,
      before: { status: businessDay.status, date: businessDay.date, openedAt: businessDay.openedAt },
      metadata: { reason: 'orphan-business-day-discarded', orderCount: 0, cashSessionCount: 0 },
      correlationId,
      // Flache Index-Spalten wie in record-audit-event.hook.ts.
      actor_userId: user._id,
      target_resource: businessDaysPath,
      target_entityType: 'business-day',
      target_entityId: businessDay._id,
    }
    await (app.service('audit-events') as any).create(event, { provider: undefined })
  } catch (err) {
    // Audit-Verlust ist akzeptabel, der Business-Pfad bleibt intakt — Muster
    // wie recordAuditEvent. Der Wide Event unten protokolliert den Vorgang
    // ohnehin lokal.
    logger.warn({
      message: 'discardOrphanDay: Audit-Event konnte nicht geschrieben werden',
      event: 'business_day.orphan_discard_audit_failed',
      businessDayId: businessDay._id,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

export type OutboxGuardVerdict = 'skip' | 'warn' | 'block'

/**
 * Reine Entscheidungslogik des closeDay-Outbox-Guards (Review 2026-07-06) —
 * als eigene Funktion exportiert, damit die Modi-Matrix OHNE globalen
 * DB-Zustand testbar ist (eine geseedete CONNECTED-Connection wuerde in der
 * geteilten Test-SQLite parallele Suiten in den Cloud-Modus kippen):
 *  - kein CONNECTED-Pairing → skip (Standalone hat keinen Push/Cloud-Report,
 *    pending akkumuliert dort naturgemaess fuer immer)
 *  - CONNECTED + pending + Emergency-Override → warn (Cloud-Outage: pending
 *    ist erwartbar, der Notfall-Abschluss darf nicht blockieren)
 *  - CONNECTED + pending → block (Cloud-Report braucht vollstaendige Daten)
 */
export function evaluateOutboxGuard(input: {
  cloudConnected: boolean
  pendingTotal: number
  isEmergencyOverride: boolean
}): OutboxGuardVerdict {
  if (!input.cloudConnected) return 'skip'
  if (input.pendingTotal <= 0) return 'skip'
  return input.isEmergencyOverride ? 'warn' : 'block'
}

/**
 * Existiert eine CONNECTED cloud-connection? Fail-open (false = standalone
 * angenommen) bei Lookup-Fehlern — konsistent zu guardCloudManagedLifecycle:
 * ein kaputter Lookup darf weder Bootstrap-Pfade noch den lokalen
 * Tagesabschluss blockieren.
 */
async function hasConnectedCloudConnection(app: Application): Promise<boolean> {
  try {
    const result = await (app.service('cloud-connection') as any).find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    return Array.isArray(result) && result.length > 0
  } catch (err) {
    logger.warn({
      message: 'hasConnectedCloudConnection: Lookup fehlgeschlagen, fail-open (standalone angenommen)',
      event: 'business_day.cloud_connection_lookup_failed',
      error: (err as Error).message,
    })
    return false
  }
}

/**
 * Wrapper, der `guardCloudManagedLifecycle` als Feathers-`before`-Hook
 * verwendbar macht — pro Service-Methode (`create`/`patch`/`remove`).
 * Aktuell sind die Lifecycle-Mutationen ueber `openDay`/`closeDay`/
 * `refreshClosingStatus` abgedeckt, die den Guard explizit aufrufen.
 * Dieser zusaetzliche Hook schliesst die Luecke fuer den Standard-CRUD-
 * Pfad (HTTP-POST/PATCH/DELETE direkt auf den Service).
 */
const cloudManagedHook =
  (operation: string) =>
  async (context: HookContext): Promise<HookContext> => {
    const app = context.app as Application
    const params = context.params as OpenDayParams
    await guardCloudManagedLifecycle(app, params, operation)
    return context
  }

// Sync-Apply vs. lokale Eröffnung beim Create-Pfad:
//
// `businessDayDataValidator` ist das STRIKTE openDay-Eingabe-Schema
// (additionalProperties:false, nur 6 Felder) und `businessDayDataResolver`
// erzwingt status=OPEN/isOpen=true/openedAt=now — beides korrekt für eine
// lokale Eröffnung, aber FALSCH für den Cloud-Sync: dort kommt der vollständige
// Lifecycle-Record (auch geschlossene Tage). Bei `fromSync` validieren wir daher
// gegen das volle `businessDaySchema` und übernehmen den Record UNVERÄNDERT
// (kein Resolver) — konsistent mit dem `fromSync`-Prinzip (Cloud = Source-of-Truth).
const validateInputData = schemaHooks.validateData(businessDayDataValidator)
const validateFullData = schemaHooks.validateData(businessDayValidator)
const resolveCreateData = schemaHooks.resolveData(businessDayDataResolver)

const syncAwareValidateCreate = (context: HookContext): Promise<HookContext> =>
  (context.params as { fromSync?: boolean })?.fromSync
    ? (validateFullData(context) as Promise<HookContext>)
    : (validateInputData(context) as Promise<HookContext>)

const syncAwareResolveCreate = (context: HookContext): Promise<HookContext> | HookContext =>
  (context.params as { fromSync?: boolean })?.fromSync ? context : (resolveCreateData(context) as Promise<HookContext>)

/**
 * Eroeffnet einen neuen Geschaeftstag.
 * Validierungen:
 *   - kein offener Tag an derselben Location
 *   - locationId vom User oder Payload
 *   - operationMode wird aus Location.operationMode kopiert (Snapshot)
 */
async function openDay(app: Application, data: OpenDayData, params: OpenDayParams = {}): Promise<BusinessDay> {
  await guardCloudManagedLifecycle(app, params, 'Eroeffnung')

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
  const items = Array.isArray(existing) ? existing : (existing?.data ?? [])
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

  // Kein openingFloatCents mehr: das Wechselgeld gehört zur Kasse (cash-sessions),
  // nicht zum Geschäftstag. Tag-Eröffnung legt keinen Float-Anfangsbestand an.
  const created = await (app.service(businessDaysPath) as any).create(
    {
      _id: uuidv7(),
      tenantId: user.tenantId,
      locationId,
      date: today,
      openedBy: user._id ?? 'unknown',
      operationMode,
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
async function closeDay(app: Application, data: CloseDayData, params: OpenDayParams = {}): Promise<BusinessDay> {
  await guardCloudManagedLifecycle(app, params, 'Tagesabschluss')

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
  // Kein day-level countedClosingFloatCents-Pflichtcheck mehr: Wechselgeld gehört
  // zur Kasse (cash-session), nicht zum Geschäftstag. Der Edge-closeDay läuft nur
  // im Standalone-Modus (guardCloudManagedLifecycle blockt ihn bei Pairing) — und
  // Standalone hat kein Multi-Kassen-Tagesabschluss-Feature. Im Cloud-Modus läuft
  // der Abschluss in der Cloud, wo die closing-validation (all-cash-sessions-closed
  // = Blocker, cash-without-session = Warnung) die Vollständigkeit erzwingt.

  // Der Outbox-Guard schuetzt den CLOUD-Report vor unvollstaendigen Zahlen —
  // er ist deshalb an den Cloud-Modus gebunden (Review-Befund 2026-07-06):
  //  - STANDALONE (kein CONNECTED-Pairing): es gibt keinen Push und keinen
  //    Cloud-Report; der Recorder fuellt die Outbox trotzdem, pending
  //    akkumuliert dort naturgemaess fuer immer und darf den lokalen
  //    Abschluss nie blockieren.
  //  - EMERGENCY-OVERRIDE (Cloud-Outage): pending > 0 ist waehrend einer
  //    Outage praktisch garantiert — der Notfall-Abschluss darf nicht
  //    blockieren, wird aber als Warnung protokolliert; der Report heilt
  //    sich nach der Outage via Sync + refreshClosingStatus.
  //  - CONNECTED ohne Override: Hard-Block (extern aktuell durch
  //    guardCloudManagedLifecycle verdeckt; greift fuer interne Aufrufe und
  //    bleibt als Netz, falls die Lifecycle-Sperre je gelockert wird).
  const cloudConnected = await hasConnectedCloudConnection(app)
  let pendingTotal = 0
  if (cloudConnected) {
    // KEIN tenantId-Filter: sync-outbox ist edge-interner Workflow-State ohne
    // tenantId-Spalte (Edge = single-tenant) — das Query-Schema
    // (additionalProperties:false) lehnt tenantId ab und der Guard waere
    // still deaktiviert. in-flight blockt mit: der Push laeuft, ist aber
    // noch nicht geackt — die Cloud hat die Daten ggf. noch nicht.
    const outboxPending = await (app.service('sync-outbox') as any)
      .find({
        query: {
          status: { $in: [SyncOutboxStatus.PENDING, SyncOutboxStatus.IN_FLIGHT] },
          $limit: 0,
        },
        provider: undefined,
      })
      .catch((err: unknown) => {
        // Fail-open wie guardCloudManagedLifecycle — aber nie still: ein
        // geschluckter Query-Fehler wuerde den Guard unbemerkt deaktivieren.
        logger.warn({
          message: 'closeDay: Sync-Outbox-Check fehlgeschlagen, fail-open',
          event: 'business_day.outbox_check_failed',
          businessDayId: data.businessDayId,
          error: (err as Error).message,
        })
        return { total: 0 }
      })
    pendingTotal = (outboxPending as { total?: number })?.total ?? 0
  }
  const verdict = evaluateOutboxGuard({
    cloudConnected,
    pendingTotal,
    isEmergencyOverride: params.isEmergencyOverride === true,
  })
  if (verdict === 'warn') {
    logger.warn({
      message: `closeDay: Emergency-Override schliesst den Tag mit ${pendingTotal} unsynchronen Aenderungen`,
      event: 'business_day.close_with_pending_outbox',
      businessDayId: data.businessDayId,
      pendingTotal,
    })
  } else if (verdict === 'block') {
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

  // TSE-Tagesabschluss-Signatur beim tatsächlichen Schließen (nur pos-cashier +
  // aktive TSE). Nie blockierend (§146a) — bei Ausfall wird der Tag trotzdem
  // geschlossen und als nachzusignieren markiert.
  const tseDayFields = await signBusinessDayClose(app, businessDay, nextStatus)

  const patched = (await (app.service(businessDaysPath) as any).patch(
    data.businessDayId,
    {
      status: nextStatus,
      reportId: report._id ?? null,
      reportErrorMessage: report.errorMessage ?? null,
      ...tseDayFields,
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

// Signiert den Tagesabschluss über den TsePort, sobald der Tag tatsächlich
// schließt. No-Op außerhalb pos-cashier / ohne aktive TSE. Wirft NIE — ein
// Ausfall (§146a) markiert den Tag als nachzusignieren statt das Schließen zu
// blockieren.
async function signBusinessDayClose(
  app: Application,
  businessDay: BusinessDay,
  nextStatus: string,
): Promise<Partial<BusinessDayTseFields>> {
  if (nextStatus !== BusinessDayStatus.CLOSED) return {}
  if (businessDay.operationMode !== BusinessDayOperationMode.POS_CASHIER) return {}
  const tsePort = app.get('tsePort')
  if (!tsePort) return {}

  try {
    const signature = await tsePort.signDayClose({
      businessDayId: businessDay._id,
      closedAt: businessDay.closedAt ?? new Date().toISOString(),
    })
    return dayTseFieldsFromSignature(signature)
  } catch (err) {
    logger.warn({
      message: 'TSE-Tagesabschluss-Signatur fehlgeschlagen — Tag wird geschlossen, nachzusignieren',
      event: 'tse.day_close_failed',
      tenantId: businessDay.tenantId,
      businessDayId: businessDay._id,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return dayTseFieldsFromError(err)
  }
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

async function loadCloudConnection(app: Application): Promise<{ cloudUrl?: string; cloudAccessToken?: string } | null> {
  try {
    const result = await (app.service('cloud-connection') as any).find({
      query: { $limit: 1 },
      provider: undefined,
    })
    const items = Array.isArray(result) ? result : (result?.data ?? [])
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
    discardOrphanDay: (
      data: DiscardOrphanDayData,
      params?: OpenDayParams,
    ) => Promise<{ discarded: true; _id: string }>
  }

  // Custom-Methods auf den Service-Proxy haengen
  service.openDay = (data: OpenDayData, params?: OpenDayParams) => openDay(app, data, params)
  service.closeDay = (data: CloseDayData, params?: OpenDayParams) => closeDay(app, data, params)
  service.refreshClosingStatus = (data: RefreshClosingStatusData, params?: OpenDayParams) =>
    refreshClosingStatus(app, data, params)
  service.discardOrphanDay = (data: DiscardOrphanDayData, params?: OpenDayParams) =>
    discardOrphanDay(app, data, params)
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
      all: [schemaHooks.validateQuery(businessDayQueryValidator), schemaHooks.resolveQuery(businessDayQueryResolver)],
      find: [],
      get: [],
      // ensureSingleOpenBusinessDay ganz zuletzt: erst nach dem Create-Resolver
      // stehen tenantId/locationId/status final im data-Objekt.
      create: [
        cloudManagedHook('Eroeffnung'),
        syncAwareValidateCreate,
        syncAwareResolveCreate,
        ensureSingleOpenBusinessDay,
      ],
      patch: [
        cloudManagedHook('Patch'),
        schemaHooks.validateData(businessDayPatchValidator),
        schemaHooks.resolveData(businessDayPatchResolver),
      ],
      remove: [cloudManagedHook('Loeschen')],
    },
  })
}
