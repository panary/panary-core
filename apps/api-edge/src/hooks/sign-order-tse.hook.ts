// Dünner Feathers-Adapter der Order-Signierung (KassenSichV): tsePort-Beschaffung
// (globaler Edge-Port via app.get), Service-Reads und Hook-Wiring leben hier —
// Guards, Fiskal-Gate, Zähler-Regeln und Snapshot-Aufbau sind transportneutral
// in @panary/tse/domain (order-signing-flow, geteilt mit dem Cloud-Hook).
import { logger } from '@panary/shared-backend'
import {
  FISCAL_GATE_BUSINESS_DAY_SELECT,
  canCancelOrderTse,
  canFinishOrderTse,
  cancelOrderTseTransaction,
  finishOrderTseTransaction,
  resolveExistingOrderTse,
  resolveFiscalSignContext,
  resolveOrderTseAmountCents,
  shouldStartOrderTse,
  startOrderTseTransaction,
  type BusinessDayFiscalSnapshot,
  type OrderTseInfo,
  type OrderTseStartData,
} from '@panary/tse/domain'

import type { HookContext } from '../declarations'
import { allocateFiscalCounter } from '../services/fiscal-counters/fiscal-counters'

const resolveClientId = (context: HookContext): string => {
  const user = context.params.user as { deviceId?: string; _id?: string } | undefined
  return user?.deviceId ?? user?._id ?? 'edge'
}

// Transportanbindung des Fiskal-Gates: lädt den Geschäftstag-Snapshot über den
// Edge-Service. Gate-Entscheidung inkl. fail-safe Richtung Signatur lebt in
// resolveFiscalSignContext (@panary/tse/domain).
const loadBusinessDayFiscalSnapshot =
  (context: HookContext) =>
  async (businessDayId: string): Promise<BusinessDayFiscalSnapshot | undefined> =>
    (await context.app.service('businessdays').get(businessDayId, {
      query: { $select: [...FISCAL_GATE_BUSINESS_DAY_SELECT] },
      provider: undefined,
    })) as BusinessDayFiscalSnapshot | undefined

// before.create der orders: startet die TSE-Transaktion (nach
// assignDailySequenceNumber) und legt den Start-Snapshot in `order.tse` ab.
// Ist TSE inaktiv (`tsePort` nicht gesetzt) → No-Op. NIE blockierend (KassenSichV
// §146a): ein Ausfall markiert den Bon als 'unavailable' (nachzusignieren), die
// Order wird trotzdem angelegt.
export const signOrderTseStart = async (context: HookContext): Promise<HookContext> => {
  const tsePort = context.app.get('tsePort')
  if (!tsePort) return context

  const data = context.data as OrderTseStartData | undefined

  // Edge-Eigenheit: ohne zugewiesene Bon-Nummer wird nicht signiert — sie ist
  // der §146a-Fallback für die Fiskal-Vorgangsnummer. Offline-/Idempotenz-Guards
  // (offlineCreated, bereits gesetzter tse-Snapshot) in shouldStartOrderTse.
  if (!data || typeof data.dailySequenceNumber !== 'number') return context
  if (!shouldStartOrderTse(data)) return context

  // Fiskal-Gate (KassenSichV): nur `pos-cashier`-Vorgänge werden signiert,
  // orders-only ist No-Op. `businessDayId` setzt `restrictOrderToBusinessDay`
  // (Hook davor) auf data.
  const fiscal = await resolveFiscalSignContext(data.businessDayId, loadBusinessDayFiscalSnapshot(context))
  if (!fiscal.sign) return context

  data.tse = await startOrderTseTransaction({
    tsePort,
    clientId: resolveClientId(context),
    fallbackTransactionNumber: data.dailySequenceNumber,
    // Zähler-Scope aus dem Geschäftstag-Snapshot, Fallback auf die gestempelten data-Felder.
    tenantId: fiscal.tenantId ?? data.tenantId,
    locationId: fiscal.locationId ?? data.locationId ?? undefined,
    allocateFiscalCounter: (tenantId, locationId) => allocateFiscalCounter(context.app, tenantId, locationId),
    logger,
  })
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
    existing = resolveExistingOrderTse(data, { tse: current.tse as OrderTseInfo | null | undefined })
    amountCents = resolveOrderTseAmountCents(data, current)
  } catch {
    return context
  }
  if (!canFinishOrderTse(existing)) return context

  data.tse = await finishOrderTseTransaction({ tsePort, existing, amountCents, logger })
  return context
}

// before.patch der orders: signiert den Storno/Refund (KassenSichV: eigener
// fiskalischer Vorgang) beim Übergang auf 'aborted'. Schreibt das Ergebnis in
// `order.tse.cancellation` (Sale-Signatur bleibt erhalten). No-Op ohne aktive
// TSE / ohne signierte Ausgangs-Transaktion / wenn bereits storniert. Nie
// blockierend (§146a). Behebt S2 (cancelTransaction wurde nirgends aufgerufen).
export const signOrderTseCancel = async (context: HookContext): Promise<HookContext> => {
  const tsePort = context.app.get('tsePort')
  if (!tsePort) return context

  const data = context.data as
    | { status?: string; cancellation?: { canceledAt?: string } | null; tse?: OrderTseInfo | null }
    | undefined
  if (!data || data.status !== 'aborted' || context.id == null) return context

  let existing: OrderTseInfo | undefined
  try {
    const current = await context.app.service('orders').get(String(context.id), { provider: undefined })
    existing = resolveExistingOrderTse(data, { tse: current.tse as OrderTseInfo | null | undefined })
  } catch {
    return context
  }
  if (!canCancelOrderTse(existing)) return context

  data.tse = await cancelOrderTseTransaction({
    tsePort,
    existing,
    canceledAt: data.cancellation?.canceledAt ?? new Date().toISOString(),
    logger,
  })
  return context
}
