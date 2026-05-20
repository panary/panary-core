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

import { logger } from '@panary-core/shared-backend'
import {
  EDGE_EVENTS_PATH,
  EdgeEventName,
  type EdgeChangedEvent,
  type EdgeRevokedEvent,
} from '@panary-core/sync/domain'

import type { Application } from '../declarations'
import { decryptCloudToken } from '../utils/cloud-token-cipher'
import { getActiveConnection, pullMasterDataServiceOnce } from './cloud-sync-scheduler.worker'
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

// Debounce pro Service: ein Bulk-Vorgang in der Cloud (z.B. Katalog-Import mit
// hunderten Produkt-Patches) feuert hunderte `changed`-Events. Statt hunderte
// Pulls auszulösen, coalescen wir gleichartige Trigger zu EINEM Pull ~1s nach
// dem letzten Event (Trailing-Debounce). Der Pull ist cursor-basiert und holt
// alle aufgelaufenen Änderungen in einem Durchlauf.
const TRIGGER_DEBOUNCE_MS = 1_000

export interface CloudRealtimeWorkerHandle {
  stop(): void
}

export const startCloudRealtimeWorker = async (
  app: Application,
): Promise<CloudRealtimeWorkerHandle> => {
  let socket: Socket | null = null
  let activeToken: string | null = null
  let activeUrl: string | null = null
  let supervisorTimer: NodeJS.Timeout | null = null
  const pullTimers = new Map<string, NodeJS.Timeout>()
  let stopped = false

  // Routet einen Service auf den passenden Pull-Pfad: businessdays über den
  // dedizierten Worker (reconcilet zusätzlich location.currentBusinessDay lokal),
  // alle anderen Stammdaten über den cursor-basierten Scheduler-Pull.
  const runServicePull = (service: string): Promise<unknown> =>
    service === BUSINESS_DAYS_SERVICE
      ? pullBusinessDaysOnce(app)
      : pullMasterDataServiceOnce(app, service)

  const schedulePull = (service: string): void => {
    const existing = pullTimers.get(service)
    if (existing) clearTimeout(existing)
    pullTimers.set(
      service,
      setTimeout(() => {
        pullTimers.delete(service)
        void runServicePull(service).catch(err =>
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
      auth: { edgeToken },
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
        logger.info({ message: 'Cloud-Realtime authentifiziert', event: 'sync.realtime.authenticated' })
      } else {
        setRealtimeConnected(false)
        logger.warn({
          message: 'Cloud-Realtime-Auth abgelehnt',
          event: 'sync.realtime.auth_rejected',
          errorMessage: ack?.error,
        })
      }
    })

    s.on('disconnect', (reason: string) => {
      setRealtimeConnected(false)
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

    s.on(`${EDGE_EVENTS_PATH} ${EdgeEventName.FORCE_SYNC}`, () => {
      logger.info({ message: 'Edge-Event empfangen: force-sync', event: 'sync.realtime.force_sync' })
      void pullBusinessDaysOnce(app).catch(() => undefined)
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
    supervisorTimer = setTimeout(() => void supervise(), SUPERVISOR_INTERVAL_MS)
  }

  // Erststart leicht verzögert (analog Pull-Worker), damit Bootstrap/Pairing
  // sich zuerst stabilisieren kann.
  supervisorTimer = setTimeout(() => void supervise(), 5_000)
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
