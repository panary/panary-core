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
import { logger } from '@panary/shared-backend'

import type { Application } from '../declarations'

interface ClosingStatusRefreshConfig {
  enabled: boolean
  intervalMs: number // typische Tick-Frequenz
  jitterMs: number // ±jitter um Spitzen bei mehreren Edges zu vermeiden
  /** Maximale Anzahl Tage, die pro Tick refresht werden. Begrenzt Cloud-Roundtrips. */
  maxPerTick: number
}

const DEFAULT_CONFIG: ClosingStatusRefreshConfig = {
  enabled: true,
  intervalMs: 30_000, // alle 30s
  jitterMs: 5_000, // ±5s
  maxPerTick: 5,
}

/**
 * So viele Ticks wird ein Tag mit voller Frequenz gepollt, bevor der Backoff
 * greift. Ein normaler Abschluss ist in Sekunden bis wenigen Minuten durch —
 * bei 30s-Ticks deckt das die ersten ~5 Minuten ab, also den Fall, fuer den der
 * Worker gebaut ist (Manager wartet im POS auf den finalen Status).
 */
const FULL_SPEED_ATTEMPTS = 10

/** Obergrenze des Backoffs in Ticks (~1 h bei 30s-Intervall). */
const MAX_BACKOFF_TICKS = 120

/**
 * Ab dieser Verweildauer im Closing-Zwischenstatus gilt ein Tag als haengen
 * geblieben und wird **einmal** als Warnung gemeldet. Quelle ist `updatedAt` des
 * Datensatzes — `refreshClosingStatus` patcht nur bei echter Statusaenderung
 * (fruehes `return` wenn kein `nextStatus`), der Zeitstempel altert also
 * verlaesslich mit.
 */
const STUCK_WARN_AFTER_MS = 60 * 60 * 1000

interface SchedulerHandle {
  stop: () => void
}

interface BusinessDayRow {
  _id: string
  status?: string
  tenantId?: string
  locationId?: string | null
  updatedAt?: string
}

/** Pro-Tag-Zustand des Backoffs. Prozess-lokal — ein Neustart pollt wieder voll. */
interface AttemptState {
  /** Erfolglose Versuche in Folge. */
  attempts: number
  /** Frühester Tick, an dem wieder gepollt werden darf. */
  nextTick: number
  /** Verhindert, dass dieselbe Warnung jeden Tick erneut rausgeht. */
  warned: boolean
}

/**
 * Wartezeit in Ticks nach `attempts` erfolglosen Versuchen: die ersten
 * {@link FULL_SPEED_ATTEMPTS} jeden Tick, danach exponentiell wachsend bis
 * {@link MAX_BACKOFF_TICKS}.
 *
 * Hintergrund: ohne Backoff pollt der Worker einen Tag, der nie aufloest (Cloud
 * hat keinen Report angelegt), fuer immer im 30s-Takt — ein Cloud-Roundtrip je
 * Tag und Tick, rund 2.880 pro Tag und Geschaeftstag, ohne dass sich je etwas
 * aendert.
 */
export function backoffTicks(attempts: number): number {
  if (attempts <= FULL_SPEED_ATTEMPTS) return 1
  const exponent = attempts - FULL_SPEED_ATTEMPTS
  return Math.min(2 ** exponent, MAX_BACKOFF_TICKS)
}

/** Verweildauer im Closing-Status in ms, `null` wenn `updatedAt` fehlt/kaputt ist. */
export function stuckForMs(row: BusinessDayRow, now: number): number | null {
  if (!row.updatedAt) return null
  const since = Date.parse(row.updatedAt)
  if (Number.isNaN(since)) return null
  return now - since
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
  // Backoff-Zustand ueber alle Ticks hinweg — bewusst pro Worker-Instanz, damit
  // `startClosingStatusRefreshWorker` mehrfach (Tests) unabhaengig laeuft.
  const state = createTickState()

  const scheduleNext = () => {
    if (stopped) return
    const delayMs = config.intervalMs + (Math.random() * 2 - 1) * config.jitterMs
    timer = setTimeout(
      () => {
        void runTick(app, config, state).finally(scheduleNext)
      },
      Math.max(1_000, delayMs),
    )
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

/** Ueber Ticks hinweg gehaltener Zustand (Backoff + bereits gemeldete Haenger). */
export interface TickState {
  tick: number
  byDay: Map<string, AttemptState>
}

export const createTickState = (): TickState => ({ tick: 0, byDay: new Map() })

/**
 * Pro Tick: alle offenen BusinessDays im Closing-Zwischenstatus laden und
 * refreshClosingStatus durchrufen. Defensive Fehlerbehandlung pro Tag —
 * ein einzelner Cloud-Fehler bricht den Tick nicht ab.
 *
 * Geloggt wird nur, wenn tatsaechlich etwas passiert ist: eine Statusaenderung
 * (info) oder ein Tag, der ungewoehnlich lange haengt (warn, einmalig je Tag).
 * Ein Tick ohne Neuigkeit schweigt — sonst schreibt der Worker bei einem
 * dauerhaft haengenden Tag alle 30s dieselbe Zeile, und die eine Zeile, die
 * zaehlt, geht darin unter.
 */
export const runTick = async (
  app: Application,
  config: ClosingStatusRefreshConfig,
  state: TickState = createTickState(),
): Promise<void> => {
  const startedAt = Date.now()
  state.tick++
  try {
    const service = (
      app as unknown as {
        service: (path: string) => {
          find: (params?: unknown) => Promise<unknown>
          refreshClosingStatus: (data: unknown, params?: unknown) => Promise<unknown>
        }
      }
    ).service('businessdays')

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
    // Tage, die nicht mehr im Closing-Status sind, aus dem Backoff-Register
    // werfen — sonst waechst die Map ueber die Laufzeit des Prozesses.
    const seen = new Set(rows.map(r => r._id))
    for (const id of state.byDay.keys()) if (!seen.has(id)) state.byDay.delete(id)
    if (rows.length === 0) return

    let refreshed = 0
    let transitioned = 0
    let skipped = 0
    for (const row of rows) {
      const entry = state.byDay.get(row._id) ?? { attempts: 0, nextTick: state.tick, warned: false }
      state.byDay.set(row._id, entry)

      // Einmalige Meldung fuer Tage, die offensichtlich nicht mehr von selbst
      // aufloesen. Ohne sie waere der Zustand nach der Log-Beruhigung unsichtbar.
      const stuckMs = stuckForMs(row, startedAt)
      if (!entry.warned && stuckMs !== null && stuckMs > STUCK_WARN_AFTER_MS) {
        entry.warned = true
        logger.warn({
          message: 'Geschaeftstag haengt im Closing-Status',
          event: 'business_day.refresh.stuck',
          businessDayId: row._id,
          status: row.status,
          stuckForHours: Math.round(stuckMs / 3_600_000),
          attempts: entry.attempts,
        })
      }

      if (state.tick < entry.nextTick) {
        skipped++
        continue
      }

      try {
        const before = row.status
        // Sicherheits-Stamp fuer den nachgelagerten Service: tenantId muss
        // explizit gesetzt sein, da provider:undefined auch die Multi-Tenancy
        // bypassed. Wir uebergeben den User-Mock aus der Row.
        const fakeUser = { tenantId: row.tenantId, locationId: row.locationId, _id: 'system:closing-refresh-worker' }
        const after = (await service.refreshClosingStatus({ businessDayId: row._id }, {
          provider: undefined,
          user: fakeUser,
        } as unknown)) as BusinessDayRow
        refreshed++
        if (after.status && after.status !== before) {
          transitioned++
          // Statuswechsel = der Tag lebt wieder; Backoff zuruecksetzen, damit ein
          // Folgeschritt (closing-requested → aggregating → closed) nicht in der
          // langen Wartezeit haengt.
          entry.attempts = 0
          entry.nextTick = state.tick + 1
          entry.warned = false
        } else {
          entry.attempts++
          entry.nextTick = state.tick + backoffTicks(entry.attempts)
        }
      } catch (err) {
        entry.attempts++
        entry.nextTick = state.tick + backoffTicks(entry.attempts)
        logger.warn({
          message: 'Closing-Status-Refresh fuer BusinessDay fehlgeschlagen',
          event: 'business_day.refresh.tick_item_failed',
          businessDayId: row._id,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Nur bei echter Neuigkeit loggen. Ein Tick, der nur bestaetigt, dass sich
    // nichts geaendert hat, ist keine Information — er war die Quelle der
    // Dauer-Ausgabe im Edge-Terminal.
    if (transitioned > 0) {
      logger.info({
        message: 'Closing-Status-Refresh-Tick abgeschlossen',
        event: 'business_day.refresh.tick_done',
        refreshedCount: refreshed,
        transitionedCount: transitioned,
        skippedByBackoffCount: skipped,
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
