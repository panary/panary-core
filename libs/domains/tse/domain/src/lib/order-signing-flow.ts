// Transportneutrale Orchestrierung der zweiphasigen Order-Signierung
// (KassenSichV): Start beim Create, Abschluss beim Übergang → completed,
// Storno beim Übergang → aborted. Bewusst in der Domain-Lib, damit Edge-Hook
// (globaler tsePort, SQLite) und Cloud-Hook (per-Tenant-Port, Mongo) dieselben
// Guards, Zähler-Regeln und Snapshot-Aufbauten teilen — Port-Beschaffung,
// fromSync-Guards und Hook-Wiring bleiben app-seitig. Fehler-Semantik überall
// fail-open (§146a): die TSE darf einen Verkauf NIE blockieren.
import {
  tseCancellationFromError,
  tseCancellationFromSignature,
  tseInfoFromError,
  tseInfoFromSignature,
  tseInfoFromStart,
  tseRefFromInfo,
  type OrderTseInfo,
} from './order-signing'
import type { TsePort } from './tse-port'

// Strukturkompatibel zum Winston-Logger der Apps — die Domain-Lib bleibt frei
// von Logging-Framework-Abhängigkeiten.
export interface TseSigningLogger {
  warn(entry: { message: string; event: string; [key: string]: unknown }): void
}

export interface OrderTseStartData {
  dailySequenceNumber?: number
  businessDayId?: string
  tenantId?: string
  locationId?: string | null
  tse?: OrderTseInfo | null
  offlineCreated?: boolean | null
}

// Start-Guards: offline angelegte Orders werden NICHT (rückwirkend) signiert
// (KassenSichV §146a: kein Nachsignieren — der TSE-Ausfall ist auf dem offline
// gedruckten Bon dokumentiert, beim Replay läuft nur der Datensatz nach). Ein
// bereits gesetzter tse-Snapshot wird nie überschrieben (Idempotenz gegen
// Doppel-Create / Admin-Re-Patch).
export const shouldStartOrderTse = (data: OrderTseStartData | undefined): data is OrderTseStartData =>
  Boolean(data) && !data?.offlineCreated && !data?.tse

// Lückenlose, monoton steigende Fiskal-Vorgangsnummer (≠ dailySequenceNumber,
// die zeitbasierte Bon-/Anzeigenummer bleibt unverändert). Fehlt der Scope oder
// schlägt die Vergabe fehl, wird mit der Fallback-Nummer signiert statt den
// Vorgang zu blockieren (§146a).
export const allocateOrderTransactionNumber = async (input: {
  fallbackTransactionNumber: number
  tenantId?: string
  locationId?: string
  allocateFiscalCounter: (tenantId: string, locationId: string) => Promise<number>
  logger: TseSigningLogger
}): Promise<number> => {
  const { tenantId, locationId } = input
  if (!tenantId || !locationId) return input.fallbackTransactionNumber
  try {
    return await input.allocateFiscalCounter(tenantId, locationId)
  } catch (err) {
    input.logger.warn({
      message: 'Fiskal-Zähler-Vergabe fehlgeschlagen — Fallback auf dailySequenceNumber',
      event: 'tse.fiscal_counter_allocation_failed',
      tenantId,
      locationId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return input.fallbackTransactionNumber
  }
}

// Startet die TSE-Transaktion und baut den Start-Snapshot. NIE blockierend
// (§146a): ein Ausfall liefert einen 'unavailable'/'failed'-Snapshot
// (nachzusignieren), die Order wird trotzdem angelegt.
export const startOrderTseTransaction = async (input: {
  tsePort: Pick<TsePort, 'startTransaction'>
  clientId: string
  fallbackTransactionNumber: number
  tenantId?: string
  locationId?: string
  allocateFiscalCounter: (tenantId: string, locationId: string) => Promise<number>
  logger: TseSigningLogger
}): Promise<OrderTseInfo> => {
  const transactionNumber = await allocateOrderTransactionNumber(input)
  try {
    const ref = await input.tsePort.startTransaction({ clientId: input.clientId, transactionNumber })
    return tseInfoFromStart(ref)
  } catch (err) {
    input.logger.warn({
      message: 'TSE-Start fehlgeschlagen — Order wird unsigniert angelegt (nachzusignieren)',
      event: 'tse.order_start_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return tseInfoFromError({ transactionNumber, clientId: input.clientId, error: err })
  }
}

// Maßgeblicher TSE-Snapshot eines Patches: ein explizit gepatchter Snapshot hat
// Vorrang vor dem gespeicherten Stand.
export const resolveExistingOrderTse = (
  data: { tse?: OrderTseInfo | null },
  current: { tse?: OrderTseInfo | null },
): OrderTseInfo | undefined => (data.tse ?? current.tse) ?? undefined

// payment.totalAmount wird als Währungseinheit interpretiert → Cent. Der echte
// Provider-Adapter härtet die Einheit später ab.
export const resolveOrderTseAmountCents = (
  data: { payment?: { totalAmount?: number } | null },
  current: { payment?: { totalAmount?: number } | null },
): number => Math.round((data.payment?.totalAmount ?? current.payment?.totalAmount ?? 0) * 100)

// Fiskal-Gate transitiv + Idempotenz: nur ein in der Start-Phase (also für
// pos-cashier) gestarteter Vorgang hat einen 'started'-Snapshot. orders-only-Bons
// werden nie gestartet, bereits signierte nie re-signiert → No-Op ohne erneuten
// operationMode-Lookup.
export const canFinishOrderTse = (existing: OrderTseInfo | undefined): existing is OrderTseInfo =>
  existing?.status === 'started'

// Schließt die TSE-Transaktion ab und führt Start-Snapshot + Signatur zusammen.
// NIE blockierend (§146a): ein Ausfall lässt den Bon als nachzusignieren zurück.
export const finishOrderTseTransaction = async (input: {
  tsePort: Pick<TsePort, 'finishTransaction'>
  existing: OrderTseInfo
  amountCents: number
  logger: TseSigningLogger
}): Promise<OrderTseInfo> => {
  try {
    const signature = await input.tsePort.finishTransaction(tseRefFromInfo(input.existing), {
      amountCents: input.amountCents,
    })
    return tseInfoFromSignature(input.existing, signature)
  } catch (err) {
    input.logger.warn({
      message: 'TSE-Abschluss fehlgeschlagen — Bon bleibt nachzusignieren',
      event: 'tse.order_finish_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return tseInfoFromError({
      transactionNumber: input.existing.transactionNumber,
      clientId: input.existing.clientId,
      provider: input.existing.provider,
      error: err,
    })
  }
}

// Nur eine real existierende TSE-Transaktion (gestartet oder signiert) lässt
// sich stornieren. Bereits storniert (cancellation gesetzt) → idempotent skip.
export const canCancelOrderTse = (existing: OrderTseInfo | undefined): existing is OrderTseInfo =>
  (existing?.status === 'signed' || existing?.status === 'started') && !existing.cancellation

// Signiert den Storno/Refund (KassenSichV: eigener fiskalischer Vorgang) und
// legt das Ergebnis NEBEN der Sale-Signatur ab (Audit bleibt erhalten). NIE
// blockierend (§146a): ein Ausfall markiert den Storno als nachzusignieren.
export const cancelOrderTseTransaction = async (input: {
  tsePort: Pick<TsePort, 'cancelTransaction'>
  existing: OrderTseInfo
  canceledAt: string
  logger: TseSigningLogger
}): Promise<OrderTseInfo> => {
  try {
    const signature = await input.tsePort.cancelTransaction(tseRefFromInfo(input.existing))
    return { ...input.existing, cancellation: tseCancellationFromSignature(signature, input.canceledAt) }
  } catch (err) {
    input.logger.warn({
      message: 'TSE-Storno fehlgeschlagen — Storno bleibt nachzusignieren',
      event: 'tse.order_cancel_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return { ...input.existing, cancellation: tseCancellationFromError(err, input.canceledAt) }
  }
}
