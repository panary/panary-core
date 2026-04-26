import { logger } from '@panary-core/shared-backend'
import { PairingStatus } from '@panary-core/cloud-connection/domain'
import type { Application } from '../declarations'

const DEFAULT_INTERVAL_SECONDS = 60
const MIN_INTERVAL_SECONDS = 15
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 5 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 10_000

interface CloudConnectionRow {
  _id: string
  tenantId: string
  locationId: string | null
  cloudUrl: string
  pairingStatus: string
  syncEnabled?: boolean
  lastSyncAt?: string
}

const readSharedSecret = (app: Application): string | null => {
  const fromEnv = process.env['EDGE_HEARTBEAT_SECRET']
  if (fromEnv && fromEnv.length >= 8) return fromEnv
  // Optional: konfigurierbar via Edge-Config
  const fromConfig = app.get('edgeHeartbeatSecret' as never) as string | undefined
  if (typeof fromConfig === 'string' && fromConfig.length >= 8) return fromConfig
  return null
}

const readIntervalSeconds = (app: Application): number => {
  const fromEnv = Number.parseInt(process.env['EDGE_HEARTBEAT_INTERVAL_SECONDS'] || '', 10)
  if (Number.isFinite(fromEnv) && fromEnv >= MIN_INTERVAL_SECONDS) return fromEnv
  const fromConfig = app.get('edgeHeartbeatIntervalSeconds' as never) as number | undefined
  if (typeof fromConfig === 'number' && fromConfig >= MIN_INTERVAL_SECONDS) return fromConfig
  return DEFAULT_INTERVAL_SECONDS
}

const readEdgeVersion = (): string => {
  return process.env['EDGE_VERSION'] || process.env['npm_package_version'] || '0.0.0'
}

const loadActiveConnection = async (app: Application): Promise<CloudConnectionRow | null> => {
  try {
    const result = (await app
      .service('cloud-connection')
      .find({ provider: undefined, paginate: false, query: { $limit: 1 } })) as
      | CloudConnectionRow[]
      | { data: CloudConnectionRow[] }
    const list = Array.isArray(result) ? result : result?.data ?? []
    const conn = list.find(
      r => r.pairingStatus === PairingStatus.CONNECTED && r.syncEnabled !== false,
    )
    return conn ?? null
  } catch (err) {
    logger.error({
      message: 'Heartbeat-Worker: cloud-connection-find fehlgeschlagen',
      event: 'edge.heartbeat.find_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

interface HeartbeatPayload {
  tenantId: string
  locationId: string | null
  edgeVersion: string
  lastLocalSyncAt: string | null
}

const sendHeartbeat = async (
  cloudUrl: string,
  secret: string,
  payload: HeartbeatPayload,
): Promise<{ ok: boolean; status: number }> => {
  const url = `${cloudUrl.replace(/\/+$/, '')}/platform-cloud-connections/heartbeat`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { ok: response.ok, status: response.status }
}

class CloudSyncHeartbeatWorker {
  private timer: ReturnType<typeof setTimeout> | null = null
  private consecutiveFailures = 0
  private stopped = false

  constructor(private app: Application) {}

  async start(): Promise<void> {
    const secret = readSharedSecret(this.app)
    if (!secret) {
      logger.warn({
        message: 'Heartbeat-Worker nicht gestartet — EDGE_HEARTBEAT_SECRET fehlt',
        event: 'edge.heartbeat.disabled',
      })
      return
    }
    logger.info({
      message: 'Heartbeat-Worker gestartet',
      event: 'edge.heartbeat.started',
      intervalSeconds: readIntervalSeconds(this.app),
    })
    this.scheduleTick(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleTick(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.tick(), delayMs)
  }

  private async tick(): Promise<void> {
    if (this.stopped) return
    const baseIntervalMs = readIntervalSeconds(this.app) * 1_000

    const connection = await loadActiveConnection(this.app)
    if (!connection) {
      // Keine aktive Cloud-Verbindung — naechsten Tick im normalen Intervall.
      this.scheduleTick(baseIntervalMs)
      return
    }

    const secret = readSharedSecret(this.app)
    if (!secret) {
      this.scheduleTick(baseIntervalMs)
      return
    }

    try {
      const { ok, status } = await sendHeartbeat(connection.cloudUrl, secret, {
        tenantId: connection.tenantId,
        locationId: connection.locationId,
        edgeVersion: readEdgeVersion(),
        lastLocalSyncAt: connection.lastSyncAt ?? null,
      })

      if (!ok) {
        this.consecutiveFailures += 1
        const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1))
        logger.warn({
          message: 'Heartbeat fehlgeschlagen',
          event: 'edge.heartbeat.http_error',
          statusCode: status,
          consecutiveFailures: this.consecutiveFailures,
          retryInMs: backoff,
        })
        this.scheduleTick(backoff)
        return
      }

      if (this.consecutiveFailures > 0) {
        logger.info({
          message: 'Heartbeat-Verbindung wiederhergestellt',
          event: 'edge.heartbeat.recovered',
          afterFailures: this.consecutiveFailures,
        })
        this.consecutiveFailures = 0
      }
      this.scheduleTick(baseIntervalMs)
    } catch (err) {
      this.consecutiveFailures += 1
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1))
      logger.warn({
        message: 'Heartbeat-Request geworfen',
        event: 'edge.heartbeat.exception',
        errorMessage: err instanceof Error ? err.message : String(err),
        consecutiveFailures: this.consecutiveFailures,
        retryInMs: backoff,
      })
      this.scheduleTick(backoff)
    }
  }
}

export const startCloudSyncHeartbeatWorker = async (app: Application): Promise<void> => {
  const worker = new CloudSyncHeartbeatWorker(app)
  await worker.start()
  ;(app as unknown as { _cloudSyncHeartbeatWorker?: CloudSyncHeartbeatWorker })._cloudSyncHeartbeatWorker = worker
}
