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
import { isRealtimeConnected } from './cloud-realtime-state'

/** Polling-Intervall im CONNECTED-Modus OHNE aktive Socket-Verbindung (Fallback). */
const PULL_INTERVAL_MS = 5_000

/**
 * Polling-Intervall im CONNECTED-Modus MIT aktiver Socket-Verbindung. Der
 * Realtime-Worker liefert Lifecycle-Wechsel dann ~instant per Push; der Pull
 * läuft nur noch als langsamer Safety-Net (fängt verpasste Events / Socket-
 * Hänger ab, ohne die Cloud im Sekundentakt zu pollen).
 */
const SAFETY_POLL_MS = 5 * 60 * 1000

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

/** Ergebnis eines Pull-Durchlaufs — steuert die Folge-Kadenz im Worker. */
export type BusinessDaysPullOutcome = 'idle' | 'ok' | 'error'

/**
 * Ein einzelner BusinessDays-Pull-Durchlauf (Connection → Token → Pull → Apply
 * → Reconcile → Cursor). Wird sowohl vom periodischen Worker-Tick als auch vom
 * Realtime-Worker (Socket-Push-Trigger) aufgerufen — identischer, auditierter
 * Pfad, kein duplizierter Daten-Code. Idempotent: `applyPulledRecords` nutzt
 * `fromSync: true` (Upsert), Pull + Push-getriggerter Pull dürfen sich
 * überlappen, ohne Inkonsistenz.
 */
export const pullBusinessDaysOnce = async (
  app: Application,
): Promise<BusinessDaysPullOutcome> => {
  const connection = await getActiveConnection(app).catch(() => null)
  if (!connection) {
    // Kein CONNECTED-Pairing → Idle. `rotateBusinessDay()` im Edge-
    // Standalone-Modus uebernimmt die Tagesgenerierung lokal.
    return 'idle'
  }

  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) {
    logger.warn({
      message: 'BusinessDays-Pull: cloudToken fehlt — Tick uebersprungen',
      event: 'sync.pull.business_days_token_missing',
    })
    return 'idle'
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
      // Erfolgreicher HTTP-Pull = Cloud erreichbar → Banner-Heartbeat aktualisieren.
      lastCloudContactAt: tickStart,
    }
    if (connection.offlineOverrideActiveUntil) {
      patch['offlineOverrideActiveUntil'] = null
    }
    await (app.service('cloud-connection') as any).patch(
      connection._id,
      patch,
      { provider: undefined },
    )
    return 'ok'
  } catch (err) {
    logger.warn({
      message: 'BusinessDays-Pull fehlgeschlagen',
      event: 'sync.pull.business_days_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    // Bei Fehler kein Cursor-Update — der naechste Tick versucht es
    // erneut mit dem alten `since`. Banner im Admin-Client erkennt das
    // ueber `lastBusinessDaysPullAt`-Staleness (> 60s).
    return 'error'
  }
}

export const startBusinessDaysPullWorker = async (
  app: Application,
): Promise<BusinessDaysPullWorkerHandle> => {
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  const tick = async (): Promise<void> => {
    if (stopped) return
    const outcome = await pullBusinessDaysOnce(app)
    // Adaptive Kadenz:
    //  - 'idle'  (kein Pairing)        → langer Idle-Backoff
    //  - 'error' (Pull/Apply schlug fehl) → immer schneller 5s-Retry, AUCH bei
    //    aktivem Socket — ein fehlgeschlagener Apply (z.B. Schema-Drift) darf
    //    nicht erst in 5 min erneut versucht werden.
    //  - 'ok'    + Socket aktiv        → langsamer Safety-Poll (Push macht Echtzeit)
    //  - 'ok'    + kein Socket         → 5s-Fallback
    const delay =
      outcome === 'idle'
        ? IDLE_BACKOFF_MS
        : outcome === 'error'
          ? PULL_INTERVAL_MS
          : isRealtimeConnected()
            ? SAFETY_POLL_MS
            : PULL_INTERVAL_MS
    timer = setTimeout(() => void tick(), delay)
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
