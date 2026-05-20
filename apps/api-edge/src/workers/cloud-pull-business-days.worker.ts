// Periodischer Pull-Worker fuer `business-days` (Cloud → Edge).
//
// Im Hybrid-Architektur-Modell (siehe panary-cloud/documentation/
// business-days-cloud-managed-adr.md) ist die Cloud Source-of-Truth fuer
// business-days, sobald der Edge mit ihr gepairt ist. `openDay()` und
// `closeDay()` laufen in der Cloud-Admin-UI; der Edge zieht den Lifecycle
// alle 5s, damit:
//
//  - Neue Geschaeftstage in der Edge-SQLite gespiegelt werden
//    (`apply Pulled Records` schreibt via Service-API mit `fromSync: true`).
//  - `location.currentBusinessDay` als Pointer mitgepatcht wird
//    (`reconcileLocationBusinessDay`).
//  - Der `offlineOverrideActiveUntil`-Operator-Flag automatisch wieder
//    auf `null` resettet wird, sobald die Cloud wieder erreichbar ist.
//
// Im DISCONNECTED-Modus pausiert der Worker komplett (5 Min Backoff,
// damit `cloud-connection.find()` nicht den Event-Loop blockiert) — dort
// uebernimmt `rotateBusinessDay()` im Edge-Standalone-Modus die lokale
// Tagesgenerierung.

import { logger } from '@panary-core/shared-backend'
import type { Application } from '../declarations'
import { decryptCloudToken } from '../utils/cloud-token-cipher'
import {
  applyPulledRecords,
  pullMasterDataPage,
  reconcileLocationBusinessDay,
} from './cloud-bootstrap-runner.worker'
import { getActiveConnection } from './cloud-sync-scheduler.worker'

/** Polling-Intervall im CONNECTED-Modus. */
const PULL_INTERVAL_MS = 5_000

/**
 * Polling-Intervall im DISCONNECTED-Modus (kein Pairing aktiv). Lang
 * genug, dass der Event-Loop nicht von leeren `find()`-Aufrufen belastet
 * wird; kurz genug, dass das Pairing nach Reconnect-Versuch innerhalb
 * weniger Minuten greift.
 */
const IDLE_BACKOFF_MS = 5 * 60 * 1000

/** Service-Name in der Master-Data-Allowlist + Edge-SQLite-Tabelle. */
const BUSINESS_DAYS_SERVICE = 'businessdays'

export interface BusinessDaysPullWorkerHandle {
  stop(): void
}

export const startBusinessDaysPullWorker = async (
  app: Application,
): Promise<BusinessDaysPullWorkerHandle> => {
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  const tick = async (): Promise<void> => {
    if (stopped) return

    const connection = await getActiveConnection(app).catch(() => null)
    if (!connection) {
      // Kein CONNECTED-Pairing → Idle. `rotateBusinessDay()` im Edge-
      // Standalone-Modus uebernimmt die Tagesgenerierung lokal.
      timer = setTimeout(() => void tick(), IDLE_BACKOFF_MS)
      return
    }

    const cloudToken = decryptCloudToken(connection.cloudToken)
    if (!cloudToken) {
      logger.warn({
        message: 'BusinessDays-Pull: cloudToken fehlt — Tick uebersprungen',
        event: 'sync.pull.business_days_token_missing',
      })
      timer = setTimeout(() => void tick(), IDLE_BACKOFF_MS)
      return
    }

    try {
      // Incremental: `since` = letzter erfolgreicher Pull. Beim allerersten
      // Run nach Migration ist das `null` → Cloud antwortet mit allen
      // tenant-Records bis zum `$limit` (sicherer Fallback).
      const since = connection.lastBusinessDaysPullAt ?? undefined
      const response = await pullMasterDataPage(
        connection.cloudUrl,
        cloudToken,
        BUSINESS_DAYS_SERVICE,
        since,
        undefined,
      )
      const tickStart = new Date().toISOString()

      if (response.records.length > 0) {
        await applyPulledRecords(app, BUSINESS_DAYS_SERVICE, response.records)
        // Nach jedem nicht-leeren Pull: `location.currentBusinessDay`
        // synchronisieren — Cloud hat moeglicherweise einen neuen Tag
        // geoeffnet oder den aktuellen geschlossen.
        if (connection.tenantId) {
          await reconcileLocationBusinessDay(app, connection.tenantId)
        }
      }

      // Cursor + Offline-Override-Reset in einem Patch. `offlineOverrideActiveUntil`
      // automatisch auf null setzen, sobald Cloud wieder erreichbar war — der
      // Operator-Override ist nur fuer den Ausfall-Zeitraum gedacht und soll
      // bei erfolgreicher Wiederverbindung nicht haengenbleiben.
      const patch: Record<string, unknown> = {
        lastBusinessDaysPullAt: tickStart,
      }
      if (connection.offlineOverrideActiveUntil) {
        patch['offlineOverrideActiveUntil'] = null
      }
      await (app.service('cloud-connection') as any).patch(
        connection._id,
        patch,
        { provider: undefined },
      )
    } catch (err) {
      logger.warn({
        message: 'BusinessDays-Pull fehlgeschlagen',
        event: 'sync.pull.business_days_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      // Bei Fehler kein Cursor-Update — der naechste Tick versucht es
      // erneut mit dem alten `since`. Banner im Admin-Client erkennt das
      // ueber `lastBusinessDaysPullAt`-Staleness (> 60s).
    }

    timer = setTimeout(() => void tick(), PULL_INTERVAL_MS)
  }

  // Erster Tick mit 5s Verzoegerung — damit der Bootstrap-Pull (falls
  // initial gepairt wird) nicht direkt mit unserem Worker konkurriert.
  timer = setTimeout(() => void tick(), 5_000)
  logger.info({
    message: 'BusinessDays-Pull-Worker gestartet',
    event: 'sync.pull.business_days.started',
  })

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
