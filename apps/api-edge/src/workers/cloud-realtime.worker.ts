// Cloud→Edge Realtime-Push-Worker (Socket.IO-Client).
//
// Der Edge baut OUTBOUND eine persistente Socket.IO-Verbindung zur Cloud auf
// (NAT-/Firewall-freundlich — identisch zu jedem Browser-WebSocket). Über diese
// Verbindung pusht die Cloud Trigger-Events (changed/force-sync/revoked) an
// GENAU diesen Edge (Channel `edge/<cloudEdgeId>`, Auth via Handshake-edgeToken).
//
// Trigger-Semantik: Das Event trägt KEINE Geschäftsdaten. Auf `changed` ruft der
// Worker den bestehenden, auditierten Pull-Pfad (`pullBusinessDaysOnce`) auf —
// die Daten fließen weiterhin über `/sync-pull` (Tenant-/Location-Projektionen,
// Tombstones, Allowlist). Der Push kollabiert nur die 5s-Polling-Latenz auf
// ~instant. Bei Socket-Verlust übernimmt der Pull-Worker als Fallback.
//
// Ein Supervisor-Loop hält den Socket-Zustand mit dem `cloud-connection`-Zustand
// konsistent: verbindet bei aktivem Pairing, trennt bei DISCONNECTED, und
// verbindet bei Token-Rotation (geänderter cloudToken) neu.

import { io, type Socket } from 'socket.io-client'

import { uuidv7 } from 'uuidv7'

import { logger } from '@panary/shared-backend'
import {
  AuditAction,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
  type AuditEventData,
} from '@panary/audit-events/domain'
import {
  EDGE_EVENTS_PATH,
  EdgeEventName,
  type EdgeChangedEvent,
  type EdgeForceSyncEvent,
  type EdgeRevokedEvent,
  syncTriggersPath,
  SyncRunTrigger,
} from '@panary/sync/domain'

import type { Application } from '../declarations'
import { decryptCloudToken } from '../utils/cloud-token-cipher'
import {
  getActiveConnection,
  pullMasterDataServiceOnce,
  pullPrinterCommandsOnce,
  triggerImmediateCycle,
} from './cloud-sync-scheduler.worker'
import { pullBusinessDaysOnce } from './cloud-pull-business-days.worker'
import { setRealtimeConnected } from './cloud-realtime-state'

/** Socket.IO-Pfad der Cloud (apps/api-cloud/src/app.ts: socketio({ path: '/ws' })). */
const CLOUD_SOCKET_PATH = '/ws'

/** Reconciliation-Intervall: gleicht Socket-Zustand mit Pairing-Zustand ab. */
const SUPERVISOR_INTERVAL_MS = 30_000

// Reconnect mit Jitter — verhindert einen Thundering-Herd-/Restart-Sturm, wenn
// viele Edges nach einem Cloud-Neustart gleichzeitig reconnecten.
const RECONNECTION_DELAY_MS = 1_000
const RECONNECTION_DELAY_MAX_MS = 30_000
const RANDOMIZATION_FACTOR = 0.5

const BUSINESS_DAYS_SERVICE = 'businessdays'

// Kommando-Queue statt Stammdaten: die Cloud schickt beim Anlegen eines
// Test-Druck-Jobs `changed` mit diesem Service-Namen, der Edge holt ab, fuehrt
// aus und meldet zurueck. Ohne diesen Weg haengt der Testdruck am Sync-Tick —
// Untergrenze 60 s, im Modus `scheduled` bis zum naechsten Slot — waehrend die
// Cloud-UI nach 60 s aufgibt.
const PRINTER_COMMANDS_SERVICE = 'printer-commands'

// Debounce pro Service: ein Bulk-Vorgang in der Cloud (z.B. Katalog-Import mit
// hunderten Produkt-Patches) feuert hunderte `changed`-Events. Statt hunderte
// Pulls auszulösen, coalescen wir gleichartige Trigger zu EINEM Pull ~1s nach
// dem letzten Event (Trailing-Debounce). Der Pull ist cursor-basiert und holt
// alle aufgelaufenen Änderungen in einem Durchlauf.
const TRIGGER_DEBOUNCE_MS = 1_000

// „Cloud erreichbar"-Heartbeat: solange der Socket verbunden ist, aktualisieren
// wir `lastCloudContactAt` (lokaler DB-Patch, KEIN Cloud-HTTP). Muss deutlich
// unter der Staleness-Schwelle des Offline-Banners (60s,
// offline-override-banner.ts) liegen, sonst zeigt der Banner faelschlich
// „Cloud nicht erreichbar", obwohl der Socket steht. Der Pull-Worker laeuft
// im Push-Modus nur als 5min-Safety-Net und kann den Heartbeat allein nicht
// frisch halten.
const CONTACT_HEARTBEAT_MS = 30_000

/**
 * Routet einen Service aus dem `changed`-Event auf den passenden Pull-Pfad:
 * `businessdays` über den dedizierten Worker (reconcilet zusätzlich
 * `location.currentBusinessDay` lokal), `printer-commands` über die
 * Kommando-Queue (claim → ausführen → zurückmelden), alles Übrige über den
 * cursor-basierten Stammdaten-Pull.
 *
 * Auf Modulebene und exportiert, damit die Weiche testbar ist: ein Service, der
 * faelschlich im Stammdaten-Zweig landet, ruft `/sync-pull?service=…` — und der
 * antwortet fuer alles ausserhalb der `SyncableMasterDataService`-Allowlist mit
 * einem Fehler statt mit Daten.
 */
export const runServicePull = (app: Application, service: string): Promise<unknown> => {
  if (service === BUSINESS_DAYS_SERVICE) return pullBusinessDaysOnce(app)
  if (service === PRINTER_COMMANDS_SERVICE) return pullPrinterCommandsOnce(app)
  return pullMasterDataServiceOnce(app, service)
}

export interface CloudRealtimeWorkerHandle {
  stop(): void
}

export const startCloudRealtimeWorker = async (app: Application): Promise<CloudRealtimeWorkerHandle> => {
  let socket: Socket | null = null
  let activeToken: string | null = null
  let activeUrl: string | null = null
  let supervisorTimer: NodeJS.Timeout | null = null
  let contactTimer: NodeJS.Timeout | null = null
  const pullTimers = new Map<string, NodeJS.Timeout>()
  let stopped = false

  // Hält `lastCloudContactAt` frisch, solange der Socket verbunden ist (lokaler
  // Patch, kein Cloud-Roundtrip). Der lebende, authentifizierte Socket IST der
  // Erreichbarkeitsbeweis. NICHT `lastBusinessDaysPullAt` anfassen — das ist der
  // Pull-Cursor; ein Vorrücken ohne echten Pull würde Records überspringen.
  const touchCloudContact = async (): Promise<void> => {
    try {
      const connection = await getActiveConnection(app).catch(() => null)
      if (!connection) return
      await (app.service('cloud-connection') as any).patch(
        connection._id,
        { lastCloudContactAt: new Date().toISOString() },
        { provider: undefined },
      )
    } catch {
      // best-effort — Heartbeat-Fehler dürfen den Worker nicht stören
    }
  }

  const startContactHeartbeat = (): void => {
    if (contactTimer) return
    void touchCloudContact()
    contactTimer = setInterval(() => void touchCloudContact(), CONTACT_HEARTBEAT_MS)
  }

  const stopContactHeartbeat = (): void => {
    if (contactTimer) {
      clearInterval(contactTimer)
      contactTimer = null
    }
  }

  const schedulePull = (service: string): void => {
    const existing = pullTimers.get(service)
    if (existing) clearTimeout(existing)
    pullTimers.set(
      service,
      setTimeout(() => {
        pullTimers.delete(service)
        void runServicePull(app, service).catch(err =>
          logger.warn({
            message: 'Realtime-getriggerter Pull fehlgeschlagen',
            event: 'sync.realtime.trigger_pull_failed',
            service,
            errorMessage: err instanceof Error ? err.message : String(err),
          }),
        )
      }, TRIGGER_DEBOUNCE_MS),
    )
  }

  const triggerServices = (services: string[] | undefined): void => {
    if (!Array.isArray(services)) return
    for (const service of services) {
      if (typeof service === 'string' && service.length > 0) schedulePull(service)
    }
  }

  const teardownSocket = (): void => {
    stopContactHeartbeat()
    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
      socket = null
    }
    activeToken = null
    activeUrl = null
    setRealtimeConnected(false)
  }

  const connectSocket = (cloudUrl: string, edgeToken: string): void => {
    teardownSocket()
    activeToken = edgeToken
    activeUrl = cloudUrl

    const s = io(cloudUrl, {
      path: CLOUD_SOCKET_PATH,
      transports: ['websocket'],
      // Handshake-Auth: die Cloud (registerEdgeAuthListener) liest
      // `socket.handshake.auth.edgeToken`, validiert ihn und joint die
      // Connection exklusiv in `edge/<cloudEdgeId>`.
      //
      // Als FUNKTION statt statischem Objekt: socket.io-client wertet sie bei
      // JEDEM (Re-)Handshake aus. Ein statisches `auth: { edgeToken }` friert
      // den Token vom Connect-Zeitpunkt ein — nach einer Token-Rotation
      // (HTTP-Sync-Heartbeat) wuerde jeder Auto-Reconnect mit dem stalen Token
      // abgelehnt, bis der 30s-Supervisor eingreift. Hier wird der aktuelle
      // Token frisch aus der DB gelesen; `activeToken` wird mitgezogen, damit
      // der Rotations-Vergleich des Supervisors konsistent bleibt. Fallback
      // auf den Closure-Token, falls die DB kurzzeitig nicht lesbar ist.
      auth: cb => {
        void (async () => {
          try {
            const connection = await getActiveConnection(app).catch(() => null)
            const fresh = connection ? decryptCloudToken(connection.cloudToken) : null
            if (fresh) activeToken = fresh
            cb({ edgeToken: fresh ?? edgeToken })
          } catch {
            cb({ edgeToken })
          }
        })()
      },
      reconnection: true,
      reconnectionDelay: RECONNECTION_DELAY_MS,
      reconnectionDelayMax: RECONNECTION_DELAY_MAX_MS,
      randomizationFactor: RANDOMIZATION_FACTOR,
    })

    s.on('connect', () => {
      setRealtimeConnected(true)
      logger.info({ message: 'Cloud-Realtime verbunden', event: 'sync.realtime.connected' })
    })

    s.on('edge:authenticated', (ack: { success?: boolean; error?: string }) => {
      if (ack?.success) {
        setRealtimeConnected(true)
        startContactHeartbeat()
        logger.info({ message: 'Cloud-Realtime authentifiziert', event: 'sync.realtime.authenticated' })
      } else {
        setRealtimeConnected(false)
        stopContactHeartbeat()
        logger.warn({
          message: 'Cloud-Realtime-Auth abgelehnt',
          event: 'sync.realtime.auth_rejected',
          errorMessage: ack?.error,
        })
        // Nicht auf den regulaeren 30s-Takt warten: der Supervisor liest den
        // aktuellen Token aus der DB und reconnectet, falls er rotiert ist.
        // Ist der Token unveraendert (echt widerrufen/abgelaufen), tut der
        // Lauf nichts — kein Reconnect-Loop.
        scheduleSupervise(2_000)
      }
    })

    s.on('disconnect', (reason: string) => {
      setRealtimeConnected(false)
      stopContactHeartbeat()
      logger.info({ message: 'Cloud-Realtime getrennt', event: 'sync.realtime.disconnected', reason })
    })

    s.on('connect_error', (err: Error) => {
      setRealtimeConnected(false)
      logger.warn({
        message: 'Cloud-Realtime Verbindungsfehler',
        event: 'sync.realtime.connect_error',
        errorMessage: err?.message,
      })
    })

    // Feathers SocketIO sendet Custom-Service-Events als `<path> <event>`.
    s.on(`${EDGE_EVENTS_PATH} ${EdgeEventName.CHANGED}`, (data: EdgeChangedEvent) => {
      logger.info({
        message: 'Edge-Event empfangen: changed',
        event: 'sync.realtime.changed',
        services: data?.services,
      })
      triggerServices(data?.services)
    })

    s.on(`${EDGE_EVENTS_PATH} ${EdgeEventName.FORCE_SYNC}`, (data?: EdgeForceSyncEvent) => {
      // Cloud-getriggerter Sofort-Cycle (Admin/Owner klickt "Jetzt synchroni-
      // sieren" in der Cloud-UI). Voller Scheduler-Cycle wird durch das
      // Single-Flight-Mutex `triggerImmediateCycle` ausgefuehrt — Coalescing
      // verhindert Parallel-Runs mit dem periodischen Tick.
      const correlationId = data?.correlationId
      const scope = data?.scope ?? 'full-cycle'
      logger.info({
        message: 'Edge-Event empfangen: force-sync',
        event: 'sync.trigger.received',
        scope,
        correlationId,
        requestedByUserId: data?.requestedByUserId,
      })
      // Edge-seitiges Audit-Event: belegt forensisch, dass der Edge den
      // Trigger empfangen hat. Wird ueber den bestehenden audit-events-Sync
      // automatisch in die Cloud repliziert — der Admin sieht in der
      // Cloud-Audit-Trail dann zwei Records mit derselben correlationId:
      // Cloud-Dispatch + Edge-Empfang.
      void writeForceSyncReceivedAudit(app, data).catch(err =>
        logger.warn({
          message: 'force-sync Audit-Event konnte nicht geschrieben werden',
          event: 'sync.trigger.audit_write_failed',
          correlationId,
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
      )
      void triggerImmediateCycle(app, SyncRunTrigger.CLOUD_PUSH).catch(err =>
        logger.warn({
          message: 'force-sync Cycle fehlgeschlagen',
          event: 'sync.trigger.cycle.failed',
          correlationId,
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
      )
    })

    s.on(`${EDGE_EVENTS_PATH} ${EdgeEventName.REVOKED}`, (data: EdgeRevokedEvent) => {
      logger.warn({
        message: 'Edge-Event empfangen: revoked — Socket wird getrennt',
        event: 'sync.realtime.revoked',
        reason: data?.reason,
      })
      // Socket trennen; das Re-Pairing übernimmt der HTTP-Sync-Pfad
      // (handleCloudAuthError) beim nächsten 401.
      teardownSocket()
    })

    socket = s
  }

  // Hält den Socket-Zustand mit dem Pairing-Zustand konsistent:
  //  - kein aktives Pairing / kein Token → Socket trennen
  //  - aktives Pairing + (kein Socket | Token rotiert | URL geändert) → verbinden
  const supervise = async (): Promise<void> => {
    if (stopped) return
    try {
      const connection = await getActiveConnection(app).catch(() => null)
      if (!connection) {
        if (socket) teardownSocket()
      } else {
        const token = decryptCloudToken(connection.cloudToken)
        if (!token) {
          if (socket) teardownSocket()
        } else if (!socket || token !== activeToken || connection.cloudUrl !== activeUrl) {
          connectSocket(connection.cloudUrl, token)
        }
      }
    } catch (err) {
      logger.warn({
        message: 'Cloud-Realtime-Supervisor-Fehler',
        event: 'sync.realtime.supervisor_error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
    scheduleSupervise(SUPERVISOR_INTERVAL_MS)
  }

  // Plant den naechsten Supervisor-Lauf und ersetzt einen bereits anstehenden
  // Timer — Einsprungpunkt fuer den regulaeren 30s-Takt UND fuer
  // ausserplanmaessige Sofort-Laeufe (abgelehnte Socket-Auth). Deklaration als
  // function (hoisted), damit supervise() und connectSocket() sie unabhaengig
  // von der Definitionsreihenfolge referenzieren koennen.
  function scheduleSupervise(delayMs: number): void {
    if (stopped) return
    if (supervisorTimer) clearTimeout(supervisorTimer)
    supervisorTimer = setTimeout(() => void supervise(), delayMs)
  }

  // Erststart leicht verzögert (analog Pull-Worker), damit Bootstrap/Pairing
  // sich zuerst stabilisieren kann.
  scheduleSupervise(5_000)
  logger.info({ message: 'Cloud-Realtime-Worker gestartet', event: 'sync.realtime.started' })

  return {
    stop: () => {
      stopped = true
      if (supervisorTimer) clearTimeout(supervisorTimer)
      for (const timer of pullTimers.values()) clearTimeout(timer)
      pullTimers.clear()
      teardownSocket()
    },
  }
}

/**
 * Schreibt ein Audit-Event "force-sync empfangen" in die lokale audit-events-
 * Tabelle. Wird ueber den bestehenden audit-events-Sync-Pfad automatisch in
 * die Cloud repliziert (audit-events ist SyncableTransactionService).
 *
 * Actor:
 *   - userId: requestedByUserId aus dem Payload (Cloud-User, der den Trigger
 *     ausgeloest hat). Faellt auf den `cloudEdgeId` zurueck, wenn nicht
 *     uebermittelt wurde — der Edge selbst ist dann der „Akteur" (legacy
 *     v1-Caller ohne v2-Payload).
 *   - role: 'system' (kein User-Login auf dem Edge involviert).
 */
const writeForceSyncReceivedAudit = async (app: Application, payload?: EdgeForceSyncEvent): Promise<void> => {
  const connection = await getActiveConnection(app).catch(() => null)
  if (!connection?.tenantId) return
  const correlationId = payload?.correlationId ?? uuidv7()
  const actorUserId = payload?.requestedByUserId ?? payload?.cloudEdgeId ?? connection._id
  const cloudEdgeId = payload?.cloudEdgeId ?? connection.cloudEdgeId ?? connection._id

  const event: AuditEventData = {
    _id: uuidv7(),
    tenantId: connection.tenantId,
    locationId: (connection.locationId ?? null) as unknown as string,
    occurredAt: new Date().toISOString(),
    actor: {
      userId: actorUserId,
      role: 'system',
      requestId: correlationId,
    },
    target: {
      resource: syncTriggersPath,
      entityType: 'cloud-edge',
      entityId: cloudEdgeId,
    },
    action: AuditAction.SYNC_TRIGGER,
    category: AuditCategory.CONFIGURATION,
    outcome: AuditOutcome.SUCCESS,
    severity: AuditSeverity.NOTICE,
    metadata: {
      source: 'edge-received',
      scope: payload?.scope ?? 'full-cycle',
      requestedByUserId: payload?.requestedByUserId,
      requestedAt: payload?.requestedAt,
    },
    correlationId,
    actor_userId: actorUserId,
    target_resource: syncTriggersPath,
    target_entityType: 'cloud-edge',
    target_entityId: cloudEdgeId,
  }
  const persisted: Record<string, unknown> = { ...(event as unknown as Record<string, unknown>) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (app.service('audit-events' as any) as any).create(persisted as any, { provider: undefined } as any)
}
