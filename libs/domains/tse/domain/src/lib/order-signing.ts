import type { TseSignature, TseTransactionRef } from './tse-transaction.schema'
import { TseUnavailableError } from './tse.errors'

// Eingebetteter TSE-Snapshot auf einer Order. Bewusst eine eigenständige,
// strukturell schlanke Form (keine Cross-Domain-Abhängigkeit orders→tse): das
// Order-Schema definiert ein dazu passendes TypeBox-Schema (`orderTseSchema`).
export type OrderTseStatus = 'started' | 'signed' | 'failed' | 'unavailable'

// Eingebettete Storno-Signatur (KassenSichV: ein Storno/Refund ist ein eigener
// fiskalischer Vorgang). Bewusst NEBEN der ursprünglichen Verkaufs-Signatur
// gehalten (nicht überschrieben) — die Sale-Signatur bleibt für den Audit erhalten.
export type OrderTseCancellationStatus = 'canceled' | 'failed' | 'unavailable'

export interface OrderTseCancellation {
  status: OrderTseCancellationStatus
  canceledAt: string
  signatureCounter?: number
  signatureValue?: string
  signatureAlgorithm?: string
  logTime?: string
  processType?: string
  errorReason?: string
}

export interface OrderTseInfo {
  status: OrderTseStatus
  provider: string
  clientId: string
  transactionNumber: number
  simulated: boolean
  startedAt?: string
  signatureCounter?: number
  signatureValue?: string
  signatureAlgorithm?: string
  logTime?: string
  processType?: string
  errorReason?: string
  // Gesetzt, sobald der Vorgang storniert/refundiert + TSE-signiert wurde.
  cancellation?: OrderTseCancellation
}

// Start-Snapshot aus einer gestarteten TSE-Transaktion (Status 'started').
export const tseInfoFromStart = (ref: TseTransactionRef): OrderTseInfo => ({
  status: 'started',
  provider: ref.provider,
  clientId: ref.clientId,
  transactionNumber: ref.transactionNumber,
  simulated: ref.simulated,
  startedAt: ref.startedAt,
})

// Signierter Snapshot: führt den Start-Snapshot mit der Abschluss-Signatur zusammen.
export const tseInfoFromSignature = (base: OrderTseInfo, signature: TseSignature): OrderTseInfo => ({
  ...base,
  status: 'signed',
  signatureCounter: signature.signatureCounter,
  signatureValue: signature.signatureValue,
  signatureAlgorithm: signature.signatureAlgorithm,
  logTime: signature.logTime,
  processType: signature.processType,
  simulated: signature.simulated,
})

// KassenSichV §146a: ein TSE-Ausfall (`TseUnavailableError`) darf den Verkauf
// NICHT blockieren — der Vorgang wird als 'unavailable' markiert (später
// nachzusignieren). Andere Fehler → 'failed'.
export const tseInfoFromError = (input: {
  transactionNumber: number
  clientId: string
  provider?: string
  error: unknown
}): OrderTseInfo => ({
  status: input.error instanceof TseUnavailableError ? 'unavailable' : 'failed',
  provider: input.provider ?? 'unknown',
  clientId: input.clientId,
  transactionNumber: input.transactionNumber,
  simulated: false,
  errorReason: input.error instanceof Error ? input.error.message : String(input.error),
})

// Storno-Signatur aus einer erfolgreichen cancelTransaction. Ergänzt die
// ursprüngliche `OrderTseInfo` um den `cancellation`-Block (Sale-Signatur bleibt).
export const tseCancellationFromSignature = (
  signature: TseSignature,
  canceledAt: string,
): OrderTseCancellation => ({
  status: 'canceled',
  canceledAt,
  signatureCounter: signature.signatureCounter,
  signatureValue: signature.signatureValue,
  signatureAlgorithm: signature.signatureAlgorithm,
  logTime: signature.logTime,
  processType: signature.processType,
})

// §146a: ein TSE-Ausfall beim Storno blockiert NICHT — der Storno-Block wird als
// 'unavailable' markiert (nachzusignieren); andere Fehler → 'failed'.
export const tseCancellationFromError = (error: unknown, canceledAt: string): OrderTseCancellation => ({
  status: error instanceof TseUnavailableError ? 'unavailable' : 'failed',
  canceledAt,
  errorReason: error instanceof Error ? error.message : String(error),
})

// Rekonstruiert die Transaktions-Referenz aus dem gespeicherten Start-Snapshot,
// um die Transaktion abzuschließen (finishTransaction).
export const tseRefFromInfo = (info: OrderTseInfo): TseTransactionRef => ({
  transactionNumber: info.transactionNumber,
  clientId: info.clientId,
  startedAt: info.startedAt ?? new Date().toISOString(),
  provider: info.provider,
  simulated: info.simulated,
})
