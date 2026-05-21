// Helper zum Schreiben eines sync-runs-Eintrags aus den Sync-Workern.
//
// Filter-Regel "nur sinnvolle Vorgaenge" (Plan-Entscheidung des Users):
// - bootstrap: IMMER (initialer Sync ist relevant, auch bei 0 Records)
// - push: nur wenn accepted+rejected > 0
// - pull: nur wenn recordCount > 0 ODER outcome != success (Fehler immer)
// - heartbeat: nur wenn tokenRotated == true ODER clockSkew WARN/ERROR
// - reconcile: nur wenn archived > 0
//
// Aufruf: `await recordSyncRun(app, { phase, direction, ..., outcome })`.
// Der Helper prueft selbst den Filter — der Aufrufer muss das nicht.
//
// Fehler beim Schreiben des Sync-Run-Eintrags brechen den Sync-Worker NICHT
// ab: der Eintrag ist Telemetrie, kein kritischer Pfad.

import { uuidv7 } from 'uuidv7'

import { logger } from '@panary/shared-backend'
import {
  SyncRunOutcome,
  SyncRunPhase,
  type SyncRunDirection,
  type SyncRunRecordDetail,
  type SyncRunTrigger,
} from '@panary/sync/domain'

import { syncRunsPath } from './sync-runs'

import type { Application } from '../../declarations'

export interface RecordSyncRunInput {
  tenantId: string
  phase: typeof SyncRunPhase[keyof typeof SyncRunPhase]
  direction: SyncRunDirection
  service?: string | null
  recordCount?: number
  accepted?: number
  rejected?: number
  archived?: number
  durationMs: number
  outcome: typeof SyncRunOutcome[keyof typeof SyncRunOutcome]
  errorMessage?: string
  triggeredBy: SyncRunTrigger
  startedAt: string
  finishedAt?: string
  /**
   * Wenn der sync-run im Rahmen eines Bootstrap-Vorgangs laeuft (Push/Pull/
   * Reconcile waehrend des Pairing-Bootstraps), die ID des bootstrap-report-
   * Datensatzes mitgeben. Erlaubt der UI, alle Detail-Eintraege eines
   * Bootstraps zusammen anzuzeigen.
   */
  bootstrapReportId?: string
  /**
   * Per-Record-Details des Vorgangs (Service/Entity-Typ + entityId + Operation
   * + Status). Wird vom Aufrufer bereits auf MAX_SYNC_RUN_DETAILS gekappt.
   * Leeres/undefiniertes Array → kein `details`-Feld im Eintrag.
   */
  details?: SyncRunRecordDetail[]
}

const isWorthRecording = (input: RecordSyncRunInput): boolean => {
  // Fehler IMMER protokollieren — egal in welcher Phase
  if (input.outcome !== SyncRunOutcome.SUCCESS) return true

  switch (input.phase) {
    case SyncRunPhase.BOOTSTRAP:
      return true // initial sync ist immer relevant
    case SyncRunPhase.PUSH: {
      const accepted = input.accepted ?? 0
      const rejected = input.rejected ?? 0
      return accepted + rejected > 0
    }
    case SyncRunPhase.PULL:
      return (input.recordCount ?? 0) > 0
    case SyncRunPhase.RECONCILE:
      return (input.archived ?? 0) > 0
    case SyncRunPhase.HEARTBEAT:
      // Stille Heartbeats nicht protokollieren — Aufrufer entscheidet via
      // outcome=PARTIAL/FAILURE (Skew/Token-Rotation triggert PARTIAL).
      return false
    default:
      return false
  }
}

export const recordSyncRun = async (
  app: Application,
  input: RecordSyncRunInput,
): Promise<void> => {
  if (!isWorthRecording(input)) return

  const finishedAt = input.finishedAt ?? new Date().toISOString()

  // Failure/Partial IMMER ins Terminal — sonst sieht der Operator nur die UI
  // und das Backend-Log bleibt stumm. Erfolge bleiben absichtlich aus dem
  // Wide-Event-Log raus (sonst Noise: pro Sync-Tick mehrere Erfolgs-Lines).
  if (input.outcome !== SyncRunOutcome.SUCCESS) {
    const logFn = input.outcome === SyncRunOutcome.FAILURE ? logger.warn : logger.info
    logFn.call(logger, {
      message: `Sync-Run ${input.outcome.toLowerCase()}`,
      event: `sync.run.${input.outcome.toLowerCase()}`,
      phase: input.phase,
      direction: input.direction,
      service: input.service,
      recordCount: input.recordCount ?? 0,
      accepted: input.accepted,
      rejected: input.rejected,
      durationMs: input.durationMs,
      triggeredBy: input.triggeredBy,
      errorMessage: input.errorMessage,
    })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app.service(syncRunsPath) as any).create(
      {
        _id: uuidv7(),
        tenantId: input.tenantId,
        phase: input.phase,
        direction: input.direction,
        service: input.service ?? null,
        recordCount: input.recordCount ?? 0,
        accepted: input.accepted,
        rejected: input.rejected,
        archived: input.archived,
        durationMs: input.durationMs,
        outcome: input.outcome,
        errorMessage: input.errorMessage,
        triggeredBy: input.triggeredBy,
        bootstrapReportId: input.bootstrapReportId,
        // Array uebergeben (validateData erwartet ein Array) — Knex serialisiert
        // es in die JSON-TEXT-Spalte. Leeres Array nicht persistieren.
        details: input.details && input.details.length > 0 ? input.details : undefined,
        startedAt: input.startedAt,
        finishedAt,
      },
      { provider: undefined },
    )
  } catch (err) {
    // Sync-Run-Schreiben darf den Worker nie zum Fallen bringen — Telemetrie.
    logger.warn({
      message: 'Sync-Run-Eintrag fehlgeschlagen',
      event: 'sync.run.record_failed',
      phase: input.phase,
      service: input.service,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}
