// Sync-Runs-Cleanup-Worker.
//
// Loescht nightly Sync-Run-Eintraege, die aelter als `retentionDays` sind.
// Anders als audit-cleanup keine Append-only-Trigger zu umgehen — sync-runs
// ist Operations-Telemetrie, kein Audit-Trail. Direkter DELETE via knex.
//
// Schedule: taeglich um lokale Stunde 3 (Standard, nach audit-cleanup um 2).
// Der naechste Lauf wird per setTimeout geplant; Jitter vermeidet Cluster-
// Effekte bei mehreren Edges in der gleichen TZ.
import { logger } from '@panary/shared-backend'

import type { Application } from '../declarations'

interface SyncRunsCleanupConfig {
  enabled: boolean
  retentionDays: number
  hour: number // 0-23, lokale Server-Zeit
  minuteJitterMs: number
}

const DEFAULT_CONFIG: SyncRunsCleanupConfig = {
  enabled: true,
  retentionDays: 30,
  hour: 3,
  minuteJitterMs: 5 * 60 * 1000,
}

interface SchedulerHandle {
  stop: () => void
}

export const startSyncRunsCleanupWorker = (
  app: Application,
  configOverride?: Partial<SyncRunsCleanupConfig>,
): SchedulerHandle => {
  const config: SyncRunsCleanupConfig = {
    ...DEFAULT_CONFIG,
    // app.get akzeptiert nur die in declarations.ts whitelisted Keys —
    // `syncRunsCleanup` ist optional und nicht enumeriert. as-Cast bewusst.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(((app as any).get('syncRunsCleanup') as Partial<SyncRunsCleanupConfig> | undefined) ?? {}),
    ...(configOverride ?? {}),
  }

  if (!config.enabled) {
    logger.info({
      message: 'Sync-Runs-Cleanup-Worker deaktiviert',
      event: 'sync.runs.cleanup.disabled',
    })
    return { stop: () => undefined }
  }

  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const scheduleNext = () => {
    if (stopped) return
    const delayMs = computeDelayUntilHour(config.hour) + Math.random() * config.minuteJitterMs
    timer = setTimeout(() => {
      void runOnce(app, config).finally(scheduleNext)
    }, delayMs)
  }

  scheduleNext()
  logger.info({
    message: 'Sync-Runs-Cleanup-Worker gestartet',
    event: 'sync.runs.cleanup.scheduled',
    retentionDays: config.retentionDays,
    hour: config.hour,
  })

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

export const runOnce = async (
  app: Application,
  config: SyncRunsCleanupConfig,
): Promise<void> => {
  const startedAt = Date.now()
  try {
    const knex = app.get('sqliteClient') as
      | (import('knex').Knex & ((table: string) => unknown))
      | undefined
    if (!knex) {
      logger.error({
        message: 'Sync-Runs-Cleanup abgebrochen — kein sqliteClient verfuegbar',
        event: 'sync.runs.cleanup.no_db',
      })
      return
    }

    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString()
    const deleted = await knex('sync-runs').where('createdAt', '<', cutoff).del()

    if (deleted > 0) {
      logger.info({
        message: 'Sync-Runs-Cleanup abgeschlossen',
        event: 'sync.runs.cleanup.done',
        deletedCount: deleted,
        cutoff,
        durationMs: Date.now() - startedAt,
      })
    }
  } catch (err) {
    logger.error({
      message: 'Sync-Runs-Cleanup mit Fehler abgebrochen',
      event: 'sync.runs.cleanup.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startedAt,
    })
  }
}

const computeDelayUntilHour = (targetHour: number): number => {
  const now = new Date()
  const target = new Date(now)
  target.setHours(targetHour, 0, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime() - now.getTime()
}
