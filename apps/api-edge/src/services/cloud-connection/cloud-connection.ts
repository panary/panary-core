import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { BadRequest } from '@feathersjs/errors'

import { decryptCloudToken } from '../../utils/cloud-token-cipher'

import {
  cloudConnectionDataResolver,
  cloudConnectionDataValidator,
  cloudConnectionExternalResolver,
  cloudConnectionPatchResolver,
  cloudConnectionPatchValidator,
  cloudConnectionQueryResolver,
  cloudConnectionQueryValidator,
  cloudConnectionResolver,
} from './cloud-connection.schema'

import type { Application } from '../../declarations'
import type { HookContext } from '../../declarations'
import { authorize, getJsonFieldHooks, logger, multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  BootstrapStatus,
  cloudConnectionDataSchema,
  cloudConnectionPatchSchema,
  cloudConnectionQuerySchema,
  cloudConnectionSchema,
  type CloudConnectionPreflightData,
  type CloudConnectionPreflightResult,
  type CloudConnectionStartBootstrapData,
  type CloudConnectionSyncNowResult,
  InitialSyncDirection,
  PairingStatus,
  SyncMode,
  SYNC_INTERVAL_DEFAULT_SEC,
} from '@panary/cloud-connection/domain'
import {
  PreflightResponse,
  SyncableMasterDataService,
  type EdgeIdentity,
  type EdgePairingResponse,
  type MasterDataInventory,
} from '@panary/edge-pairing/domain'
import type { CloudConnection } from './cloud-connection.class'

export const cloudConnectionPath = 'cloud-connection'
export const cloudConnectionMethods = [
  'find',
  'get',
  'create',
  'patch',
  'remove',
  'preflight',
  'startBootstrap',
  'syncNow',
] as const

export * from './cloud-connection.schema'

const PREFLIGHT_TIMEOUT_MS = 15_000
const PAIR_TIMEOUT_MS = 15_000

// Cloud-seitig sind preflight/create Custom Methods desselben edge-pairing-Service.
// Standard-CREATE = Pairing-Create (POST /edge-pairing ohne X-Service-Method).
// Preflight = Custom Method (POST /edge-pairing mit X-Service-Method: preflight).
const EDGE_PAIRING_PATH = '/edge-pairing'

const isLocalhostUrl = (url: string): boolean =>
  url.includes('localhost') || url.includes('127.0.0.1')

const normalizeCloudUrl = (url: string): string => {
  const trimmed = url.trim()
  if (!trimmed) throw new BadRequest('Cloud-URL fehlt.')
  // Akzeptiert "localhost:3031" / "cloud.panary.io" ohne Protokoll und ergaenzt
  // automatisch http:// fuer localhost, https:// fuer alles andere. Sonst wirft
  // node-fetch ein nichtssagendes "fetch failed".
  if (!/^https?:\/\//i.test(trimmed)) {
    return isLocalhostUrl(trimmed) ? `http://${trimmed}` : `https://${trimmed}`
  }
  return trimmed
}

const ensureSecureUrl = (url: string): string => {
  const normalized = normalizeCloudUrl(url)
  if (!isLocalhostUrl(normalized) && !normalized.startsWith('https://')) {
    throw new BadRequest('Cloud-URL muss HTTPS verwenden (außer für localhost).')
  }
  return normalized
}

// Zaehlt ALLE Records einer Tabelle direkt ueber den Knex-Client. Edge ist per
// Architektur single-tenant — alle DB-Records gehoeren zum Edge-Tenant, ein
// tenantId-Filter waere redundant. Service-Pfade (products, product-groups) sind
// in panary-core 1:1 mit den SQLite-Tabellennamen.
//
// Knex direkt statt Adapter-Methoden, weil der KnexService-Adapter mit
// `_find({paginate:true, query:{$limit:0}})` `total: 0` zurueckgibt obwohl die
// DB Records hat (Adapter-Quirk bei diesem Param-Pattern). Direkter count(*) ist
// zuverlaessig und liefert die erwarteten Zahlen.
const countTable = async (app: Application, tableName: string): Promise<number> => {
  try {
    const knex = app.get('sqliteClient') as ((tbl: string) => { count: (col: string) => Promise<Array<{ count: number | string }>> }) | undefined
    if (!knex) return 0
    const result = await knex(tableName).count('* as count')
    const row = Array.isArray(result) ? result[0] : undefined
    const count = row?.count
    return typeof count === 'number' ? count : Number(count ?? 0)
  } catch (err: unknown) {
    // Tabelle existiert nicht (z.B. pricelists noch nicht in panary-core) →
    // 0 ist die korrekte Antwort. Wir loggen trotzdem auf debug-Niveau, damit
    // das im Wide-Event-Stream auftaucht aber kein WARN-Rauschen verursacht.
    logger.debug({
      message: 'Bestand zaehlen fehlgeschlagen (Tabelle existiert ggf. nicht)',
      event: 'cloud-connection.inventory.count_failed',
      table: tableName,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
}

const collectEdgeInventory = async (app: Application): Promise<MasterDataInventory> => ({
  products: await countTable(app, SyncableMasterDataService.PRODUCTS),
  productGroups: await countTable(app, SyncableMasterDataService.PRODUCT_GROUPS),
  users: await countTable(app, SyncableMasterDataService.USERS),
  corporateCustomers: await countTable(app, SyncableMasterDataService.CORPORATE_CUSTOMERS),
  customers: await countTable(app, SyncableMasterDataService.CUSTOMERS),
})

interface EdgeIdentityContext {
  edgeName: string
  tenantId: string
  locationId?: string | null
  email?: string
  phone?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const buildEdgeIdentity = (ctx: EdgeIdentityContext): EdgeIdentity => ({
  edgeName: ctx.edgeName,
  localTenantId: ctx.tenantId,
  // Cloud's locationId-Schema verlangt UUID-Format ODER null. Wir senden nur,
  // wenn der Wert tatsaechlich eine UUID ist — leere Strings, Legacy-Werte
  // ("main") oder andere Non-UUIDs werden zu undefined kollabiert (JSON.stringify
  // entfernt undefined komplett aus dem Body).
  localLocationId: ctx.locationId && UUID_PATTERN.test(ctx.locationId) ? ctx.locationId : undefined,
  edgeVersion: process.env['npm_package_version'] ?? '0.0.0',
  platform: process.platform,
  // Stammdaten der lokalen Edge-Location — fuer den "neuer Standort"-Fall in
  // der Cloud (Cloud legt aus diesen Daten eine neue Location an).
  locationEmail: ctx.email,
  locationPhone: ctx.phone,
})

/** Liest die einzige (oder erste) Location aus der lokalen Edge-`locations`-Tabelle.
 *  Edge ist 1:1 mit einer Location verknuepft — diese Daten gehen mit dem
 *  Pairing als `edgeIdentity` an die Cloud. Cloud entscheidet beim Pair, ob die
 *  ID uebernommen wird oder ein bestehender Cloud-Standort zugewiesen wird. */
const resolveEdgeLocation = async (app: Application): Promise<{
  locationId: string | null
  email?: string
  phone?: string
}> => {
  try {
    const result: any = await app.service('locations' as any).find({
      provider: undefined,
      paginate: false,
      query: { $limit: 1, $sort: { name: 1 } },
    } as any)
    const list = Array.isArray(result) ? result : []
    const loc = list[0]
    if (!loc) return { locationId: null }
    return {
      locationId: typeof loc._id === 'string' && UUID_PATTERN.test(loc._id) ? loc._id : null,
      email: typeof loc.email === 'string' && loc.email ? loc.email : undefined,
      phone: typeof loc.phone === 'string' && loc.phone ? loc.phone : undefined,
    }
  } catch {
    return { locationId: null }
  }
}

interface CallCloudOptions {
  cloudUrl: string
  path: string
  body: unknown
  timeoutMs: number
  // Feathers v5 Custom Methods werden ueber den X-Service-Method-Header geroutet,
  // nicht ueber URL-Pfad-Suffix. Ohne Header wird POST /service/methodName auf
  // service.create() geroutet — was Pairing-Validation triggert statt Preflight.
  serviceMethod?: string
}

const callCloud = async <T>(opts: CallCloudOptions): Promise<T> => {
  const baseUrl = ensureSecureUrl(opts.cloudUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.serviceMethod) {
    headers['X-Service-Method'] = opts.serviceMethod
  }
  const response = await fetch(`${baseUrl}${opts.path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  })
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(extractCloudErrorMessage(response.status, errorBody))
  }
  return response.json() as Promise<T>
}

// Cloud-Backend liefert Fehler als FeathersError-JSON (`{ name, message, code, className }`).
// Damit der User keine JSON-Roh-Antwort sieht, extrahieren wir die `message` und fallen auf
// generische Fehler-Texte zurueck, wenn das Format unbekannt ist.
const extractCloudErrorMessage = (status: number, body: string): string => {
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: string; name?: string }
      if (parsed && typeof parsed.message === 'string' && parsed.message.length > 0) {
        return parsed.message
      }
    } catch {
      // Faellt durch auf den Roh-Body, falls JSON ungueltig ist.
    }
  }
  if (trimmed.length > 0) return trimmed
  return `Cloud-Antwort ${status} ohne Fehlerdetails.`
}

const triggerBootstrapWorker = async (app: Application, cloudConnectionId: string): Promise<void> => {
  // Lazy import, damit der Worker beim Edge-Start nicht zwingend gebaut sein muss
  // wenn der Service nur registriert wird.
  const mod = await import('../../workers/cloud-bootstrap-runner.worker.js').catch(() => null)
  if (mod && typeof (mod as any).runBootstrap === 'function') {
    void (mod as any).runBootstrap(app, cloudConnectionId).catch((err: unknown) => {
      ;(app.service(cloudConnectionPath) as any)
        ._patch(cloudConnectionId, {
          bootstrapStatus: BootstrapStatus.FAILED,
          bootstrapError: err instanceof Error ? err.message : String(err),
        })
        .catch(() => undefined)
    })
  }
}

const triggerSyncNow = async (app: Application, cloudConnectionId: string): Promise<CloudConnectionSyncNowResult> => {
  const mod = await import('../../workers/cloud-sync-scheduler.worker.js').catch(() => null)
  if (mod && typeof (mod as any).runSyncOnce === 'function') {
    return (mod as any).runSyncOnce(app, cloudConnectionId)
  }
  return { pushed: 0, pulled: 0, durationMs: 0, lastError: 'Sync-Scheduler nicht aktiv.' }
}

const notifyCloudOnDisconnect = async (context: HookContext) => {
  try {
    const connection = await (context.service as any)._get(context.id!)
    const plainToken = decryptCloudToken(connection.cloudToken)
    if (plainToken && connection.cloudUrl && connection.cloudEdgeId) {
      const baseUrl = ensureSecureUrl(connection.cloudUrl)
      await fetch(`${baseUrl}/edge-pairing/${connection.cloudEdgeId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          // Custom-Header statt Authorization: Bearer — siehe cloud-bootstrap-runner.worker.ts
          'X-Edge-Token': plainToken,
        },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined)
    }
  } catch {
    // Best-Effort
  }
  return context
}

export const cloudConnection = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const baseService = createServiceAdapter<CloudConnection>(app, {
    name: 'cloud-connection',
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as {
    find: (params?: any) => Promise<CloudConnection[] | { data: CloudConnection[]; total: number }>
    get: (id: string, params?: any) => Promise<CloudConnection>
    create: (data: any, params?: any) => Promise<CloudConnection>
    patch: (id: string | null, data: any, params?: any) => Promise<CloudConnection>
    remove: (id: string | null, params?: any) => Promise<CloudConnection>
    preflight: (data: CloudConnectionPreflightData, params?: any) => Promise<CloudConnectionPreflightResult>
    startBootstrap: (data: CloudConnectionStartBootstrapData, params?: any) => Promise<CloudConnection>
    syncNow: (data: { cloudConnectionId: string }, params?: any) => Promise<CloudConnectionSyncNowResult>
    _patch: (id: string, data: Partial<CloudConnection>, params?: any) => Promise<CloudConnection>
    _get: (id: string, params?: any) => Promise<CloudConnection>
  }

  // Custom-Method: preflight — read-only Cloud-Probe, KEIN DB-Touch.
  // Stale-Records sind strukturell ausgeschlossen: ein abgebrochener oder
  // fehlgeschlagener Preflight hinterlaesst keinen Edge-State.
  baseService.preflight = async (data, params) => {
    if (!data?.cloudUrl || !data?.pairingCode || !data?.edgeName) {
      throw new BadRequest('cloudUrl, pairingCode und edgeName sind erforderlich.')
    }
    const normalizedCloudUrl = ensureSecureUrl(data.cloudUrl)
    const requesterTenantId = params?.user?.tenantId
    if (!requesterTenantId) {
      throw new BadRequest('Edge-User hat keinen tenantId — Setup nicht abgeschlossen.')
    }

    const edgeLocation = await resolveEdgeLocation(app)
    const edgeInventory = await collectEdgeInventory(app)
    const preflight = await callCloud<PreflightResponse>({
      cloudUrl: normalizedCloudUrl,
      path: EDGE_PAIRING_PATH,
      serviceMethod: 'preflight',
      body: {
        pairingCode: data.pairingCode,
        edgeIdentity: buildEdgeIdentity({
          edgeName: data.edgeName,
          tenantId: requesterTenantId,
          // Edge-Self-Identifikation: lokale Location aus der `locations`-Tabelle.
          // Cloud entscheidet beim Pairing, welche Cloud-Location finally
          // verknuepft wird (siehe pairing-code.suggestedLocationId).
          locationId: edgeLocation.locationId,
          email: edgeLocation.email,
          phone: edgeLocation.phone,
        }),
        edgeInventory,
      },
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    })

    return {
      cloudTenantId: preflight.cloudTenantId,
      cloudTenantName: preflight.cloudTenantName ?? '',
      cloudLocationId: preflight.cloudLocationId,
      cloudInventory: preflight.cloudInventory,
      edgeInventory,
      suggestedDirection: preflight.suggestedDirection,
      requiresTenantIdRestamp: preflight.requiresTenantIdRestamp,
    }
  }

  // Custom-Method: startBootstrap — atomar Cloud-Pair + DB-Upsert.
  // Cloud-Call ZUERST: bei Fehler kein DB-Touch, kein Stale-State.
  // DB-Upsert via Hook-Pipeline (app.service().create/patch) — Resolver,
  // Validierung, multiTenancy, ensureTenantIsolation laufen alle.
  baseService.startBootstrap = async (data, params) => {
    if (!data?.cloudUrl || !data?.pairingCode || !data?.edgeName ||
        !data?.initialDirection || data?.confirmDataLoss === undefined) {
      throw new BadRequest(
        'cloudUrl, pairingCode, edgeName, initialDirection und confirmDataLoss sind erforderlich.',
      )
    }
    const normalizedCloudUrl = ensureSecureUrl(data.cloudUrl)
    const requesterTenantId = params?.user?.tenantId
    if (!requesterTenantId) {
      throw new BadRequest('Edge-User hat keinen tenantId — Setup nicht abgeschlossen.')
    }
    if (
      data.initialDirection === InitialSyncDirection.PULL_CLOUD_TO_EDGE &&
      data.confirmDataLoss !== true
    ) {
      throw new BadRequest('Pull-Cloud-Bootstrap muss explizit bestaetigt werden (confirmDataLoss=true).')
    }

    // Existierender, aktiv gepairter Edge blockiert ein erneutes Pairing.
    const existing = await baseService.find({
      provider: undefined,
      paginate: false,
      query: { tenantId: requesterTenantId, $limit: 1 },
    } as any)
    const existingRecord = (Array.isArray(existing) ? existing[0] : null) as CloudConnection | null
    if (existingRecord && existingRecord.pairingStatus === PairingStatus.CONNECTED) {
      throw new BadRequest('Edge ist bereits gepairt. Erst trennen, dann neu pairen.')
    }

    const edgeLocation = await resolveEdgeLocation(app)
    const edgeInventory = await collectEdgeInventory(app)

    // 1) Cloud-Pair zuerst — bei Fehler propagiert die Exception ohne DB-Touch.
    const pairResponse = await callCloud<EdgePairingResponse>({
      cloudUrl: normalizedCloudUrl,
      path: EDGE_PAIRING_PATH,
      body: {
        pairingCode: data.pairingCode,
        edgeIdentity: buildEdgeIdentity({
          edgeName: data.edgeName,
          tenantId: requesterTenantId,
          // Edge-Self-Identifikation aus der lokalen `locations`-Tabelle.
          // Cloud entscheidet beim Pairing finally per pairing-code.suggestedLocationId.
          locationId: edgeLocation.locationId,
          email: edgeLocation.email,
          phone: edgeLocation.phone,
        }),
        initialDirection: data.initialDirection,
        edgeInventory,
      },
      timeoutMs: PAIR_TIMEOUT_MS,
    })

    // 2) DB-Upsert via Hook-Pipeline. cloudConnectionDataResolver verschluesselt
    //    cloudToken automatisch, multiTenancy stempelt tenantId, _id wird per
    //    uuidv7() generiert. params.user durchreichen, damit multiTenancy den
    //    User-Context sieht (provider:undefined skippt nur authenticate/authorize).
    const now = new Date().toISOString()

    // Synthetischer preflightSnapshot — der Bootstrap-Worker (runBootstrap)
    // braucht ihn fuer applyCloudTenantId und das requiresTenantIdRestamp-Flag.
    // Cloud-side Inventar bleibt leer (wird beim eigentlichen Bootstrap durch
    // die Sync-Pipeline neu ermittelt); cloudTenantName/cloudLocationName sind
    // im Edge-Kontext nicht verfuegbar, der Worker nutzt sie nicht zwingend.
    const cloudTenantId = pairResponse.cloudTenantId
    const cloudLocationId = pairResponse.cloudLocationId ?? undefined
    const preflightSnapshot = {
      cloudTenantId,
      cloudTenantName: '',
      cloudLocationId,
      cloudLocationName: undefined,
      cloudInventory: { products: 0, productGroups: 0, users: 0, corporateCustomers: 0, customers: 0 },
      edgeInventory,
      suggestedDirection: data.initialDirection,
      requiresTenantIdRestamp: requesterTenantId !== cloudTenantId,
      // Cloud bestimmt die finale locationId (entweder bestehende oder neu).
      // Wenn die Cloud-ID von der lokalen Edge-Location-ID abweicht, muss der
      // Bootstrap-Worker alle SQLite-Records umstempel (analog zu tenantId).
      requiresLocationIdRestamp: (edgeLocation.locationId ?? null) !== (cloudLocationId ?? null),
      // Snapshot der Edge-IDs zum Zeitpunkt des Pairings. Der Bootstrap-Worker
      // liest hieraus die "alten" IDs fuer applyCloudTenantId — NICHT aus
      // `connection.tenantId/locationId`, weil diese Felder a) im initialen
      // upsertData unvollstaendig gesetzt werden (locationId fehlt) und b) nach
      // dem Restamp bereits auf die Cloud-Werte gepatcht werden, also keinen
      // verlaesslichen "vor-Restamp"-Zustand mehr abbilden.
      edgeTenantId: requesterTenantId ?? null,
      edgeLocationId: edgeLocation.locationId ?? null,
      capturedAt: now,
    }

    // Allowlist nur persistieren, wenn sie im Wizard gesetzt wurde UND der
    // gewaehlte Modus sie ueberhaupt nutzt (`bootstrap-edge-to-cloud`).
    // Leere Arrays werden bewusst auf `undefined` kollabiert — sonst koennte
    // ein versehentlicher Reset im UI dazu fuehren, dass GAR keine User
    // gepusht werden.
    const useAllowlist =
      data.initialDirection === InitialSyncDirection.BOOTSTRAP_EDGE_TO_CLOUD &&
      Array.isArray(data.bootstrapUserAllowlist) &&
      data.bootstrapUserAllowlist.length > 0
    const upsertData = {
      cloudUrl: normalizedCloudUrl,
      edgeName: data.edgeName,
      cloudToken: pairResponse.cloudToken,
      cloudEdgeId: pairResponse.cloudEdgeId,
      pairingStatus: PairingStatus.CONNECTED,
      connectedAt: now,
      syncEnabled: true,
      initialDirection: data.initialDirection,
      bootstrapStatus: BootstrapStatus.IN_PROGRESS,
      bootstrapStartedAt: now,
      syncMode: SyncMode.AUTO,
      syncIntervalSec: SYNC_INTERVAL_DEFAULT_SEC,
      preflightSnapshot,
      bootstrapUserAllowlist: useAllowlist ? data.bootstrapUserAllowlist : undefined,
    }

    const hookedService = app.service(cloudConnectionPath) as any
    const hookParams = { provider: undefined, user: params?.user } as any
    let connection: CloudConnection
    try {
      if (existingRecord) {
        connection = await hookedService.patch(existingRecord._id, upsertData, hookParams)
      } else {
        connection = await hookedService.create(upsertData, hookParams)
      }
    } catch (dbErr) {
      // Atomare Pairing-Operation: wenn der lokale DB-Upsert fehlschlaegt,
      // den soeben in Cloud erstellten cloud-edges-Doc kompensierend loeschen
      // (via Edge-Token aus pairResponse). Ohne Kompensation haengt Cloud-seitig
      // ein aktiver Edge, der zukuenftige Pairings derselben Tenant/Location
      // mit "bereits aktive Edge-Verbindung" blockiert.
      try {
        const baseUrl = ensureSecureUrl(normalizedCloudUrl)
        await fetch(`${baseUrl}/edge-pairing/${pairResponse.cloudEdgeId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            // Custom-Header statt Authorization: Bearer — siehe cloud-bootstrap-runner.worker.ts
            'X-Edge-Token': pairResponse.cloudToken,
          },
          signal: AbortSignal.timeout(10_000),
        })
      } catch (rollbackErr) {
        logger.error({
          message: 'KRITISCH: Halbzustand — Cloud-Edge konnte nicht zurueckgerollt werden',
          event: 'cloud-connection.bootstrap.compensation_failed',
          cloudEdgeId: pairResponse.cloudEdgeId,
          originalError: dbErr instanceof Error ? dbErr.message : String(dbErr),
          rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
      }
      throw dbErr
    }

    void triggerBootstrapWorker(app, connection._id)
    return connection
  }

  // Custom-Method: syncNow
  baseService.syncNow = async (data) => {
    const id = data?.cloudConnectionId
    if (!id) throw new BadRequest('cloudConnectionId fehlt.')
    const connection = await baseService._get(id)
    if (connection.pairingStatus !== PairingStatus.CONNECTED) {
      throw new BadRequest('Edge ist nicht verbunden — Sync nicht moeglich.')
    }
    const result = await triggerSyncNow(app, id)
    await baseService._patch(id, {
      lastManualSyncAt: new Date().toISOString(),
    } as any)
    return result
  }

  app.use(cloudConnectionPath, baseService as any, {
    methods: cloudConnectionMethods as any,
    events: [],
    docs: {
      description: 'Edge-Cloud-Verbindung verwalten (Pairing, Bootstrap, Sync-Modus)',
      schemas: {
        cloudConnection: cloudConnectionSchema,
        cloudConnectionData: cloudConnectionDataSchema,
        cloudConnectionPatch: cloudConnectionPatchSchema,
        cloudConnectionQuery: cloudConnectionQuerySchema,
      },
    },
  })

  // SQLite/Knex serialisiert Array/Object-Felder nicht automatisch — ohne
  // Stringify/Parse-Hook wuerde better-sqlite3 sie als '[object Object]'
  // schreiben oder als String zurueckgeben, der nicht mehr als Object nutzbar
  // ist. WICHTIG: `preflightSnapshot` MUSS hier rein, sonst liest der
  // Bootstrap-Worker `connection.preflightSnapshot` als JSON-String, nicht als
  // Object — `connection.preflightSnapshot.cloudTenantId` ergibt dann
  // `undefined`, der `requiresIdentityRestamp`-Trigger feuert nicht, und das
  // Bootstrap-Report-Schema schlaegt mit "missing cloudTenantId" fehl.
  const jsonHooks = getJsonFieldHooks(app, [
    'bootstrapUserAllowlist',
    'preflightSnapshot',
    'syncSchedule',
  ])

  app.service(cloudConnectionPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(cloudConnectionExternalResolver),
        schemaHooks.resolveResult(cloudConnectionResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(cloudConnectionQueryValidator), schemaHooks.resolveQuery(cloudConnectionQueryResolver)],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(cloudConnectionDataValidator),
        schemaHooks.resolveData(cloudConnectionDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        schemaHooks.validateData(cloudConnectionPatchValidator),
        schemaHooks.resolveData(cloudConnectionPatchResolver),
        ...jsonHooks.before,
      ],
      remove: [notifyCloudOnDisconnect],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: {
      all: [],
    },
  })
}
