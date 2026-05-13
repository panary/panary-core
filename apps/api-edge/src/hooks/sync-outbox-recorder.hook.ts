import { uuidv7 } from 'uuidv7'

import { SyncableTransactionService } from '@panary-core/edge-pairing/domain'
import { SyncOp, SyncSource } from '@panary-core/sync/domain'
import { isSyncPushBlockedRole } from '@panary-core/users/domain'
import { logger } from '@panary-core/shared-backend'

import type { HookContext, NextHook } from '../declarations'

// Edge→Cloud-pflichtige Pfade. `audit-events` werden gespiegelt, damit die
// Cloud die Source-of-Truth fuer GoBD-konforme Aufbewahrung uebernimmt.
// `users` propagiert lokale Edge-Patches (z.B. posPin-Wechsel im POS-Client)
// zur Cloud — sonst wuerde der naechste Pull-Cycle den alten Cloud-Hash
// zurueckholen und die lokale Aenderung ueberschreiben. Self-Skip im
// Audit-Recorder verhindert Loops.
//
// Quelle: `SyncableTransactionService`-Enum in @panary-core/edge-pairing/domain.
// Single Source of Truth — die Cloud baut ihre TRANSACTION_ALLOWLIST aus
// demselben Enum. Drift hier waere Ursache fuer "Service X ist im push-Pfad
// nicht erlaubt"-Rejects (siehe Sync-Push Allowlist-Check in der Cloud).
const TRANSACTION_PATHS = new Set<string>(Object.values(SyncableTransactionService))

const METHOD_TO_OP: Record<string, SyncOp | undefined> = {
  create: SyncOp.CREATE,
  patch: SyncOp.PATCH,
  update: SyncOp.PATCH,
  remove: SyncOp.REMOVE,
}

/**
 * Globaler after-Hook: schreibt fuer Edge→Cloud-pflichtige Mutationen einen
 * sync_outbox-Eintrag. Interner Aufruf vom Bootstrap-Runner liefert
 * `params.syncSource = 'backfill'` mit, sonst gilt 'live'.
 */
export const recordSyncOutbox = async (context: HookContext, _next: NextHook) => {
  if (!TRANSACTION_PATHS.has(context.path)) return context
  const op = METHOD_TO_OP[context.method]
  if (!op) return context

  // Eintraege aus dem Sync-Outbox-Service selbst NIEMALS rekursiv aufnehmen.
  if (context.path === 'sync-outbox') return context

  const result = context.result as { _id?: string; role?: string } | undefined
  const entityId = (op === SyncOp.REMOVE ? context.id : result?._id) as string | undefined
  if (!entityId) return context

  // Cloud-Sync-Receiver lehnt Users mit privilegierten Rollen
  // (`platform:*`, `tenant:owner`) explizit ab — diese werden in der Cloud
  // eigenstaendig verwaltet (Owner-Konflikt-Risiko, Platform-Bypass-Risiko).
  // Ohne Edge-Filter wuerden die Records dauerhaft im `rejected`-Zustand
  // landen und Operator-Telemetrie verrauschen. Defense-in-Depth: Cloud bleibt
  // die zweite Verteidigungslinie.
  if (context.path === 'users' && op !== SyncOp.REMOVE && isSyncPushBlockedRole(result?.role)) {
    return context
  }

  const syncSource = (context.params as any)?.syncSource ?? SyncSource.LIVE
  const occurredAt = (result as any)?.updatedAt ?? new Date().toISOString()

  try {
    await context.app.service('sync-outbox' as any).create(
      {
        _id: uuidv7(),
        service: context.path,
        op,
        entityId,
        payload: op === SyncOp.REMOVE ? null : result,
        occurredAt,
        syncSource,
      },
      { provider: undefined } as any,
    )
  } catch (err) {
    logger.warn({
      message: 'Outbox-Eintrag konnte nicht geschrieben werden',
      event: 'sync.outbox.record_failed',
      service: context.path,
      method: context.method,
      entityId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
  return context
}
