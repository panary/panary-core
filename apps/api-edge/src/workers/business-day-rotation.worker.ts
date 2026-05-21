// Business-Day-Rotation-Worker (Standalone).
//
// Rotiert den Geschaeftstag im Standalone-Modus automatisch zur konfigurierten
// lokalen Stunde — ohne Server-Neustart und ohne auf den ersten Order des
// neuen Tages warten zu muessen. Schliesst die Luecke, dass `autoEnsureBusinessDay`
// bisher nur EINMAL beim Boot lief: lief der Edge ueber Mitternacht durch, blieb
// der Geschaeftstag bis zur naechsten Bestellung auf dem Vortag stehen.
//
// Der Worker ruft die bestehende `autoEnsureBusinessDay`-Logik (Boot-Pfad)
// zeitgesteuert auf. Diese kapselt bereits: `systemMode === 'standalone'`-Gate,
// `isLocalRotationAllowed` (Cloud-Managed-Hybrid), Location-Iteration,
// `shouldAutoRotate`, den Aktive-Orders-Block und `rotateBusinessDay`. Im
// CONNECTED-Modus ueberspringt `autoEnsureBusinessDay` selbst — kein doppelter
// Gate hier noetig.
import { logger } from '@panary/shared-backend'

import { autoEnsureBusinessDay } from '../bootstrap-business-day'
import type { Application } from '../declarations'

interface BusinessDayRotationConfig {
  enabled: boolean
  hour: number // 0-23, lokale Server-Zeit (Cron-Stunde)
  minuteJitterMs: number // Random-Delay vor jedem Lauf, vermeidet Cluster-Effekte
}

// hour: 4 lokal ist in CET/CEST (UTC+1/+2) sicher nach UTC-Mitternacht —
// `autoEnsureBusinessDay` ankert `today` auf das UTC-Datum, eine niedrigere
// Stunde koennte in CEST noch im UTC-Vortag liegen und nicht rotieren.
const DEFAULT_CONFIG: BusinessDayRotationConfig = {
  enabled: true,
  hour: 4,
  minuteJitterMs: 60_000,
}

interface SchedulerHandle {
  stop: () => void
}

/**
 * Startet den Rotations-Worker. Plant den naechsten Lauf zur konfigurierten
 * Stunde (lokale Zeit). Liefert ein Handle, das in Tests/Tear-Down gestoppt
 * werden kann.
 */
export const startBusinessDayRotationWorker = (
  app: Application,
  configOverride?: Partial<BusinessDayRotationConfig>,
): SchedulerHandle => {
  const config: BusinessDayRotationConfig = {
    ...DEFAULT_CONFIG,
    ...((app.get('businessDayRotation') as Partial<BusinessDayRotationConfig> | undefined) ?? {}),
    ...(configOverride ?? {}),
  }

  if (!config.enabled) {
    logger.info({
      message: 'Business-Day-Rotation-Worker deaktiviert (config.businessDayRotation.enabled=false)',
      event: 'businessday.rotation.disabled',
    })
    return { stop: () => undefined }
  }

  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const scheduleNext = () => {
    if (stopped) return
    const delayMs = computeDelayUntilHour(config.hour) + Math.random() * config.minuteJitterMs
    timer = setTimeout(() => {
      void runOnce(app).finally(scheduleNext)
    }, delayMs)
  }

  scheduleNext()
  logger.info({
    message: 'Business-Day-Rotation-Worker gestartet',
    event: 'businessday.rotation.scheduled',
    hour: config.hour,
  })

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

/**
 * Fuehrt einen einzelnen Rotations-Lauf aus. Exportiert fuer Tests und manuelle
 * Trigger.
 */
export const runOnce = async (app: Application): Promise<void> => {
  const startedAt = Date.now()
  try {
    await autoEnsureBusinessDay(app)
    logger.info({
      message: 'Business-Day-Rotation-Lauf abgeschlossen',
      event: 'businessday.rotation.done',
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    logger.error({
      message: 'Business-Day-Rotation-Lauf mit Fehler abgebrochen',
      event: 'businessday.rotation.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startedAt,
    })
  }
}

// Liefert die Millisekunden bis zum naechsten Auftreten der gegebenen Stunde
// in lokaler Server-Zeit. `targetHour` 4 → naechster 04:00 lokal.
const computeDelayUntilHour = (targetHour: number): number => {
  const now = new Date()
  const target = new Date(now)
  target.setHours(targetHour, 0, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime() - now.getTime()
}
