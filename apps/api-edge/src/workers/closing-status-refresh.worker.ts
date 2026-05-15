// Closing-Status-Refresh-Worker.
//
// Pollt periodisch alle BusinessDays mit Status 'closing-requested' oder
// 'closing-aggregating' und ruft pro Match die Custom-Method
// `businessdays.refreshClosingStatus({ businessDayId })` auf.
//
// Hintergrund: nach einem closeDay()-Trigger laeuft die Aggregation in der
// Cloud. Der Edge bekommt das Endergebnis ueber refreshClosingStatus
// nachgezogen — entweder durch UI-Pull (POS-Wizard polled) oder durch
// diesen Worker. Damit sieht der Manager im POS spaetestens nach
// `intervalMs` den finalen Status, auch ohne UI-Refresh.
//
// Pattern angelehnt an sync-runs-cleanup.worker.ts: setTimeout-Rekursion mit
// Jitter, sauberer Stop, Wide-Event-Logging pro Tick.
import { logger } from '@panary-core/shared-backend'

import type { Application } from '../declarations'

interface ClosingStatusRefreshConfig {
  enabled: boolean
  intervalMs: number       // typische Tick-Frequenz
  jitterMs: number         // ±jitter um Spitzen bei mehreren Edges zu vermeiden
  /** Maximale Anzahl Tage, die pro Tick refresht werden. Begrenzt Cloud-Roundtrips. */
  maxPerTick: number
}

const DEFAULT_CONFIG: ClosingStatusRefreshConfig = {
  enabled: true,
  intervalMs: 30_000,      // alle 30s
  jitterMs: 5_000,         // ±5s
  maxPerTick: 5,
}

interface SchedulerHandle {
  stop: () => void
}

interface BusinessDayRow {
  _id: string
  status?: string
  tenantId?: string
  locationId?: string | null
}

export const startClosingStatusRefreshWorker = (
  app: Application,
  configOverride?: Partial<ClosingStatusRefreshConfig>,
): SchedulerHandle => {
  const config: ClosingStatusRefreshConfig = {
    ...DEFAULT_CONFIG,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(((app as any).get('closingStatusRefresh') as Partial<ClosingStatusRefreshConfig> | undefined) ?? {}),
    ...(configOverride ?? {}),
  }

  if (!config.enabled) {
    logger.info({
      message: 'Closing-Status-Refresh-Worker deaktiviert',
      event: 'business_day.refresh.disabled',
    })
    return { stop: () => undefined }
  }

  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const scheduleNext = () => {
    if (stopped) return
    const delayMs = config.intervalMs + (Math.random() * 2 - 1) * config.jitterMs
    timer = setTimeout(() => {
      void runTick(app, config).finally(scheduleNext)
    }, Math.max(1_000, delayMs))
  }

  scheduleNext()
  logger.info({
    message: 'Closing-Status-Refresh-Worker gestartet',
    event: 'business_day.refresh.scheduled',
    intervalMs: config.intervalMs,
    maxPerTick: config.maxPerTick,
  })

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

/**
 * Pro Tick: alle offenen BusinessDays im Closing-Zwischenstatus laden und
 * refreshClosingStatus durchrufen. Defensive Fehlerbehandlung pro Tag —
 * ein einzelner Cloud-Fehler bricht den Tick nicht ab.
 */
export const runTick = async (
  app: Application,
  config: ClosingStatusRefreshConfig,
): Promise<void> => {
  const startedAt = Date.now()
  try {
    const service = (app as unknown as {
      service: (path: string) => {
        find: (params?: unknown) => Promise<unknown>
        refreshClosingStatus: (data: unknown, params?: unknown) => Promise<unknown>
      }
    }).service('businessdays')

    // Pending-Closings finden — provider:undefined umgeht authorize/multiTenancy
    // (worker ist System-Aktor, kein User-Kontext).
    const result = (await service.find({
      query: {
        $or: [{ status: 'closing-requested' }, { status: 'closing-aggregating' }],
        $limit: config.maxPerTick,
      },
      provider: undefined,
    })) as unknown
    const rows = extractRows(result)
    if (rows.length === 0) return

    let refreshed = 0
    let transitioned = 0
    for (const row of rows) {
      try {
        const before = row.status
        // Sicherheits-Stamp fuer den nachgelagerten Service: tenantId muss
        // explizit gesetzt sein, da provider:undefined auch die Multi-Tenancy
        // bypassed. Wir uebergeben den User-Mock aus der Row.
        const fakeUser = { tenantId: row.tenantId, locationId: row.locationId, _id: 'system:closing-refresh-worker' }
        const after = (await service.refreshClosingStatus(
          { businessDayId: row._id },
          { provider: undefined, user: fakeUser } as unknown,
        )) as BusinessDayRow
        refreshed++
        if (after.status && after.status !== before) transitioned++
      } catch (err) {
        logger.warn({
          message: 'Closing-Status-Refresh fuer BusinessDay fehlgeschlagen',
          event: 'business_day.refresh.tick_item_failed',
          businessDayId: row._id,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (refreshed > 0) {
      logger.info({
        message: 'Closing-Status-Refresh-Tick abgeschlossen',
        event: 'business_day.refresh.tick_done',
        refreshedCount: refreshed,
        transitionedCount: transitioned,
        durationMs: Date.now() - startedAt,
      })
    }
  } catch (err) {
    logger.error({
      message: 'Closing-Status-Refresh-Tick mit Fehler abgebrochen',
      event: 'business_day.refresh.tick_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startedAt,
    })
  }
}

function extractRows(result: unknown): BusinessDayRow[] {
  if (!result) return []
  if (Array.isArray(result)) return result as BusinessDayRow[]
  const obj = result as { data?: unknown }
  if (Array.isArray(obj.data)) return obj.data as BusinessDayRow[]
  return []
}
