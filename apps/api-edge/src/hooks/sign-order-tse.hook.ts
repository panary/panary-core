import { logger } from '@panary/shared-backend'
import {
  requiresFiscalSignature,
  tseCancellationFromError,
  tseCancellationFromSignature,
  tseInfoFromError,
  tseInfoFromSignature,
  tseInfoFromStart,
  tseRefFromInfo,
  type OrderTseInfo,
} from '@panary/tse/domain'

import type { HookContext } from '../declarations'
import { allocateFiscalCounter } from '../services/fiscal-counters/fiscal-counters'

const resolveClientId = (context: HookContext): string => {
  const user = context.params.user as { deviceId?: string; _id?: string } | undefined
  return user?.deviceId ?? user?._id ?? 'edge'
}

interface FiscalContext {
  /** Soll der Vorgang fiskalisch signiert werden (pos-cashier)? */
  sign: boolean
  /** Authoritative Scope-Felder aus dem Geschäftstag-Snapshot (für den Zähler). */
  tenantId?: string
  locationId?: string
}

// Fiskal-Gate-Quelle: der `operationMode`-Snapshot des Geschäftstags (von
// `openDay` aus der Location übernommen, mit pos-cashier-Default falls die
// Location nicht ladbar war). Bewusst dieselbe Quelle wie `signBusinessDayClose`
// → Order- und Tagesabschluss-Signierung entscheiden auf der Edge konsistent.
// Liefert nebenbei tenantId/locationId für den lückenlosen Fiskal-Zähler — ein
// Read deckt beides ab.
//
// fail-safe Richtung Signatur: lässt sich der Modus nicht ermitteln (kein
// businessDayId, Lookup-Fehler, fehlender Snapshot), wird signiert. Ein
// unsignierter pos-cashier-Bon ist ein Compliance-Defekt (KassenSichV §146a),
// ein über-signierter orders-only-Bon nur Verschwendung. Erst ein DEFINITIV
// als 'orders-only' gelesener Snapshot unterdrückt die Signatur.
const resolveFiscalContext = async (
  context: HookContext,
  businessDayId: string | undefined,
): Promise<FiscalContext> => {
  if (!businessDayId) return { sign: true }
  try {
    const businessDay = (await context.app.service('businessdays').get(businessDayId, {
      query: { $select: ['operationMode', 'tenantId', 'locationId'] },
      provider: undefined,
    })) as { operationMode?: string; tenantId?: string; locationId?: string } | undefined
    const tenantId = businessDay?.tenantId
    const locationId = businessDay?.locationId ?? undefined
    if (!businessDay?.operationMode) return { sign: true, tenantId, locationId }
    return { sign: requiresFiscalSignature({ operationMode: businessDay.operationMode }), tenantId, locationId }
  } catch {
    return { sign: true }
  }
}

// before.create der orders: startet die TSE-Transaktion (nach
// assignDailySequenceNumber) und legt den Start-Snapshot in `order.tse` ab.
// Ist TSE inaktiv (`tsePort` nicht gesetzt) → No-Op. NIE blockierend (KassenSichV
// §146a): ein Ausfall markiert den Bon als 'unavailable' (nachzusignieren), die
// Order wird trotzdem angelegt.
export const signOrderTseStart = async (context: HookContext): Promise<HookContext> => {
  const tsePort = context.app.get('tsePort')
  if (!tsePort) return context

  const data = context.data as
    | {
        dailySequenceNumber?: number
        businessDayId?: string
        tenantId?: string
        locationId?: string
        tse?: OrderTseInfo | null
      }
    | undefined
  if (!data || typeof data.dailySequenceNumber !== 'number' || data.tse) return context

  // Fiskal-Gate (KassenSichV): nur `pos-cashier`-Vorgänge werden signiert,
  // orders-only ist No-Op. Schließt die „signiert jeden Vorgang"-Lücke.
  // `businessDayId` setzt `restrictOrderToBusinessDay` (Hook davor) auf data.
  const fiscal = await resolveFiscalContext(context, data.businessDayId)
  if (!fiscal.sign) return context

  const clientId = resolveClientId(context)

  // Lückenlose, monoton steigende Fiskal-Vorgangsnummer (≠ dailySequenceNumber,
  // die zeitbasierte Bon-/Anzeigenummer bleibt unverändert). Scope aus dem
  // Geschäftstag-Snapshot, Fallback auf die gestempelten data-Felder.
  const tenantId = fiscal.tenantId ?? data.tenantId
  const locationId = fiscal.locationId ?? data.locationId
  let transactionNumber = data.dailySequenceNumber
  if (tenantId && locationId) {
    try {
      transactionNumber = await allocateFiscalCounter(context.app, tenantId, locationId)
    } catch (err) {
      // Zähler-Vergabe fehlgeschlagen → mit dailySequenceNumber signieren statt
      // den Vorgang zu blockieren (§146a). Wird unten als Start-Fehler behandelt,
      // falls auch startTransaction scheitert.
      logger.warn({
        message: 'Fiskal-Zähler-Vergabe fehlgeschlagen — Fallback auf dailySequenceNumber',
        event: 'tse.fiscal_counter_allocation_failed',
        tenantId,
        locationId,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    const ref = await tsePort.startTransaction({ clientId, transactionNumber })
    data.tse = tseInfoFromStart(ref)
  } catch (err) {
    data.tse = tseInfoFromError({ transactionNumber, clientId, error: err })
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
  // Fiskal-Gate transitiv: nur ein in `signOrderTseStart` (also für pos-cashier)
  // gestarteter Vorgang hat einen 'started'-tse-Snapshot. orders-only-Bons werden
  // nie gestartet → hier No-Op, ohne erneuten operationMode-Lookup.
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
    existing = ((data.tse ?? (current.tse as OrderTseInfo | null | undefined)) ?? undefined) as OrderTseInfo | undefined
  } catch {
    return context
  }
  // Nur eine real existierende TSE-Transaktion (gestartet oder signiert) lässt
  // sich stornieren. Bereits storniert (cancellation gesetzt) → idempotent skip.
  if (!existing || (existing.status !== 'signed' && existing.status !== 'started')) return context
  if (existing.cancellation) return context

  const canceledAt = data.cancellation?.canceledAt ?? new Date().toISOString()
  try {
    const signature = await tsePort.cancelTransaction(tseRefFromInfo(existing))
    data.tse = { ...existing, cancellation: tseCancellationFromSignature(signature, canceledAt) }
  } catch (err) {
    data.tse = { ...existing, cancellation: tseCancellationFromError(err, canceledAt) }
    logger.warn({
      message: 'TSE-Storno fehlgeschlagen — Storno bleibt nachzusignieren',
      event: 'tse.order_cancel_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
  return context
}
