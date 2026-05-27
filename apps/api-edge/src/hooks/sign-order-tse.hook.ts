import { logger } from '@panary/shared-backend'
import {
  tseInfoFromError,
  tseInfoFromSignature,
  tseInfoFromStart,
  tseRefFromInfo,
  type OrderTseInfo,
} from '@panary/tse/domain'

import type { HookContext } from '../declarations'

const resolveClientId = (context: HookContext): string => {
  const user = context.params.user as { deviceId?: string; _id?: string } | undefined
  return user?.deviceId ?? user?._id ?? 'edge'
}

// before.create der orders: startet die TSE-Transaktion (nach
// assignDailySequenceNumber) und legt den Start-Snapshot in `order.tse` ab.
// Ist TSE inaktiv (`tsePort` nicht gesetzt) → No-Op. NIE blockierend (KassenSichV
// §146a): ein Ausfall markiert den Bon als 'unavailable' (nachzusignieren), die
// Order wird trotzdem angelegt.
export const signOrderTseStart = async (context: HookContext): Promise<HookContext> => {
  const tsePort = context.app.get('tsePort')
  if (!tsePort) return context

  const data = context.data as { dailySequenceNumber?: number; tse?: OrderTseInfo | null } | undefined
  if (!data || typeof data.dailySequenceNumber !== 'number' || data.tse) return context

  const clientId = resolveClientId(context)
  try {
    const ref = await tsePort.startTransaction({ clientId, transactionNumber: data.dailySequenceNumber })
    data.tse = tseInfoFromStart(ref)
  } catch (err) {
    data.tse = tseInfoFromError({ transactionNumber: data.dailySequenceNumber, clientId, error: err })
    logger.warn({
      message: 'TSE-Start fehlgeschlagen — Order wird unsigniert angelegt (nachzusignieren)',
      event: 'tse.order_start_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
  return context
}

// before.patch der orders: schließt die TSE-Transaktion beim Übergang auf
// 'completed' ab und schreibt die Signatur in `order.tse`. Lädt den Start-Snapshot
// aus dem aktuellen Datensatz. NIE blockierend (§146a).
export const signOrderTseFinish = async (context: HookContext): Promise<HookContext> => {
  const tsePort = context.app.get('tsePort')
  if (!tsePort) return context

  const data = context.data as
    | { status?: string; payment?: { totalAmount?: number } | null; tse?: OrderTseInfo | null }
    | undefined
  if (!data || data.status !== 'completed' || context.id == null) return context

  let existing: OrderTseInfo | undefined
  let amountCents = 0
  try {
    const current = await context.app.service('orders').get(String(context.id), { provider: undefined })
    existing = ((data.tse ?? (current.tse as OrderTseInfo | null | undefined)) ?? undefined) as OrderTseInfo | undefined
    // payment.totalAmount wird als Währungseinheit interpretiert → Cent. Der
    // echte Provider-Adapter härtet die Einheit später ab.
    amountCents = Math.round((data.payment?.totalAmount ?? current.payment?.totalAmount ?? 0) * 100)
  } catch {
    return context
  }
  if (!existing || existing.status !== 'started') return context

  try {
    const signature = await tsePort.finishTransaction(tseRefFromInfo(existing), { amountCents })
    data.tse = tseInfoFromSignature(existing, signature)
  } catch (err) {
    data.tse = tseInfoFromError({
      transactionNumber: existing.transactionNumber,
      clientId: existing.clientId,
      provider: existing.provider,
      error: err,
    })
    logger.warn({
      message: 'TSE-Abschluss fehlgeschlagen — Bon bleibt nachzusignieren',
      event: 'tse.order_finish_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
  return context
}
